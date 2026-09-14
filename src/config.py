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

# Optional high-fidelity override, intended for a registered BOM WFS/GeoJSON source.
BOM_WARNING_GEOJSON_URL = os.getenv("BOM_WARNING_GEOJSON_URL", "").strip()

# Official BOM CAP feed listed by the WMO Register of Alerting Authorities.
BOM_CAP_RSS_URL = os.getenv(
    "BOM_CAP_RSS_URL",
    "https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml",
).strip()

BOM_RADAR_WMS_URL = os.getenv("BOM_RADAR_WMS_URL", "").strip()
BOM_RADAR_WMS_LAYER = os.getenv("BOM_RADAR_WMS_LAYER", "").strip()
BOM_RADAR_WMS_VERSION = os.getenv("BOM_RADAR_WMS_VERSION", "1.1.1").strip() or "1.1.1"
BOM_RADAR_LEGEND_URL = os.getenv("BOM_RADAR_LEGEND_URL", "").strip()

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "45"))
USER_AGENT = os.getenv(
    "MAPPING_USER_AGENT",
    "QueenslandSevereThunderstormMapping/0.2 (+https://github.com/giswatidid/Mapping)",
)
