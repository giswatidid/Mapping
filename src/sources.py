from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
import xml.etree.ElementTree as ET

import geopandas as gpd
import requests
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

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


def _empty_gdf() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs="EPSG:4326")


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": config.USER_AGENT,
            "Accept": "application/json,application/geo+json,application/xml,text/xml,*/*",
        }
    )
    return s


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local_name(child.tag) == name and child.text:
            value = child.text.strip()
            if value:
                return value
    return None


def _descendant_text(element: ET.Element, name: str) -> str | None:
    for child in element.iter():
        if _local_name(child.tag) == name and child.text:
            value = child.text.strip()
            if value:
                return value
    return None


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


def _parse_cap_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _cap_polygon(text: str) -> Polygon | None:
    coords: list[tuple[float, float]] = []
    for token in text.replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lat = float(parts[0])
            lon = float(parts[1])
        except ValueError:
            continue
        coords.append((lon, lat))

    if len(coords) < 3:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])

    try:
        polygon = Polygon(coords)
        if polygon.is_empty:
            return None
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        return polygon if not polygon.is_empty else None
    except Exception:
        return None


def _parse_cap_alert(xml_text: str) -> dict[str, Any] | None:
    root = ET.fromstring(xml_text)

    identifier = _child_text(root, "identifier") or ""
    msg_type = (_child_text(root, "msgType") or "").lower()
    sent = _child_text(root, "sent")

    # Product codes are the safest way to limit this project to QLD severe thunderstorm warnings.
    identifier_upper = identifier.upper()
    product_match = "IDQ21033" in identifier_upper or "IDQ21035" in identifier_upper

    infos = [node for node in root.iter() if _local_name(node.tag) == "info"]
    selected_info: ET.Element | None = None

    for info in infos:
        event = (_child_text(info, "event") or "").lower()
        headline = (_child_text(info, "headline") or "").lower()
        if product_match or "severe thunderstorm" in event or "severe thunderstorm" in headline:
            selected_info = info
            break

    if selected_info is None:
        return None

    event = _child_text(selected_info, "event")
    headline = _child_text(selected_info, "headline")
    effective = _child_text(selected_info, "effective")
    expires = _child_text(selected_info, "expires")
    description = _child_text(selected_info, "description")

    if msg_type == "cancel":
        return None

    expires_dt = _parse_cap_datetime(expires)
    if expires_dt is not None and expires_dt < datetime.now(timezone.utc):
        return None

    polygons = []
    area_descriptions: list[str] = []

    for area in [node for node in selected_info.iter() if _local_name(node.tag) == "area"]:
        area_desc = _child_text(area, "areaDesc")
        if area_desc:
            area_descriptions.append(area_desc)
        for node in area.iter():
            if _local_name(node.tag) == "polygon" and node.text:
                polygon = _cap_polygon(node.text.strip())
                if polygon is not None:
                    polygons.append(polygon)

    if not polygons:
        return {
            "candidate_without_geometry": True,
            "identifier": identifier,
            "headline": headline,
            "event": event,
            "issued": effective or sent,
            "expires": expires,
            "area_desc": "; ".join(area_descriptions),
        }

    geometry = unary_union(polygons)

    return {
        "identifier": identifier,
        "warning_id": identifier,
        "product_id": "IDQ21035" if "IDQ21035" in identifier_upper else (
            "IDQ21033" if "IDQ21033" in identifier_upper else None
        ),
        "headline": headline or event or "Severe Thunderstorm Warning",
        "event": event,
        "issued": effective or sent,
        "expires": expires,
        "description": description,
        "area_desc": "; ".join(area_descriptions),
        "geometry": geometry,
    }


def _rss_item_links(xml_text: str) -> list[str]:
    root = ET.fromstring(xml_text)
    links: list[str] = []

    for item in [node for node in root.iter() if _local_name(node.tag) in {"item", "entry"}]:
        serial = ET.tostring(item, encoding="unicode").lower()
        if not (
            "severe thunderstorm" in serial
            or "idq21033" in serial
            or "idq21035" in serial
        ):
            continue

        link: str | None = None
        for node in item.iter():
            if _local_name(node.tag) != "link":
                continue
            href = node.attrib.get("href")
            if href:
                link = href.strip()
                break
            if node.text and node.text.strip():
                link = node.text.strip()
                break

        if not link:
            guid = _descendant_text(item, "guid")
            if guid and guid.startswith(("http://", "https://")):
                link = guid

        if link and link.startswith(("http://", "https://")) and link not in links:
            links.append(link)

    return links


def _load_warning_geojson(url: str) -> tuple[gpd.GeoDataFrame, SourceState]:
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

        return gdf, SourceState(status="ok", timestamp=_iso_now(), url=url, count=len(gdf))
    except Exception as exc:
        return _empty_gdf(), SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def _load_warning_cap_rss(url: str) -> tuple[gpd.GeoDataFrame, SourceState]:
    try:
        session = _session()
        feed = session.get(url, timeout=config.HTTP_TIMEOUT)
        feed.raise_for_status()

        links = _rss_item_links(feed.text)
        if not links:
            return _empty_gdf(), SourceState(
                status="no_active_warnings",
                message="The official BOM CAP feed contains no current Queensland severe thunderstorm warning entries.",
                timestamp=_iso_now(),
                url=url,
                count=0,
            )

        rows: list[dict[str, Any]] = []
        no_geometry: list[str] = []
        fetch_errors: list[str] = []

        for link in links:
            try:
                response = session.get(link, timeout=config.HTTP_TIMEOUT)
                response.raise_for_status()
                parsed = _parse_cap_alert(response.text)
                if parsed is None:
                    continue
                if parsed.pop("candidate_without_geometry", False):
                    no_geometry.append(parsed.get("identifier") or link)
                    continue
                rows.append(parsed)
            except Exception as exc:
                fetch_errors.append(f"{link}: {type(exc).__name__}: {exc}")

        if rows:
            gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
            message_parts = ["Official BOM CAP via WMO SWIC."]
            if no_geometry:
                message_parts.append(f"{len(no_geometry)} severe thunderstorm CAP alert(s) had no polygon geometry.")
            if fetch_errors:
                message_parts.append(f"{len(fetch_errors)} candidate CAP alert(s) could not be fetched.")
            return gdf, SourceState(
                status="ok",
                message=" ".join(message_parts),
                timestamp=_iso_now(),
                url=url,
                count=len(gdf),
            )

        if no_geometry:
            return _empty_gdf(), SourceState(
                status="error",
                message=(
                    "A current Queensland severe thunderstorm CAP warning was found, but it did not contain polygon "
                    "geometry. Configure BOM_WARNING_GEOJSON_URL with the registered BOM spatial warning feed."
                ),
                timestamp=_iso_now(),
                url=url,
                count=0,
            )

        if fetch_errors:
            return _empty_gdf(), SourceState(
                status="error",
                message=f"CAP feed candidates were found but could not be read: {fetch_errors[0]}",
                timestamp=_iso_now(),
                url=url,
                count=0,
            )

        return _empty_gdf(), SourceState(
            status="no_active_warnings",
            message="No active Queensland severe thunderstorm CAP warnings remained after validity filtering.",
            timestamp=_iso_now(),
            url=url,
            count=0,
        )
    except Exception as exc:
        return _empty_gdf(), SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def load_warning_geometries(url: str | None = None) -> tuple[gpd.GeoDataFrame, SourceState]:
    override = (url or config.BOM_WARNING_GEOJSON_URL).strip()
    if override:
        return _load_warning_geojson(override)

    if config.BOM_CAP_RSS_URL:
        return _load_warning_cap_rss(config.BOM_CAP_RSS_URL)

    return _empty_gdf(), SourceState(
        status="source_unconfigured",
        message="No BOM warning spatial or CAP source is configured.",
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

        return gdf, SourceState(status="ok", timestamp=_iso_now(), url=url, count=len(gdf))
    except Exception as exc:
        return _empty_gdf(), SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def _load_arcgis_geojson_layer(
    layer_url: str,
    *,
    where: str = "1=1",
    out_fields: str = "*",
) -> tuple[gpd.GeoDataFrame, SourceState]:
    url = f"{layer_url}/query"
    params = {
        "where": where,
        "outFields": out_fields,
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }
    try:
        r = _session().get(url, params=params, timeout=config.HTTP_TIMEOUT)
        r.raise_for_status()
        gdf = _to_gdf(r.json())
        return gdf, SourceState(status="ok", timestamp=_iso_now(), url=r.url, count=len(gdf))
    except Exception as exc:
        return _empty_gdf(), SourceState(
            status="error",
            message=f"{type(exc).__name__}: {exc}",
            timestamp=_iso_now(),
            url=url,
        )


def load_lga_boundaries() -> tuple[gpd.GeoDataFrame, SourceState]:
    return _load_arcgis_geojson_layer(config.QLD_LGA_LAYER_URL)


def load_qld_coastline() -> tuple[gpd.GeoDataFrame, SourceState]:
    return _load_arcgis_geojson_layer(
        config.QLD_COASTLINE_LAYER_URL,
        out_fields="feature_type",
    )


def load_qld_state_border() -> tuple[gpd.GeoDataFrame, SourceState]:
    # Queensland Border (FoundationData layer 5) uses border_desc/state_desc
    # rather than feature_type.
    return _load_arcgis_geojson_layer(
        config.QLD_STATE_BORDER_LAYER_URL,
        out_fields="border_desc,state_desc",
    )


def load_qld_mainland() -> tuple[gpd.GeoDataFrame, SourceState]:
    return _load_arcgis_geojson_layer(
        config.QLD_MAINLAND_LAYER_URL,
        out_fields="feature_type,name",
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
