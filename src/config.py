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

ROAD_CLOSURES_URL = os.getenv(
    "ROAD_CLOSURES_URL",
    "https://data.qldtraffic.qld.gov.au/events_v2.geojson",
)

QLD_LGA_LAYER_URL = os.getenv(
    "QLD_LGA_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Boundaries/AdminBoundariesFramework/FeatureServer/11",
)

# Cartographic reference layers used to make the Queensland land/coastline
# visually distinct from LGA administrative boundaries.
QLD_COASTLINE_LAYER_URL = os.getenv(
    "QLD_COASTLINE_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Basemaps/FoundationData/FeatureServer/55",
)
QLD_STATE_BORDER_LAYER_URL = os.getenv(
    "QLD_STATE_BORDER_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Basemaps/FoundationData/FeatureServer/5",
)
QLD_MAINLAND_LAYER_URL = os.getenv(
    "QLD_MAINLAND_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Location/GeographicalFeatures/FeatureServer/90",
)

QLD_POPULATION_CENTRES_LAYER_URL = os.getenv(
    "QLD_POPULATION_CENTRES_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Location/Places/FeatureServer/20",
)

QLD_MAJOR_ROADS_LAYER_URL = os.getenv(
    "QLD_MAJOR_ROADS_LAYER_URL",
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Basemaps/FoundationData/FeatureServer/23",
)

# Warning discovery. A registered spatial override can still be supplied later;
# otherwise the official BOM CAP feed is used.
BOM_WARNING_GEOJSON_URL = os.getenv("BOM_WARNING_GEOJSON_URL", "").strip()
BOM_CAP_RSS_URL = os.getenv(
    "BOM_CAP_RSS_URL",
    "https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml",
).strip()

# Legacy renderer compatibility only. Live radar now comes from the authenticated
# ArcGIS WMS in the signed-in browser, so the public RainViewer path is disabled.
RAINVIEWER_ENABLED = False
RAINVIEWER_MANIFEST_URL = ""
RAINVIEWER_TILE_SIZE = int(os.getenv("RAINVIEWER_TILE_SIZE", "512"))
RAINVIEWER_MAX_ZOOM = min(7, int(os.getenv("RAINVIEWER_MAX_ZOOM", "7")))
RAINVIEWER_MAX_TILES = int(os.getenv("RAINVIEWER_MAX_TILES", "36"))
RAINVIEWER_TILE_WORKERS = int(os.getenv("RAINVIEWER_TILE_WORKERS", "6"))
RAINVIEWER_COLOR_SCHEME = int(os.getenv("RAINVIEWER_COLOR_SCHEME", "2"))
RAINVIEWER_SMOOTH = int(os.getenv("RAINVIEWER_SMOOTH", "1"))
RAINVIEWER_SNOW = int(os.getenv("RAINVIEWER_SNOW", "0"))

# Optional fallback for an authorised BOM Registered User GIS2Web WMS account.
BOM_RADAR_WMS_URL = os.getenv("BOM_RADAR_WMS_URL", "").strip()
BOM_RADAR_WMS_LAYER = os.getenv("BOM_RADAR_WMS_LAYER", "").strip()
BOM_RADAR_WMS_VERSION = os.getenv("BOM_RADAR_WMS_VERSION", "1.1.1").strip() or "1.1.1"
BOM_RADAR_WMS_STYLE = os.getenv("BOM_RADAR_WMS_STYLE", "").strip()
BOM_RADAR_WMS_USERNAME = os.getenv("BOM_RADAR_WMS_USERNAME", "").strip()
BOM_RADAR_WMS_PASSWORD = os.getenv("BOM_RADAR_WMS_PASSWORD", "")
BOM_RADAR_WMS_WIDTH = int(os.getenv("BOM_RADAR_WMS_WIDTH", "1600"))

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "45"))
USER_AGENT = os.getenv(
    "MAPPING_USER_AGENT",
    "QueenslandSevereThunderstormMapping/0.5 (+https://github.com/giswatidid/Mapping)",
)
