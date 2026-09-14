from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT
OUTPUT_DIR = ROOT / "generated"

POWER_OUTAGE_URL = os.getenv(
    "POWER_OUTAGE_URL",
    "https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson",
)

QLD_LGA_LAYER_URL = os.getenv(
    "QLD_LGA_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Boundaries/AdminBoundariesFramework/FeatureServer/11",
)

# Optional high-fidelity warning override, intended for a registered BOM
# WFS/GeoJSON source. When unset, the official BOM CAP feed is used.
BOM_WARNING_GEOJSON_URL = os.getenv("BOM_WARNING_GEOJSON_URL", "").strip()

BOM_CAP_RSS_URL = os.getenv(
    "BOM_CAP_RSS_URL",
    "https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml",
).strip()

# Official BOM public mapping service. The radar renderer reads the WMTS
# capabilities dynamically so published timestamps and tile geometry are not
# hard-coded into this project.
BOM_RADAR_WMTS_URL = os.getenv(
    "BOM_RADAR_WMTS_URL",
    "https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts",
).strip()
BOM_RADAR_WMTS_CAPABILITIES_URL = os.getenv(
    "BOM_RADAR_WMTS_CAPABILITIES_URL",
    "https://api.bom.gov.au/apikey/v1/mapping/timeseries/wmts/1.0.0/WMTSCapabilities.xml",
).strip()
BOM_RADAR_WMTS_LAYER = os.getenv(
    "BOM_RADAR_WMTS_LAYER",
    "atm_surf_air_precip_reflectivity_dbz",
).strip()
BOM_RADAR_MAX_TILES = int(os.getenv("BOM_RADAR_MAX_TILES", "64"))
BOM_RADAR_TILE_WORKERS = int(os.getenv("BOM_RADAR_TILE_WORKERS", "6"))

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "45"))
USER_AGENT = os.getenv(
    "MAPPING_USER_AGENT",
    "QueenslandSevereThunderstormMapping/0.3 (+https://github.com/giswatidid/Mapping)",
)
