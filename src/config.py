from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
OUTPUT_DIR = SITE_DIR / "generated"

POWER_OUTAGE_URL = os.getenv(
    "POWER_OUTAGE_URL",
    "https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson",
)

QLD_LGA_LAYER_URL = os.getenv(
    "QLD_LGA_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Boundaries/AdminBoundariesFramework/FeatureServer/11",
)

BOM_WARNING_GEOJSON_URL = os.getenv("BOM_WARNING_GEOJSON_URL", "").strip()
BOM_RADAR_WMS_URL = os.getenv("BOM_RADAR_WMS_URL", "").strip()
BOM_RADAR_WMS_LAYER = os.getenv("BOM_RADAR_WMS_LAYER", "").strip()
BOM_RADAR_WMS_VERSION = os.getenv("BOM_RADAR_WMS_VERSION", "1.1.1").strip()
BOM_RADAR_LEGEND_URL = os.getenv("BOM_RADAR_LEGEND_URL", "").strip()

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "45"))
USER_AGENT = os.getenv(
    "MAPPING_USER_AGENT",
    "QueenslandSevereThunderstormMapping/0.1 (+https://github.com/giswatidid/Mapping)",
)
