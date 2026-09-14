from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from datetime import datetime, timedelta, timezone
import math
import xml.etree.ElementTree as ET

from PIL import Image
from pyproj import Transformer
import requests

from . import config


@dataclass(frozen=True)
class TileMatrix:
    identifier: str
    scale_denominator: float
    top_left_x: float
    top_left_y: float
    tile_width: int
    tile_height: int
    matrix_width: int
    matrix_height: int

    @property
    def pixel_size_m(self) -> float:
        # OGC WMTS defines scale denominator using a 0.28 mm display pixel.
        return self.scale_denominator * 0.00028

    @property
    def tile_span_x(self) -> float:
        return self.pixel_size_m * self.tile_width

    @property
    def tile_span_y(self) -> float:
        return self.pixel_size_m * self.tile_height


@dataclass
class RadarFrame:
    image: Image.Image
    bounds: tuple[float, float, float, float]
    timestamp: str | None
    layer: str
    tile_matrix: str
    tile_count: int
    provider: str
    legend_kind: str


RAIN_RATE_LEGEND = [
    ("less than 2", (245, 245, 255, 255)),
    ("2 - 3", (180, 180, 255, 255)),
    ("3 - 5", (120, 120, 255, 255)),
    ("5 - 7", (20, 20, 255, 255)),
    ("7 - 10", (0, 216, 195, 255)),
    ("10 - 15", (0, 150, 144, 255)),
    ("15 - 25", (0, 102, 102, 255)),
    ("25 - 35", (255, 255, 0, 255)),
    ("35 - 55", (255, 200, 0, 255)),
    ("55 - 80", (255, 150, 0, 255)),
    ("80 - 120", (255, 100, 0, 255)),
    ("120 - 180", (255, 0, 0, 255)),
    ("180 - 270", (200, 0, 0, 255)),
    ("270 - 400", (120, 0, 0, 255)),
    ("400+", (40, 0, 0, 255)),
]


REFLECTIVITY_LEGEND = [
    ("12 - 23", (245, 245, 255, 255)),
    ("23 - 28", (180, 180, 255, 255)),
    ("28 - 31", (120, 120, 255, 255)),
    ("31 - 34", (20, 20, 255, 255)),
    ("34 - 37", (0, 216, 195, 255)),
    ("37 - 40", (0, 150, 144, 255)),
    ("40 - 43", (0, 102, 102, 255)),
    ("43 - 46", (255, 255, 0, 255)),
    ("46 - 49", (255, 200, 0, 255)),
    ("49 - 52", (255, 150, 0, 255)),
    ("52 - 55", (255, 100, 0, 255)),
    ("55 - 58", (255, 0, 0, 255)),
    ("58 - 61", (200, 0, 0, 255)),
    ("61 - 64", (120, 0, 0, 255)),
    ("> 64", (40, 0, 0, 255)),
]


# BOM's observed-rain WMTS uses a cropped Web Mercator Google-compatible
# matrix. These values are published by the service and are also independently
# checked by current BOM radar clients. Keeping this fallback means the renderer
# can continue to discover live frames even when the optional capabilities
# document is unavailable.
_WORLD_EXTENT = 40075016.68557849
_STATIC_MATRIX_GEOMETRY = [
    (0, 11584952.0, 34168990.685578, 1, 1),
    (1, 11584952.0, 14131482.342789, 1, 1),
    (2, 11584952.0, 4112728.171395, 1, 1),
    (3, 11584952.0, 4112728.171395, 2, 2),
    (4, 11584952.0, 1608039.628546, 3, 3),
    (5, 11584952.0, 355695.357122, 6, 5),
    (6, 11584952.0, -270476.778591, 11, 9),
    (7, 11584952.0, -583562.846447, 22, 17),
    (8, 11584952.0, -740105.880375, 43, 33),
]


def _fetch_public_arcgis(bounds: tuple[float, float, float, float]) -> RadarFrame:
    if not config.BOM_RADAR_ARCGIS_EXPORT_URL:
        raise RuntimeError("Public Queensland BOM radar ArcGIS service is not configured")

    minx, miny, maxx, maxy = bounds
    width = max(600, config.BOM_RADAR_ARCGIS_WIDTH)
    ratio = max(0.30, min(3.0, (maxy - miny) / max(maxx - minx, 0.001)))
    height = max(500, min(2400, int(round(width * ratio))))

    params = {
        "bbox": f"{minx},{miny},{maxx},{maxy}",
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{width},{height}",
        "dpi": "96",
        "format": "png32",
        "transparent": "true",
        "layers": f"show:{config.BOM_RADAR_ARCGIS_LAYER}",
        "f": "image",
    }

    response = requests.get(
        config.BOM_RADAR_ARCGIS_EXPORT_URL,
        params=params,
        timeout=config.HTTP_TIMEOUT,
        headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "image/png,image/*,*/*",
        },
    )
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "").lower()
    if "image" not in content_type:
        snippet = response.text[:300].replace("\n", " ") if response.text else ""
        raise RuntimeError(
            f"Queensland BOM radar ArcGIS service returned {content_type or 'unknown content type'}"
            + (f": {snippet}" if snippet else "")
        )

    return RadarFrame(
        image=Image.open(BytesIO(response.content)).convert("RGBA"),
        bounds=bounds,
        timestamp=None,
        layer=str(config.BOM_RADAR_ARCGIS_LAYER),
        tile_matrix="ArcGIS export",
        tile_count=1,
        provider="qld_psba_bom_arcgis",
        legend_kind="rain_rate",
    )


def _wms_auth() -> tuple[str, str] | None:
    if config.BOM_RADAR_WMS_USERNAME:
        return (config.BOM_RADAR_WMS_USERNAME, config.BOM_RADAR_WMS_PASSWORD)
    return None


def _fetch_registered_wms(bounds: tuple[float, float, float, float]) -> RadarFrame:
    minx, miny, maxx, maxy = bounds
    width = max(600, config.BOM_RADAR_WMS_WIDTH)
    ratio = max(0.30, min(3.0, (maxy - miny) / max(maxx - minx, 0.001)))
    height = max(500, min(2400, int(round(width * ratio))))

    version = config.BOM_RADAR_WMS_VERSION
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": version,
        "LAYERS": config.BOM_RADAR_WMS_LAYER,
        "STYLES": config.BOM_RADAR_WMS_STYLE,
        "FORMAT": "image/png",
        "TRANSPARENT": "TRUE",
        "WIDTH": str(width),
        "HEIGHT": str(height),
    }

    if version.startswith("1.3"):
        # EPSG:4326 axis order under WMS 1.3.0 is latitude,longitude.
        params["CRS"] = "EPSG:4326"
        params["BBOX"] = f"{miny},{minx},{maxy},{maxx}"
    else:
        params["SRS"] = "EPSG:4326"
        params["BBOX"] = f"{minx},{miny},{maxx},{maxy}"

    response = requests.get(
        config.BOM_RADAR_WMS_URL,
        params=params,
        auth=_wms_auth(),
        timeout=config.HTTP_TIMEOUT,
        headers={
            "User-Agent": config.USER_AGENT,
            "Accept": "image/png,image/*,*/*",
        },
    )
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "").lower()
    if "image" not in content_type:
        snippet = response.text[:300].replace("\n", " ") if response.text else ""
        raise RuntimeError(
            f"BOM GIS2Web WMS returned {content_type or 'unknown content type'}"
            + (f": {snippet}" if snippet else "")
        )

    image = Image.open(BytesIO(response.content)).convert("RGBA")
    timestamp = response.headers.get("Last-Modified") or response.headers.get("Date")

    return RadarFrame(
        image=image,
        bounds=bounds,
        timestamp=timestamp,
        layer=config.BOM_RADAR_WMS_LAYER,
        tile_matrix="WMS",
        tile_count=1,
        provider="gis2web_wms",
        legend_kind="rain_rate",
    )


def _static_matrices() -> list[TileMatrix]:
    result: list[TileMatrix] = []
    for z, top_left_x, top_left_y, width, height in _STATIC_MATRIX_GEOMETRY:
        tile_span = _WORLD_EXTENT / (2 ** z)
        pixel_size = tile_span / 256
        scale = pixel_size / 0.00028
        result.append(
            TileMatrix(
                identifier=str(z),
                scale_denominator=scale,
                top_left_x=top_left_x,
                top_left_y=top_left_y,
                tile_width=256,
                tile_height=256,
                matrix_width=width,
                matrix_height=height,
            )
        )
    return result


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local_name(child.tag) == name and child.text:
            value = child.text.strip()
            if value:
                return value
    return None


def _descendants(element: ET.Element, name: str):
    for node in element.iter():
        if _local_name(node.tag) == name:
            yield node


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": config.USER_AGENT,
            "Accept": "image/png,application/xml,text/xml,*/*",
        }
    )
    return session


def _find_identified_element(root: ET.Element, tag_name: str, identifier: str) -> ET.Element:
    for element in _descendants(root, tag_name):
        for child in element:
            if _local_name(child.tag) == "Identifier" and (child.text or "").strip() == identifier:
                return element
    raise RuntimeError(f"BOM WMTS capabilities does not contain {tag_name} {identifier}")


def _layer_metadata(root: ET.Element, layer_id: str) -> tuple[str, list[str], str | None]:
    layer = _find_identified_element(root, "Layer", layer_id)

    matrix_set = None
    for link in _descendants(layer, "TileMatrixSetLink"):
        matrix_set = _child_text(link, "TileMatrixSet")
        if matrix_set:
            break
    if not matrix_set:
        raise RuntimeError(f"BOM WMTS layer {layer_id} has no TileMatrixSet")

    timestamps: list[str] = []
    default_timestamp = None
    for dimension in _descendants(layer, "Dimension"):
        identifier = (_child_text(dimension, "Identifier") or "").lower()
        if identifier != "time":
            continue
        default_timestamp = _child_text(dimension, "Default")
        for value in _descendants(dimension, "Value"):
            if value.text and value.text.strip():
                timestamps.append(value.text.strip())
        break

    if not timestamps:
        raise RuntimeError(f"BOM WMTS layer {layer_id} has no published time values")

    # Capabilities are normally ascending. Sorting defensively keeps the latest
    # frame deterministic if upstream ordering ever changes.
    timestamps = sorted(set(timestamps))
    latest = default_timestamp if default_timestamp in timestamps else timestamps[-1]
    return matrix_set, timestamps, latest


def _tile_matrices(root: ET.Element, matrix_set_id: str) -> list[TileMatrix]:
    matrix_set = _find_identified_element(root, "TileMatrixSet", matrix_set_id)
    matrices: list[TileMatrix] = []

    for element in _descendants(matrix_set, "TileMatrix"):
        identifier = _child_text(element, "Identifier")
        scale = _child_text(element, "ScaleDenominator")
        top_left = _child_text(element, "TopLeftCorner")
        tile_width = _child_text(element, "TileWidth")
        tile_height = _child_text(element, "TileHeight")
        matrix_width = _child_text(element, "MatrixWidth")
        matrix_height = _child_text(element, "MatrixHeight")

        if not all((identifier, scale, top_left, tile_width, tile_height, matrix_width, matrix_height)):
            continue

        coords = top_left.split()
        if len(coords) != 2:
            continue

        matrices.append(
            TileMatrix(
                identifier=identifier,
                scale_denominator=float(scale),
                top_left_x=float(coords[0]),
                top_left_y=float(coords[1]),
                tile_width=int(tile_width),
                tile_height=int(tile_height),
                matrix_width=int(matrix_width),
                matrix_height=int(matrix_height),
            )
        )

    if not matrices:
        raise RuntimeError(f"BOM WMTS matrix set {matrix_set_id} has no usable matrices")
    return matrices


def _project_bounds(bounds: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = bounds
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    min_x, min_y = transformer.transform(min_lon, min_lat)
    max_x, max_y = transformer.transform(max_lon, max_lat)
    return min(min_x, max_x), min(min_y, max_y), max(min_x, max_x), max(min_y, max_y)


def _tile_range(
    matrix: TileMatrix,
    projected_bounds: tuple[float, float, float, float],
) -> tuple[int, int, int, int] | None:
    min_x, min_y, max_x, max_y = projected_bounds
    span_x = matrix.tile_span_x
    span_y = matrix.tile_span_y

    col0 = math.floor((min_x - matrix.top_left_x) / span_x)
    col1 = math.floor((max_x - matrix.top_left_x) / span_x)
    row0 = math.floor((matrix.top_left_y - max_y) / span_y)
    row1 = math.floor((matrix.top_left_y - min_y) / span_y)

    col0 = max(0, col0)
    row0 = max(0, row0)
    col1 = min(matrix.matrix_width - 1, col1)
    row1 = min(matrix.matrix_height - 1, row1)

    if col0 > col1 or row0 > row1:
        return None
    return col0, col1, row0, row1


def _matrix_sort_key(matrix: TileMatrix) -> float:
    try:
        return float(matrix.identifier)
    except ValueError:
        return -matrix.scale_denominator


def _choose_matrix(
    matrices: list[TileMatrix],
    projected_bounds: tuple[float, float, float, float],
) -> tuple[TileMatrix, tuple[int, int, int, int]]:
    candidates = sorted(matrices, key=_matrix_sort_key, reverse=True)
    fallback = None

    for matrix in candidates:
        tile_range = _tile_range(matrix, projected_bounds)
        if tile_range is None:
            continue
        col0, col1, row0, row1 = tile_range
        count = (col1 - col0 + 1) * (row1 - row0 + 1)
        if fallback is None:
            fallback = (matrix, tile_range)
        if count <= config.BOM_RADAR_MAX_TILES:
            return matrix, tile_range

    if fallback is not None:
        return fallback
    raise RuntimeError("Requested warning extent does not intersect BOM radar WMTS coverage")


def _tile_url(
    layer_id: str,
    matrix_set: str,
    matrix: str,
    row: int,
    col: int,
    timestamp: str,
) -> str:
    params = {
        "SERVICE": "WMTS",
        "REQUEST": "GetTile",
        "VERSION": "1.0.0",
        "LAYER": layer_id,
        "STYLE": "default",
        "FORMAT": "image/png",
        "TILEMATRIXSET": matrix_set,
        "TILEMATRIX": matrix,
        "TILEROW": str(row),
        "TILECOL": str(col),
        "time": timestamp,
    }
    request = requests.Request("GET", config.BOM_RADAR_WMTS_URL, params=params).prepare()
    return request.url


def _fetch_tile(url: str, tile_size: tuple[int, int]) -> Image.Image:
    response = _session().get(url, timeout=config.HTTP_TIMEOUT)

    # BOM's public WMTS may omit completely blank tiles. Treat a 404 as a
    # transparent tile rather than failing the whole mosaic.
    if response.status_code == 404:
        return Image.new("RGBA", tile_size, (0, 0, 0, 0))

    response.raise_for_status()
    content_type = response.headers.get("Content-Type", "").lower()
    if "image" not in content_type:
        raise RuntimeError(f"BOM radar tile returned {content_type or 'unknown content type'}")
    return Image.open(BytesIO(response.content)).convert("RGBA")


def _mosaic_tiles(
    layer_id: str,
    matrix_set_id: str,
    matrix: TileMatrix,
    tile_range: tuple[int, int, int, int],
    timestamp: str,
) -> tuple[Image.Image, int]:
    col0, col1, row0, row1 = tile_range
    cols = col1 - col0 + 1
    rows = row1 - row0 + 1
    mosaic = Image.new("RGBA", (cols * matrix.tile_width, rows * matrix.tile_height), (0, 0, 0, 0))

    tasks: dict = {}
    with ThreadPoolExecutor(max_workers=max(1, config.BOM_RADAR_TILE_WORKERS)) as pool:
        for row in range(row0, row1 + 1):
            for col in range(col0, col1 + 1):
                url = _tile_url(layer_id, matrix_set_id, matrix.identifier, row, col, timestamp)
                tasks[pool.submit(_fetch_tile, url, (matrix.tile_width, matrix.tile_height))] = (row, col)

        for future in as_completed(tasks):
            row, col = tasks[future]
            tile = future.result()
            if tile.size != (matrix.tile_width, matrix.tile_height):
                tile = tile.resize((matrix.tile_width, matrix.tile_height), Image.Resampling.BILINEAR)
            x = (col - col0) * matrix.tile_width
            y = (row - row0) * matrix.tile_height
            mosaic.alpha_composite(tile, (x, y))

    return mosaic, len(tasks)


def _crop_to_bounds(
    mosaic: Image.Image,
    matrix: TileMatrix,
    tile_range: tuple[int, int, int, int],
    projected_bounds: tuple[float, float, float, float],
) -> Image.Image:
    col0, _, row0, _ = tile_range
    min_x, min_y, max_x, max_y = projected_bounds

    mosaic_left = matrix.top_left_x + col0 * matrix.tile_span_x
    mosaic_top = matrix.top_left_y - row0 * matrix.tile_span_y

    px_per_m_x = matrix.tile_width / matrix.tile_span_x
    px_per_m_y = matrix.tile_height / matrix.tile_span_y

    left = int(round((min_x - mosaic_left) * px_per_m_x))
    right = int(round((max_x - mosaic_left) * px_per_m_x))
    top = int(round((mosaic_top - max_y) * px_per_m_y))
    bottom = int(round((mosaic_top - min_y) * px_per_m_y))

    left = max(0, min(mosaic.width - 1, left))
    right = max(left + 1, min(mosaic.width, right))
    top = max(0, min(mosaic.height - 1, top))
    bottom = max(top + 1, min(mosaic.height, bottom))

    return mosaic.crop((left, top, right, bottom))


def _fallback_timestamps(count: int = 12) -> list[str]:
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    minute = (now.minute // 5) * 5
    snapped = now.replace(minute=minute) - timedelta(minutes=config.BOM_RADAR_WMTS_LAG_MINUTES)
    return [
        (snapped - timedelta(minutes=5 * index)).isoformat().replace("+00:00", "Z")
        for index in range(count)
    ]


def _probe_timestamp(
    layer_id: str,
    matrix_set_id: str,
    candidates: list[str],
) -> str:
    # Probe the z0/0/0 tile, matching BOM's current public-radar clients. A
    # map-specific high-zoom tile can legitimately be absent when that area has
    # no radar echoes, so it is not a reliable publication-availability test.
    session = _session()
    for timestamp in candidates:
        url = _tile_url(layer_id, matrix_set_id, "0", 0, 0, timestamp)
        try:
            response = session.get(url, timeout=config.HTTP_TIMEOUT)
            if not response.ok or "image" not in response.headers.get("Content-Type", "").lower():
                continue
            image = Image.open(BytesIO(response.content))
            image.verify()
            return timestamp
        except Exception:
            continue

    raise RuntimeError(
        f"No recent BOM radar frame was available for {layer_id}; "
        f"probed {len(candidates)} recent 5-minute frames"
    )


def fetch_bom_radar(bounds: tuple[float, float, float, float]) -> RadarFrame:
    if config.BOM_RADAR_ARCGIS_EXPORT_URL:
        return _fetch_public_arcgis(bounds)

    if config.BOM_RADAR_WMS_URL and config.BOM_RADAR_WMS_LAYER:
        return _fetch_registered_wms(bounds)

    if not config.BOM_RADAR_WMTS_ENABLED:
        raise RuntimeError(
            "BOM Registered User GIS2Web WMS is not configured. "
            "Set BOM_RADAR_WMS_URL and BOM_RADAR_WMS_LAYER."
        )

    if not config.BOM_RADAR_WMTS_URL:
        raise RuntimeError("Experimental BOM radar WMTS is not configured")

    matrix_set_id = "GoogleMapsCompatible_BoM"
    matrices = _static_matrices()
    advertised_latest = None

    # Capabilities are useful when available, but live tile discovery does not
    # depend on them. BOM's public mapping edge can return 404 for the document
    # while the KVP GetTile service remains available.
    if config.BOM_RADAR_WMTS_CAPABILITIES_URL:
        try:
            capabilities_response = _session().get(
                config.BOM_RADAR_WMTS_CAPABILITIES_URL,
                timeout=config.HTTP_TIMEOUT,
            )
            if capabilities_response.ok:
                root = ET.fromstring(capabilities_response.content)
                matrix_set_id, _timestamps, advertised_latest = _layer_metadata(
                    root,
                    config.BOM_RADAR_WMTS_LAYER,
                )
                matrices = _tile_matrices(root, matrix_set_id)
        except Exception:
            pass

    projected_bounds = _project_bounds(bounds)
    matrix, tile_range = _choose_matrix(matrices, projected_bounds)

    candidates: list[str] = []
    if advertised_latest:
        candidates.append(advertised_latest)
    for timestamp in _fallback_timestamps():
        if timestamp not in candidates:
            candidates.append(timestamp)

    latest_timestamp = _probe_timestamp(
        config.BOM_RADAR_WMTS_LAYER,
        matrix_set_id,
        candidates,
    )

    mosaic, tile_count = _mosaic_tiles(
        config.BOM_RADAR_WMTS_LAYER,
        matrix_set_id,
        matrix,
        tile_range,
        latest_timestamp,
    )
    image = _crop_to_bounds(mosaic, matrix, tile_range, projected_bounds)

    return RadarFrame(
        image=image,
        bounds=bounds,
        timestamp=latest_timestamp,
        layer=config.BOM_RADAR_WMTS_LAYER,
        tile_matrix=matrix.identifier,
        tile_count=tile_count,
        provider="public_bom_wmts",
        legend_kind=(
            "rain_rate"
            if config.BOM_RADAR_WMTS_LAYER == "atm_surf_air_precip_rate_1hr_total_mm_h"
            else "reflectivity"
        ),
    )
