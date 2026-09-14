from io import BytesIO

from PIL import Image

from src import config
from src.radar import _fetch_registered_wms


class FakeResponse:
    def __init__(self, png_bytes: bytes):
        self.content = png_bytes
        self.headers = {
            "Content-Type": "image/png",
            "Last-Modified": "Sun, 14 Sep 2026 06:00:00 GMT",
        }

    def raise_for_status(self):
        return None


def _png_bytes() -> bytes:
    image = Image.new("RGBA", (20, 10), (0, 0, 0, 0))
    out = BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_registered_wms_111_request(monkeypatch):
    captured = {}

    monkeypatch.setattr(config, "BOM_RADAR_WMS_URL", "https://example.invalid/wms")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_LAYER", "radar_rainfall_intensity")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_VERSION", "1.1.1")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_STYLE", "")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_USERNAME", "user")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_PASSWORD", "pass")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_WIDTH", 800)

    def fake_get(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return FakeResponse(_png_bytes())

    monkeypatch.setattr("src.radar.requests.get", fake_get)

    frame = _fetch_registered_wms((152.0, -28.0, 153.0, -27.0))

    assert captured["url"] == "https://example.invalid/wms"
    assert captured["auth"] == ("user", "pass")
    assert captured["params"]["SERVICE"] == "WMS"
    assert captured["params"]["REQUEST"] == "GetMap"
    assert captured["params"]["SRS"] == "EPSG:4326"
    assert captured["params"]["BBOX"] == "152.0,-28.0,153.0,-27.0"
    assert captured["params"]["LAYERS"] == "radar_rainfall_intensity"
    assert frame.provider == "gis2web_wms"
    assert frame.legend_kind == "rain_rate"
    assert frame.tile_matrix == "WMS"


def test_registered_wms_130_axis_order(monkeypatch):
    captured = {}

    monkeypatch.setattr(config, "BOM_RADAR_WMS_URL", "https://example.invalid/wms")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_LAYER", "radar")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_VERSION", "1.3.0")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_STYLE", "")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_USERNAME", "")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_PASSWORD", "")
    monkeypatch.setattr(config, "BOM_RADAR_WMS_WIDTH", 800)

    def fake_get(url, **kwargs):
        captured.update(kwargs)
        return FakeResponse(_png_bytes())

    monkeypatch.setattr("src.radar.requests.get", fake_get)

    _fetch_registered_wms((152.0, -28.0, 153.0, -27.0))

    assert captured["params"]["CRS"] == "EPSG:4326"
    assert captured["params"]["BBOX"] == "-28.0,152.0,-27.0,153.0"
    assert captured["auth"] is None
