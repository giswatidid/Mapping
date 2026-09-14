from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import geopandas as gpd
from shapely.geometry import Polygon

from . import config
from .render import render_outage_map, render_radar_map
from .sources import (
    SourceState,
    load_lga_boundaries,
    load_power_outages,
    load_warning_geometries,
    warning_identifier,
    warning_time,
    warning_title,
)


def aest_now() -> str:
    return (
        datetime.now(timezone.utc)
        .astimezone(ZoneInfo("Australia/Brisbane"))
        .replace(microsecond=0)
        .isoformat()
    )


def clean_output() -> None:
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in config.OUTPUT_DIR.glob("*.png"):
        path.unlink()
    manifest = config.OUTPUT_DIR / "manifest.json"
    if manifest.exists():
        manifest.unlink()


def write_manifest(payload: dict) -> None:
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = config.OUTPUT_DIR / "manifest.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def demo_warning(count: int = 1) -> gpd.GeoDataFrame:
    """Return clearly labelled synthetic QLD warning geometry for render testing."""
    seq = Polygon(
        [
            (152.25, -28.15),
            (153.35, -28.05),
            (153.45, -27.20),
            (152.95, -26.65),
            (152.15, -26.95),
            (151.95, -27.65),
            (152.25, -28.15),
        ]
    )

    rows = [
        {
            "warning_id": "DEMO-SEQ",
            "product_id": "IDQ21035",
            "headline": "DEMO ONLY — Southeast Queensland Severe Thunderstorm Warning",
            "issued": aest_now(),
            "geometry": seq,
        }
    ]

    if count >= 2:
        central = Polygon(
            [
                (147.10, -24.85),
                (149.55, -24.70),
                (150.05, -22.85),
                (148.65, -21.85),
                (146.85, -22.45),
                (146.35, -23.90),
                (147.10, -24.85),
            ]
        )
        rows.append(
            {
                "warning_id": "DEMO-CENTRAL",
                "product_id": "IDQ21033",
                "headline": "DEMO ONLY — Central Queensland Severe Thunderstorm Warning",
                "issued": aest_now(),
                "geometry": central,
            }
        )

    return gpd.GeoDataFrame(rows[: max(1, count)], geometry="geometry", crs="EPSG:4326")


def build_warning_metadata(warnings: gpd.GeoDataFrame) -> list[dict]:
    result: list[dict] = []
    used_ids: set[str] = set()

    for index, (_, row) in enumerate(warnings.iterrows()):
        base = warning_identifier(row, index)
        warning_id = base
        suffix = 2
        while warning_id in used_ids:
            warning_id = f"{base}-{suffix}"
            suffix += 1
        used_ids.add(warning_id)

        result.append(
            {
                "id": warning_id,
                "title": warning_title(row, index),
                "issued": warning_time(row),
            }
        )
    return result


def run(demo: bool = False, demo_count: int = 1) -> int:
    clean_output()
    generated_at = aest_now()

    if demo:
        warnings = demo_warning(count=demo_count)
        warning_state = SourceState(
            status="demo",
            message="Synthetic development geometry; not live Bureau of Meteorology data.",
            timestamp=generated_at,
            count=len(warnings),
        )
    else:
        warnings, warning_state = load_warning_geometries()

    manifest: dict = {
        "generated_at": generated_at,
        "mode": "demo" if demo else "live",
        "status": "starting",
        "sources": {
            "warnings": warning_state.as_dict(),
            "outages": None,
            "lgas": None,
            "radar": {
                "status": "not_checked",
                "url": config.BOM_RADAR_WMS_URL or None,
                "layer": config.BOM_RADAR_WMS_LAYER or None,
            },
        },
        "warnings": [],
        "maps": [],
        "errors": [],
    }

    if warnings.empty:
        if warning_state.status == "no_active_warnings":
            manifest["status"] = "no_active_warnings"
        elif warning_state.status == "source_unconfigured":
            manifest["status"] = "source_unconfigured"
        else:
            manifest["status"] = "source_error"
        write_manifest(manifest)
        return 0 if warning_state.status in {"no_active_warnings", "source_unconfigured"} else 1

    warning_meta = build_warning_metadata(warnings)
    manifest["warnings"] = warning_meta

    outages, outage_state = load_power_outages()
    lgas, lga_state = load_lga_boundaries()
    manifest["sources"]["outages"] = outage_state.as_dict()
    manifest["sources"]["lgas"] = lga_state.as_dict()

    if lga_state.status != "ok":
        manifest["errors"].append(f"LGA source: {lga_state.message}")
    if outage_state.status != "ok":
        manifest["errors"].append(f"Outage source: {outage_state.message}")

    scopes: list[tuple[str, str, gpd.GeoDataFrame, str | None, str | None]] = []

    if len(warnings) > 1:
        scopes.append(
            (
                "combined",
                "All current Queensland severe thunderstorm warnings",
                warnings,
                None,
                None,
            )
        )
    else:
        scopes.append(
            (
                "combined",
                warning_meta[0]["title"],
                warnings,
                warning_meta[0]["issued"],
                warning_meta[0]["id"],
            )
        )

    if len(warnings) > 1:
        for idx in range(len(warnings)):
            meta = warning_meta[idx]
            scopes.append(
                (
                    meta["id"],
                    meta["title"],
                    warnings.iloc[[idx]].copy(),
                    meta["issued"],
                    meta["id"],
                )
            )

    radar_configured = bool(config.BOM_RADAR_WMS_URL and config.BOM_RADAR_WMS_LAYER)
    if radar_configured:
        manifest["sources"]["radar"]["status"] = "configured"
    else:
        manifest["sources"]["radar"]["status"] = "source_unconfigured"
        manifest["sources"]["radar"]["message"] = (
            "Set BOM_RADAR_WMS_URL and BOM_RADAR_WMS_LAYER to enable radar maps."
        )

    radar_error: str | None = None

    for scope, scope_title, scope_gdf, issued, warning_id in scopes:
        outage_filename = f"warning-outages-{scope}.png"
        outage_path = config.OUTPUT_DIR / outage_filename
        outage_info = render_outage_map(
            scope_gdf,
            outages,
            lgas,
            outage_path,
            title=f"{scope_title} — Unplanned Power Outages",
            generated_at=generated_at,
            warning_time=issued,
        )
        manifest["maps"].append(
            {
                "kind": "outages",
                "scope": scope,
                "warning_id": warning_id,
                "title": f"{scope_title} — Unplanned Power Outages",
                "filename": outage_filename,
                **outage_info,
            }
        )

        if radar_configured and radar_error is None:
            radar_filename = f"warning-radar-{scope}.png"
            radar_path = config.OUTPUT_DIR / radar_filename
            try:
                radar_info = render_radar_map(
                    scope_gdf,
                    lgas,
                    radar_path,
                    title=f"{scope_title} — Rain Radar",
                    generated_at=generated_at,
                    warning_time=issued,
                )
                manifest["maps"].append(
                    {
                        "kind": "radar",
                        "scope": scope,
                        "warning_id": warning_id,
                        "title": f"{scope_title} — Rain Radar",
                        "filename": radar_filename,
                        **radar_info,
                    }
                )
                manifest["sources"]["radar"]["status"] = "ok"
            except Exception as exc:
                radar_error = f"{type(exc).__name__}: {exc}"
                manifest["sources"]["radar"]["status"] = "error"
                manifest["sources"]["radar"]["message"] = radar_error
                manifest["errors"].append(f"Radar source: {radar_error}")

    if manifest["maps"]:
        manifest["status"] = "ok" if not manifest["errors"] else "partial"
    else:
        manifest["status"] = "generation_error"

    write_manifest(manifest)
    return 0 if manifest["status"] in {"ok", "partial"} else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Queensland severe thunderstorm maps")
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Use clearly labelled synthetic warning polygons for renderer development.",
    )
    parser.add_argument(
        "--demo-count",
        type=int,
        choices=(1, 2),
        default=1,
        help="Number of synthetic simultaneous warnings to render in demo mode.",
    )
    args = parser.parse_args()
    raise SystemExit(run(demo=args.demo, demo_count=args.demo_count))


if __name__ == "__main__":
    main()
