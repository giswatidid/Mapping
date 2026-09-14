from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any, Iterable

import geopandas as gpd
import matplotlib.pyplot as plt
import requests
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
from PIL import Image

from . import config


def padded_bounds(gdf: gpd.GeoDataFrame, fraction: float = 0.09, minimum: float = 0.18) -> tuple[float, float, float, float]:
    minx, miny, maxx, maxy = gdf.total_bounds
    dx = max(maxx - minx, minimum)
    dy = max(maxy - miny, minimum)
    padx = max(dx * fraction, minimum)
    pady = max(dy * fraction, minimum)
    return minx - padx, miny - pady, maxx + padx, maxy + pady


def clip_to_bounds(gdf: gpd.GeoDataFrame, bounds: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    minx, miny, maxx, maxy = bounds
    try:
        return gdf.cx[minx:maxx, miny:maxy]
    except Exception:
        return gdf


def _label_field(lgas: gpd.GeoDataFrame) -> str | None:
    candidates = (
        "LGA",
        "LGA_NAME",
        "LGA_NAME22",
        "LGA_NAME23",
        "LGA_NAME24",
        "LGA_NAME25",
        "LGA_NAME26",
        "NAME",
        "LOCALITY",
    )
    cols_upper = {str(c).upper(): c for c in lgas.columns}
    for candidate in candidates:
        if candidate in lgas.columns:
            return candidate
        if candidate.upper() in cols_upper:
            return cols_upper[candidate.upper()]
    for column in lgas.columns:
        if "name" in str(column).lower() and column != "geometry":
            return column
    return None


def _draw_lgas(ax: Any, lgas: gpd.GeoDataFrame, bounds: tuple[float, float, float, float]) -> None:
    visible = clip_to_bounds(lgas, bounds)
    if visible.empty:
        return
    visible.boundary.plot(ax=ax, color="#5f6b73", linewidth=0.7, alpha=0.85, zorder=2)

    field = _label_field(visible)
    if not field:
        return

    for _, row in visible.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        point = geom.representative_point()
        text = str(row.get(field) or "").strip()
        if not text:
            continue
        ax.text(
            point.x,
            point.y,
            text,
            fontsize=6.5,
            color="#3d474e",
            ha="center",
            va="center",
            zorder=3,
            path_effects=[],
        )


def _draw_warning(ax: Any, warnings: gpd.GeoDataFrame) -> None:
    warnings.plot(
        ax=ax,
        facecolor="#ffd43b",
        edgecolor="#b23a00",
        linewidth=2.2,
        alpha=0.30,
        zorder=5,
    )


def _outage_size(row: Any) -> float:
    for field in ("affected_customers", "customers", "customer_count"):
        value = row.get(field) if hasattr(row, "get") else None
        try:
            customers = max(0.0, float(value))
            return min(220.0, 24.0 + customers ** 0.5 * 4.0)
        except Exception:
            continue
    return 34.0


def _draw_outages(ax: Any, outages: gpd.GeoDataFrame, bounds: tuple[float, float, float, float]) -> int:
    visible = clip_to_bounds(outages, bounds)
    if visible.empty:
        return 0

    point_rows = []
    xs: list[float] = []
    ys: list[float] = []
    sizes: list[float] = []

    for _, row in visible.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        p = geom if geom.geom_type == "Point" else geom.centroid
        point_rows.append(row)
        xs.append(p.x)
        ys.append(p.y)
        sizes.append(_outage_size(row))

    if xs:
        ax.scatter(
            xs,
            ys,
            s=sizes,
            c="#dc2626",
            edgecolors="white",
            linewidths=0.7,
            alpha=0.9,
            zorder=8,
        )
    return len(xs)


def _set_extent(ax: Any, bounds: tuple[float, float, float, float]) -> None:
    minx, miny, maxx, maxy = bounds
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.grid(True, linewidth=0.35, alpha=0.22)


def _footer(ax: Any, lines: Iterable[str]) -> None:
    text = "  |  ".join(line for line in lines if line)
    ax.figure.text(0.5, 0.018, text, ha="center", va="bottom", fontsize=7.5, color="#4b5563")


def render_outage_map(
    warning_gdf: gpd.GeoDataFrame,
    outages: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
) -> dict[str, Any]:
    bounds = padded_bounds(warning_gdf)
    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#f8fafc")

    _draw_lgas(ax, lgas, bounds)
    _draw_warning(ax, warning_gdf)
    outage_count = _draw_outages(ax, outages, bounds)
    _set_extent(ax, bounds)

    ax.set_title(title, fontsize=16, fontweight="bold", pad=12)
    legend = [
        Patch(facecolor="#ffd43b", edgecolor="#b23a00", alpha=0.35, label="BOM severe thunderstorm warning area"),
        Line2D([0], [0], color="#5f6b73", lw=1.1, label="Local government area boundary"),
        Line2D([0], [0], marker="o", color="w", markerfacecolor="#dc2626", markeredgecolor="white", markersize=9, label="Current unplanned power outage"),
    ]
    ax.legend(handles=legend, loc="lower left", framealpha=0.95, fontsize=9)

    footer = [f"Generated {generated_at}"]
    if warning_time:
        footer.append(f"Warning issued {warning_time}")
    footer.append(f"{outage_count} unplanned outage locations shown in map extent")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.02, 0.045, 0.98, 0.98))
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)

    return {"bounds": list(bounds), "outages_in_extent": outage_count}


def fetch_radar_wms(bounds: tuple[float, float, float, float]) -> Image.Image:
    if not config.BOM_RADAR_WMS_URL or not config.BOM_RADAR_WMS_LAYER:
        raise RuntimeError("BOM radar WMS URL/layer is not configured")

    minx, miny, maxx, maxy = bounds
    width = 1400
    ratio = max(0.35, min(2.5, (maxy - miny) / max(maxx - minx, 0.001)))
    height = max(650, min(1800, int(width * ratio)))

    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": config.BOM_RADAR_WMS_VERSION,
        "LAYERS": config.BOM_RADAR_WMS_LAYER,
        "STYLES": "",
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
        "SRS": "EPSG:4326",
        "BBOX": f"{minx},{miny},{maxx},{maxy}",
        "WIDTH": str(width),
        "HEIGHT": str(height),
    }

    r = requests.get(
        config.BOM_RADAR_WMS_URL,
        params=params,
        timeout=config.HTTP_TIMEOUT,
        headers={"User-Agent": config.USER_AGENT},
    )
    r.raise_for_status()
    content_type = r.headers.get("Content-Type", "")
    if "image" not in content_type.lower():
        raise RuntimeError(f"Radar WMS did not return an image ({content_type or 'unknown content type'})")
    return Image.open(BytesIO(r.content)).convert("RGBA")


def render_radar_map(
    warning_gdf: gpd.GeoDataFrame,
    lgas: gpd.GeoDataFrame,
    output_path: Path,
    title: str,
    generated_at: str,
    warning_time: str | None = None,
) -> dict[str, Any]:
    bounds = padded_bounds(warning_gdf)
    radar = fetch_radar_wms(bounds)

    fig, ax = plt.subplots(figsize=(12, 9), dpi=150)
    ax.set_facecolor("#101820")
    minx, miny, maxx, maxy = bounds
    ax.imshow(radar, extent=(minx, maxx, miny, maxy), origin="upper", zorder=1)

    visible_lgas = clip_to_bounds(lgas, bounds)
    if not visible_lgas.empty:
        visible_lgas.boundary.plot(ax=ax, color="white", linewidth=0.55, alpha=0.65, zorder=4)

    warning_gdf.boundary.plot(ax=ax, color="#ffdf00", linewidth=2.8, zorder=8)
    warning_gdf.plot(ax=ax, facecolor="#ffdf00", edgecolor="none", alpha=0.07, zorder=7)
    _set_extent(ax, bounds)

    ax.set_title(title, fontsize=16, fontweight="bold", pad=12)
    legend = [
        Patch(facecolor="#ffdf00", edgecolor="#ffdf00", alpha=0.25, label="BOM severe thunderstorm warning area"),
        Patch(facecolor="#7c3aed", edgecolor="none", alpha=0.8, label="BOM rain radar imagery (colours supplied by radar layer)"),
        Line2D([0], [0], color="white", lw=1.0, label="Local government area boundary"),
    ]
    ax.legend(handles=legend, loc="lower left", framealpha=0.90, fontsize=9)

    footer = [f"Generated {generated_at}"]
    if warning_time:
        footer.append(f"Warning issued {warning_time}")
    _footer(ax, footer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(rect=(0.02, 0.045, 0.98, 0.98))
    fig.savefig(output_path, bbox_inches="tight")
    plt.close(fig)

    return {"bounds": list(bounds)}
