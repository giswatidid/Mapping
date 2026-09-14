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

# BOM's public ArcGIS ImageServer for the current national rain-rate mosaic.
# This is the same public mapping platform used by the current BOM website.
BOM_RADAR_IMAGESERVER_EXPORT_URL = os.getenv(
    "BOM_RADAR_IMAGESERVER_EXPORT_URL",
    "https://api.bom.gov.au/apikey/v1/mapping/observations/"
    "atm_surf_air_precip_rate_1hr_total_mm_h/ImageServer/exportImage",
).strip()
BOM_RADAR_IMAGESERVER_RENDERER = os.getenv(
    "BOM_RADAR_IMAGESERVER_RENDERER",
    "precip_rate_mm_h_cubic",
).strip()
BOM_RADAR_IMAGESERVER_WIDTH = int(os.getenv("BOM_RADAR_IMAGESERVER_WIDTH", "1600"))

# Legacy Queensland Government PSBA ArcGIS proxy for BOM operational layers.
# It is disabled by default because live tests from GitHub Actions in Sep 2026
# were terminated by the remote host for the service root, layers 37/58 and
# Export Map requests. Set explicitly only if this endpoint is known to work
# from the deployment environment.
BOM_RADAR_ARCGIS_EXPORT_URL = os.getenv("BOM_RADAR_ARCGIS_EXPORT_URL", "").strip()
BOM_RADAR_ARCGIS_LAYER = int(os.getenv("BOM_RADAR_ARCGIS_LAYER", "37"))
BOM_RADAR_ARCGIS_WIDTH = int(os.getenv("BOM_RADAR_ARCGIS_WIDTH", "1600"))

# Production radar source: BOM Registered User GIS2Web WMS. The endpoint and
# layer are account-specific and are therefore supplied as GitHub secrets.
BOM_RADAR_WMS_URL = os.getenv("BOM_RADAR_WMS_URL", "").strip()
BOM_RADAR_WMS_LAYER = os.getenv("BOM_RADAR_WMS_LAYER", "").strip()
BOM_RADAR_WMS_VERSION = os.getenv("BOM_RADAR_WMS_VERSION", "1.1.1").strip() or "1.1.1"
BOM_RADAR_WMS_STYLE = os.getenv("BOM_RADAR_WMS_STYLE", "").strip()
BOM_RADAR_WMS_USERNAME = os.getenv("BOM_RADAR_WMS_USERNAME", "").strip()
BOM_RADAR_WMS_PASSWORD = os.getenv("BOM_RADAR_WMS_PASSWORD", "")
BOM_RADAR_WMS_WIDTH = int(os.getenv("BOM_RADAR_WMS_WIDTH", "1600"))

# Experimental public WMTS fallback. It is retained because BOM's current web
# map uses this product family, but it is NOT considered production-ready: our
# GitHub-hosted tests currently cannot retrieve usable frames from it.
BOM_RADAR_WMTS_ENABLED = os.getenv("BOM_RADAR_WMTS_ENABLED", "true").lower() in {"1", "true", "yes"}
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
    "atm_surf_air_precip_rate_1hr_total_mm_h",
).strip()
BOM_RADAR_WMTS_LAG_MINUTES = int(os.getenv("BOM_RADAR_WMTS_LAG_MINUTES", "5"))
BOM_RADAR_MAX_TILES = int(os.getenv("BOM_RADAR_MAX_TILES", "64"))
BOM_RADAR_TILE_WORKERS = int(os.getenv("BOM_RADAR_TILE_WORKERS", "6"))

HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "45"))
USER_AGENT = os.getenv(
    "MAPPING_USER_AGENT",
    "QueenslandSevereThunderstormMapping/0.4 (+https://github.com/giswatidid/Mapping)",
)
