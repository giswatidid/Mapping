from src.sources import _cap_polygon, _parse_cap_alert


def test_cap_polygon_uses_cap_lat_lon_order():
    polygon = _cap_polygon("-27.50,152.90 -27.50,153.10 -27.30,153.10 -27.30,152.90")
    assert polygon is not None
    minx, miny, maxx, maxy = polygon.bounds
    assert round(minx, 2) == 152.90
    assert round(maxx, 2) == 153.10
    assert round(miny, 2) == -27.50
    assert round(maxy, 2) == -27.30


def test_parse_qld_severe_thunderstorm_cap_polygon():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>AusBoM-IDQ21033-TEST</identifier>
      <sender>CAP.Message@bom.gov.au</sender>
      <sent>2099-01-01T01:00:00+00:00</sent>
      <status>Actual</status>
      <msgType>Alert</msgType>
      <scope>Public</scope>
      <info>
        <language>en-AU</language>
        <category>Met</category>
        <event>Severe Thunderstorm Warning</event>
        <effective>2099-01-01T01:00:00+00:00</effective>
        <expires>2099-01-01T03:00:00+00:00</expires>
        <headline>Severe Thunderstorm Warning for parts of Queensland</headline>
        <area>
          <areaDesc>Test warning area</areaDesc>
          <polygon>-27.50,152.90 -27.50,153.10 -27.30,153.10 -27.30,152.90 -27.50,152.90</polygon>
        </area>
      </info>
    </alert>
    """
    parsed = _parse_cap_alert(xml)
    assert parsed is not None
    assert parsed["product_id"] == "IDQ21033"
    assert parsed["headline"] == "Severe Thunderstorm Warning for parts of Queensland"
    assert parsed["area_desc"] == "Test warning area"
    assert parsed["geometry"].geom_type == "Polygon"


def test_unrelated_cap_is_ignored():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>AusBoM-IDQ99999-TEST</identifier>
      <sender>CAP.Message@bom.gov.au</sender>
      <sent>2099-01-01T01:00:00+00:00</sent>
      <status>Actual</status>
      <msgType>Alert</msgType>
      <scope>Public</scope>
      <info>
        <event>Flood Warning</event>
        <headline>Flood Warning</headline>
        <area>
          <areaDesc>Test area</areaDesc>
          <polygon>-27.50,152.90 -27.50,153.10 -27.30,153.10 -27.30,152.90 -27.50,152.90</polygon>
        </area>
      </info>
    </alert>
    """
    assert _parse_cap_alert(xml) is None
