# Queensland Severe Thunderstorm Mapping

Generate publication-ready maps from current Queensland Bureau of Meteorology severe thunderstorm warnings.

## Intended outputs

The generator publishes exactly two operational map products for the current Queensland severe-thunderstorm situation:

1. **Warning + radar** — warning geometry with current radar overlaid.
2. **Warning + infrastructure impacts** — warning geometry with current unplanned power outages and QLD Traffic road closures/restrictions overlaid.

When more than one warning is active, both products use a single combined extent containing all current warning areas. When no warning is active, the same two products are generated at statewide Queensland scale.

## Data sources

### BOM severe thunderstorm warnings

The default warning discovery source is the official Bureau of Meteorology CAP feed distributed through the WMO Severe Weather Information Centre:

`https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml`

The parser selects Queensland Severe Thunderstorm Warning products `IDQ21033` and `IDQ21035` (with an event/headline fallback), ignores expired/cancelled alerts, and converts any CAP `polygon` geometry into map polygons.

If an active severe thunderstorm CAP warning is present but contains no polygon, the generator deliberately returns a source error instead of treating that as "no warning".

For higher-fidelity or fallback geometry, `BOM_WARNING_GEOJSON_URL` can override CAP with a registered BOM spatial source. Relevant BOM spatial products are:

- `IDQ65654` — Severe Thunderstorm Warning - Warning Area (QLD)
- `IDQ65650` — Severe Thunderstorm Warning - Southeast Queensland - Threat Area (QLD)
- `IDQ65652` — Severe Thunderstorm Warning - Southeast Queensland - Storm Location (QLD)

### Power outages

Reuses the normalised GeoJSON already published by `gowlettluke/qldpoweroutages`:

`data/current_outages.geojson`

That project normalises Energex, Ergon Energy and Queensland-relevant Essential Energy outages. This project filters that feed to current **unplanned** outages.

### Local government areas

Queensland Government `AdminBoundariesFramework/FeatureServer/11` is queried directly in EPSG:4326.

### Road closures and restrictions

Current road conditions are read directly from the public QLD Traffic GeoJSON feed used by the isolation project:

`https://data.qldtraffic.qld.gov.au/events_v2.geojson`

The generator applies the same important operational safeguards used in `gowlettluke/qld_only_isolation`:

- future events are excluded until their `duration.start`
- expired events are excluded after `duration.end`
- non-published events are excluded
- an `area_alert` polygon/point is treated as contextual only; it is not interpreted as every road inside the area being closed
- an area alert is mapped as a road closure only when explicit line geometry is supplied
- full road closures are classified as **impassable** and rendered red
- lane/restricted/conditional-access events are rendered amber

Warning-area road maps show both full closures and restrictions. On the statewide quiet-day map only full closures are drawn so hundreds of conditional-access events do not obscure the operational picture. Restriction counts are still reported in the map footer.

### Rain radar

The default radar source is the public **RainViewer Weather Maps API**:

`https://api.rainviewer.com/public/weather-maps.json`

RainViewer publishes keyless Web Mercator composite radar tiles for personal, educational and small-scale community use. The generator takes the latest published frame, downloads only the tiles intersecting the warning extent, mosaics/crops them to the exact map bounds and overlays the warning/LGA context.

Current configuration:

```text
RAINVIEWER_ENABLED=true
RAINVIEWER_MANIFEST_URL=https://api.rainviewer.com/public/weather-maps.json
RAINVIEWER_TILE_SIZE=512
RAINVIEWER_MAX_ZOOM=7
RAINVIEWER_COLOR_SCHEME=2
```

Colour scheme 2 is RainViewer's current **Universal Blue** radar reflectivity palette. Generated maps identify the source as RainViewer and the website includes the required attribution link.

An authorised BOM GIS2Web WMS can still be supplied as a fallback with `BOM_RADAR_WMS_URL`, `BOM_RADAR_WMS_LAYER` and the optional WMS credential variables.

The project also contains diagnostics for BOM's public national radar mosaic `IDR00004`. Live testing from GitHub Actions confirmed that both `https://www.bom.gov.au/radar/IDR00004.jpg` and the anonymous FTP `IDR00004.T.yyyymmddhhmm.png` files are current and reachable. They are not used by the public site because BOM does not publish national-mosaic georeferencing metadata in the radar coordinate directory and its current copyright terms restrict republication of radar imagery without the appropriate data licence.

## Current project status

Implemented:

- official BOM CAP severe-thunderstorm warning discovery and polygon parsing
- optional registered spatial-warning override
- current unplanned power outage ingestion
- live QLD Traffic road closure/restriction ingestion and temporal filtering
- Queensland LGA boundary ingestion and labels
- combined-warning extent calculation
- exactly two operational products: radar and infrastructure impacts
- warning-extent LGA labels drawn as low-priority background context
- combined power-outage and road-condition infrastructure renderer
- RainViewer Web Mercator radar renderer with warning/LGA overlay and dBZ key
- optional authorised BOM GIS2Web WMS fallback
- BOM national-mosaic and legacy PSBA diagnostic workflows
- machine-readable `manifest.json`
- source-health states that distinguish feed failure from no active warnings
- GitHub Pages frontend with PNG previews/downloads
- manual and scheduled GitHub Actions generation
- CAP geometry tests
- synthetic demo mode for renderer development

Still to connect:

- a reliable public spatial source for exact BOM severe-thunderstorm warning polygons when CAP contains no geometry
- optional registered BOM warning WFS/GeoJSON fallback
- secure one-click GitHub workflow dispatch from the website (planned via a small Cloudflare Worker)

## GitHub Pages

This repository uses GitHub Pages from the **main branch / repository root**. The web app therefore lives at the repository root (`index.html`, `app.js`, `styles.css`, `config.js`).

The scheduled generation workflow writes current output to `generated/` and commits only that generated output back to `main`. The existing branch-based Pages deployment then republishes the site automatically. This avoids competing GitHub Pages deployment methods.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
python -m src.generate --demo
```

On Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
python -m src.generate --demo
```

Demo mode creates a synthetic Southeast Queensland polygon and marks it clearly as demo data. It is never presented as a live BOM warning.

## Live configuration

No secret is required for the default WMO-distributed BOM CAP feed.

Optional configuration:

```text
BOM_CAP_RSS_URL=https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml
BOM_WARNING_GEOJSON_URL=https://...
RAINVIEWER_ENABLED=true
RAINVIEWER_MANIFEST_URL=https://api.rainviewer.com/public/weather-maps.json

# Optional authorised BOM radar fallback
BOM_RADAR_WMS_URL=https://...
BOM_RADAR_WMS_LAYER=...
BOM_RADAR_WMS_VERSION=1.1.1
BOM_RADAR_WMS_STYLE=
BOM_RADAR_WMS_USERNAME=...
BOM_RADAR_WMS_PASSWORD=...
```

If `BOM_WARNING_GEOJSON_URL` is set, it takes precedence over CAP and may return a GeoJSON FeatureCollection or Feature containing Polygon/MultiPolygon geometry.

## Cartographic overlap rules

The two products use deliberately different layer priorities.

**Warning + radar**

1. Queensland land/coastline and state border
2. LGA boundaries and LGA-name labels
3. severe-thunderstorm warning fill
4. radar imagery
5. severe-thunderstorm warning outline

LGA names are intentionally low-priority context: radar echoes and warning graphics may cover them. The warning outline remains above radar so the operational warning extent is still clear.

**Warning + infrastructure impacts**

1. Queensland land/coastline and state border
2. LGA boundaries and LGA-name labels
3. severe-thunderstorm warning fill and outline
4. power-outage polygons/points
5. road closures/restrictions
6. road labels
7. outage customer-count labels

Power outages are rendered from their true GeoJSON geometry rather than being reduced to centroids. Customer labels use the normalised `affected_customers` value when known, are placed inside polygons using representative points, and are collision-suppressed with larger outages prioritised.

Road closures are rendered red and conditional/restricted access amber. Full closures receive label priority over restrictions. On the statewide quiet-day infrastructure map, conditional restrictions are omitted from the drawing to prevent hundreds of lower-priority events obscuring the statewide operational picture; their count is still reported.

On active-warning maps, LGA names are shown for LGAs intersecting the warning extent. On statewide quiet-day maps, LGA names are suppressed to avoid clutter. Legends sit outside the map frame so they never cover operational data.

## Output

Generated files are written under:

```text
generated/
  manifest.json
  warning-radar-combined.png
  warning-infrastructure-combined.png
  warning-radar-statewide.png
  warning-infrastructure-statewide.png
```

With one or more active warnings, the generator creates only the two combined operational products. With no active warnings, it creates the same two products at statewide scale.

The manifest contains generation time, source status, warning metadata, map bounds, filenames and generation errors/warnings.

## Architecture

```text
Official BOM CAP ───────────────┐
Registered warning geometry ───┤ (optional override)
Power outage GeoJSON ──────────┤
QLD Traffic live GeoJSON ───────┼─> Python generator ─> PNG maps + manifest ─> GitHub Pages
QLD LGA/coast/border data ──────┤
RainViewer radar tiles ──────────┘
```

The website remains static. The **Generate Maps** button is already wired to support a future relay URL, but no GitHub credential is ever placed in browser JavaScript. A Cloudflare Worker can hold the credential and dispatch `workflow_dispatch` securely.

## Operational safeguards

The project intentionally distinguishes:

- `no_active_warnings` — source was successfully checked and no warning polygon is active
- `source_error` — the warning source failed or an active warning lacked required geometry
- `source_unconfigured` — no warning source is configured
- `partial` — maps were made but a secondary source such as outages, LGAs or radar had a problem

Old PNGs are removed before every generation so a stale warning map cannot silently remain current.

## Attribution and source use

BOM CAP alerts accessed through WMO SWIC remain official BOM warnings. WMO states SWIC warning information may be reused by media or other websites when attributed to the respective National Meteorological and Hydrological Service.

Radar imagery on the public site is sourced through the RainViewer public API and attributed to RainViewer. Direct BOM radar imagery is retained only for diagnostics because BOM's anonymous/public radar products have separate publication restrictions. For Bureau spatial-warning products beyond CAP, the project will use only an authorised/public source.
