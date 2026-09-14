from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import geopandas as gpd
import requests
from shapely.geometry import shape

from . import config


@dataclass
class SourceState:
    status: str
    message: str | None = None
    timestamp: str | None = None
    url: str | None = None
    count: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "message": self.message,
            "timestamp": self.timestamp,
            "url": self.url,
            "count": self.count,
        }


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": config.USER_AGENT,
            "Accept": "application/json,application/geo+json,*/*",
        }
    )
    return s


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _to_gdf(payload: Any) -> gpd.GeoDataFrame:
    if isinstance(payload, dict) and payload.get("type") == "FeatureCollection":
        features = payload.get("features") or []
    elif isinstance(payload, dict) and payload.get("type") == "Feature":
        features = [payload]
    else:
        raise ValueError("Expected a GeoJSON FeatureCollection or Feature")

    rows: list[dict[str, Any]] = []
    for feature in features:
        geometry = feature.get("geometry")
        if not geometry:
            continue
        props = dict(feature.get("properties") or {})
        props["geometry"] = shape(geometry)
        rows.append(props)

    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def load_warning_geometries(url: str | None = None) -> tuple[gpd.GeoDataFrame, SourceState]:
    url = (url or config.BOM_WARNING_GEOJSON_URL).strip()
    if not url:
        empty = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
        return empty, SourceState(
            status="source_unconfigured",
            message=(
                "Exact BOM warning geometry is not configured. Set BOM_WARNING_GEOJSON_URL "
                "to the registered BOM spatial warning feed."
            ),
        )

    try:
        r = _session().get(url, timeout=config.HTTP_TIMEOUT)
        r.raise_for_status()
        gdf = _to_gdf(r.json())
        if not gdf.empty:
            gdf = gdf[gdf.geometry.geom_type.isin(["Polygon", "MultiPolygon"])].copy()
        if gdf.empty:
            return gdf, SourceState(
                status="no_active_warnings",
                message="The configured warning source returned no polygon warning features.",
                timestamp=_iso_now(),
                url=url,
                count=0,
            )

        return gdf, SourceState(
            status="ok",
            timestamp=_iso_now(),
            url=url,
            count=len(gdf),
        )
    except Exception as exc:
        empty = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
        return empty, SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def load_power_outages() -> tuple[gpd.GeoDataFrame, SourceState]:
    url = config.POWER_OUTAGE_URL
    try:
        r = _session().get(url, timeout=config.HTTP_TIMEOUT)
        r.raise_for_status()
        gdf = _to_gdf(r.json())

        if "outage_type" in gdf.columns:
            types = gdf["outage_type"].fillna("").astype(str).str.lower().str.strip()
            gdf = gdf[types.eq("unplanned")].copy()

        return gdf, SourceState(
            status="ok",
            timestamp=_iso_now(),
            url=url,
            count=len(gdf),
        )
    except Exception as exc:
        empty = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
        return empty, SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def load_lga_boundaries() -> tuple[gpd.GeoDataFrame, SourceState]:
    url = f"{config.QLD_LGA_LAYER_URL}/query"
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    try:
        r = _session().get(url, params=params, timeout=config.HTTP_TIMEOUT)
        r.raise_for_status()
        gdf = _to_gdf(r.json())
        return gdf, SourceState(
            status="ok",
            timestamp=_iso_now(),
            url=r.url,
            count=len(gdf),
        )
    except Exception as exc:
        empty = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")
        return empty, SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def warning_identifier(row: Any, fallback_index: int) -> str:
    candidate_fields = (
        "warning_id",
        "product_id",
        "product",
        "id",
        "identifier",
        "event_id",
    )
    for field in candidate_fields:
        try:
            value = row.get(field)
        except Exception:
            value = None
        if value not in (None, ""):
            safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in str(value))
            safe = safe.strip("-_")
            if safe:
                return safe[:80]
    return f"warning-{fallback_index + 1}"


def warning_title(row: Any, fallback_index: int) -> str:
    for field in ("headline", "title", "warning_type", "event", "hazard", "product_id"):
        try:
            value = row.get(field)
        except Exception:
            value = None
        if value not in (None, ""):
            return str(value)
    return f"Severe Thunderstorm Warning {fallback_index + 1}"


def warning_time(row: Any) -> str | None:
    for field in ("issued", "issue_time", "issued_at", "sent", "effective", "timestamp"):
        try:
            value = row.get(field)
        except Exception:
            value = None
        if value not in (None, ""):
            return str(value)
    return None
