from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
import math

from PIL import Image
import requests

from . import config


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


# BOM rainfall-intensity palette retained for the optional registered WMS path.
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

# RainViewer Universal Blue colour scheme (scheme 2), sampled at meaningful
# reflectivity thresholds from RainViewer's published colour table.
RAINVIEWER_REFLECTIVITY_LEGEND = [
    ("10", (206, 192, 135, 150)),
    ("15", (136, 221, 238, 255)),
    ("20", (0, 163, 224, 255)),
    ("25", (0, 119, 170, 255)),
    ("30", (0, 85, 136, 255)),
    ("35", (255, 238, 0, 255)),
    ("40", (255, 170, 0, 255)),
    ("45", (255, 68, 0, 255)),
    ("50", (193, 0, 0, 255)),
    ("55", (255, 170, 255, 255)),
    ("60", (255, 119, 255, 255)),
    ("65+", (255, 255, 255, 255)),
]


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": config.USER_AGENT,
            "Accept": "image/png,application/json,*/*",
        }
    )
    return session


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
        raise RuntimeError(
            f"BOM GIS2Web WMS returned {content_type or 'unknown content type'}"
        )

    return RadarFrame(
        image=Image.open(BytesIO(response.content)).convert("RGBA"),
        bounds=bounds,
        timestamp=response.headers.get("Last-Modified") or response.headers.get("Date"),
        layer=config.BOM_RADAR_WMS_LAYER,
        tile_matrix="WMS",
        tile_count=1,
        provider="gis2web_wms",
        legend_kind="rain_rate",
    )


def _world_xy(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    lat = max(-85.05112878, min(85.05112878, lat))
    n = 2 ** zoom
    x = (lon + 180.0) / 360.0 * n
    rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * n
    return x, y


def _tile_window(
    bounds: tuple[float, float, float, float],
    zoom: int,
) -> tuple[int, int, int, int, float, float, float, float]:
    minlon, minlat, maxlon, maxlat = bounds
    x0f, y1f = _world_xy(minlon, minlat, zoom)
    x1f, y0f = _world_xy(maxlon, maxlat, zoom)

    n = 2 ** zoom
    x0 = max(0, min(n - 1, math.floor(x0f)))
    x1 = max(0, min(n - 1, math.floor(max(x0f, x1f - 1e-12))))
    y0 = max(0, min(n - 1, math.floor(y0f)))
    y1 = max(0, min(n - 1, math.floor(max(y0f, y1f - 1e-12))))

    if x1 < x0 or y1 < y0:
        raise RuntimeError("Requested radar bounds do not intersect Web Mercator tiles")

    return x0, x1, y0, y1, x0f, x1f, y0f, y1f


def _choose_rainviewer_zoom(
    bounds: tuple[float, float, float, float],
) -> tuple[int, tuple[int, int, int, int, float, float, float, float]]:
    for zoom in range(config.RAINVIEWER_MAX_ZOOM, 1, -1):
        window = _tile_window(bounds, zoom)
        x0, x1, y0, y1, *_ = window
        tile_count = (x1 - x0 + 1) * (y1 - y0 + 1)
        if tile_count <= config.RAINVIEWER_MAX_TILES:
            return zoom, window

    zoom = 1
    return zoom, _tile_window(bounds, zoom)


def _rainviewer_tile_url(
    host: str,
    path: str,
    zoom: int,
    x: int,
    y: int,
) -> str:
    options = f"{config.RAINVIEWER_SMOOTH}_{config.RAINVIEWER_SNOW}"
    return (
        f"{host}{path}/{config.RAINVIEWER_TILE_SIZE}/{zoom}/{x}/{y}/"
        f"{config.RAINVIEWER_COLOR_SCHEME}/{options}.png"
    )


def _fetch_rainviewer_tile(url: str) -> Image.Image:
    response = _session().get(url, timeout=config.HTTP_TIMEOUT)
    if response.status_code == 404:
        return Image.new(
            "RGBA",
            (config.RAINVIEWER_TILE_SIZE, config.RAINVIEWER_TILE_SIZE),
            (0, 0, 0, 0),
        )
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "").lower()
    if "image" not in content_type:
        raise RuntimeError(
            f"RainViewer tile returned {content_type or 'unknown content type'}"
        )
    image = Image.open(BytesIO(response.content)).convert("RGBA")
    if image.size != (config.RAINVIEWER_TILE_SIZE, config.RAINVIEWER_TILE_SIZE):
        image = image.resize(
            (config.RAINVIEWER_TILE_SIZE, config.RAINVIEWER_TILE_SIZE),
            Image.Resampling.BILINEAR,
        )
    return image


def _fetch_rainviewer(bounds: tuple[float, float, float, float]) -> RadarFrame:
    response = _session().get(
        config.RAINVIEWER_MANIFEST_URL,
        timeout=config.HTTP_TIMEOUT,
    )
    response.raise_for_status()
    manifest = response.json()

    frames = ((manifest.get("radar") or {}).get("past") or [])
    if not frames:
        raise RuntimeError("RainViewer manifest contained no past radar frames")

    frame = frames[-1]
    host = str(manifest.get("host") or "").rstrip("/")
    path = str(frame.get("path") or "")
    timestamp = frame.get("time")
    if not host or not path or timestamp is None:
        raise RuntimeError("RainViewer latest frame was missing host/path/time metadata")

    zoom, window = _choose_rainviewer_zoom(bounds)
    x0, x1, y0, y1, x0f, x1f, y0f, y1f = window

    tile_size = config.RAINVIEWER_TILE_SIZE
    mosaic = Image.new(
        "RGBA",
        ((x1 - x0 + 1) * tile_size, (y1 - y0 + 1) * tile_size),
        (0, 0, 0, 0),
    )

    tasks = {}
    with ThreadPoolExecutor(max_workers=max(1, config.RAINVIEWER_TILE_WORKERS)) as pool:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                url = _rainviewer_tile_url(host, path, zoom, x, y)
                tasks[pool.submit(_fetch_rainviewer_tile, url)] = (x, y)

        for future in as_completed(tasks):
            x, y = tasks[future]
            tile = future.result()
            mosaic.alpha_composite(
                tile,
                ((x - x0) * tile_size, (y - y0) * tile_size),
            )

    left = int(round((x0f - x0) * tile_size))
    right = int(round((x1f - x0) * tile_size))
    top = int(round((y0f - y0) * tile_size))
    bottom = int(round((y1f - y0) * tile_size))

    left = max(0, min(mosaic.width - 1, left))
    right = max(left + 1, min(mosaic.width, right))
    top = max(0, min(mosaic.height - 1, top))
    bottom = max(top + 1, min(mosaic.height, bottom))
    image = mosaic.crop((left, top, right, bottom))

    radar_time = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat()

    return RadarFrame(
        image=image,
        bounds=bounds,
        timestamp=radar_time,
        layer="composite_reflectivity",
        tile_matrix=f"WebMercator z{zoom}",
        tile_count=len(tasks),
        provider="rainviewer",
        legend_kind="rainviewer_reflectivity",
    )


def fetch_bom_radar(bounds: tuple[float, float, float, float]) -> RadarFrame:
    if config.RAINVIEWER_ENABLED:
        return _fetch_rainviewer(bounds)

    if config.BOM_RADAR_WMS_URL and config.BOM_RADAR_WMS_LAYER:
        return _fetch_registered_wms(bounds)

    raise RuntimeError("No radar source is configured")
