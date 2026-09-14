# Queensland Severe Thunderstorm Mapping

Generate publication-ready maps from current Queensland Bureau of Meteorology severe thunderstorm warnings.

## Intended outputs

For every current Queensland severe thunderstorm warning:

1. **Warning + unplanned power outages + LGA boundaries**
2. **Warning + current rain radar**

When more than one warning is active, the generator also produces a combined extent containing all current warning areas and separate maps for each warning.

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

### BOM radar

The radar renderer accepts a standard WMS source using:

```text
BOM_RADAR_WMS_URL=https://...
BOM_RADAR_WMS_LAYER=...
BOM_RADAR_WMS_VERSION=1.1.1
```

The preferred production source is a BOM registered radar/GIS service. Until that endpoint is confirmed, warning/outage maps work independently and the manifest clearly marks radar as `source_unconfigured`.

## Current project status

Implemented:

- official BOM CAP severe-thunderstorm warning discovery and polygon parsing
- optional registered spatial-warning override
- current unplanned power outage ingestion
- Queensland LGA boundary ingestion and labels
- combined-warning extent calculation
- individual maps when multiple warnings are active
- static PNG warning/outage map with legend and timestamps
- WMS radar overlay renderer with warning/LGA key
- machine-readable `manifest.json`
- source-health states that distinguish feed failure from no active warnings
- GitHub Pages frontend with PNG previews/downloads
- manual and scheduled GitHub Actions generation
- CAP geometry tests
- synthetic demo mode for renderer development

Still to connect:

- the preferred production BOM radar WMS endpoint/layer
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
BOM_RADAR_WMS_URL=https://...
BOM_RADAR_WMS_LAYER=...
BOM_RADAR_WMS_VERSION=1.1.1
```

If `BOM_WARNING_GEOJSON_URL` is set, it takes precedence over CAP and may return a GeoJSON FeatureCollection or Feature containing Polygon/MultiPolygon geometry.

## Output

Generated files are written under:

```text
generated/
  manifest.json
  warning-outages-combined.png
  warning-radar-combined.png
  warning-outages-<warning-id>.png
  warning-radar-<warning-id>.png
```

With one warning, the combined view is the operational view. With multiple warnings, the generator creates the combined view plus maps for each warning.

The manifest contains generation time, source status, warning metadata, map bounds, filenames and generation errors/warnings.

## Architecture

```text
Official BOM CAP ───────────────┐
Registered warning geometry ───┤ (optional override)
Power outage GeoJSON ──────────┼─> Python generator ─> PNG maps + manifest ─> GitHub Pages
QLD LGA boundaries ─────────────┤
BOM radar WMS ──────────────────┘
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

For Bureau spatial/radar products beyond the public CAP distribution, the production design prefers Registered User Services rather than relying on undocumented or reverse-engineered endpoints.
