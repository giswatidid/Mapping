# Queensland Severe Thunderstorm Mapping

Generate publication-ready maps from current Queensland Bureau of Meteorology severe thunderstorm warnings.

## Intended outputs

For every current Queensland severe thunderstorm warning:

1. **Warning + unplanned power outages + LGA boundaries**
2. **Warning + current rain radar**

When more than one warning is active, the generator also produces a combined extent containing all current warning areas.

## Data sources

### Power outages
Reuses the normalised GeoJSON already published by `gowlettluke/qldpoweroutages`:

`data/current_outages.geojson`

That project normalises Energex, Ergon Energy and Queensland-relevant Essential Energy outages.

### Local government areas
Queensland Government AdminBoundariesFramework FeatureServer layer 11.

### BOM severe thunderstorm warnings
The renderer is ready for exact warning polygons as GeoJSON. The preferred production source is the Bureau's registered spatial warning products:

- IDQ65654 — Severe Thunderstorm Warning - Warning Area (QLD)
- IDQ65650 — Severe Thunderstorm Warning - Southeast Queensland - Threat Area (QLD)
- IDQ65652 — Severe Thunderstorm Warning - Southeast Queensland - Storm Location (QLD)

The live URL is deliberately configurable with `BOM_WARNING_GEOJSON_URL` until the registered BOM delivery endpoint is confirmed.

### BOM radar
The radar renderer accepts a standard WMS endpoint through `BOM_RADAR_WMS_URL`. This is intended for the Bureau's registered GIS/radar service once endpoint details are confirmed.

## Current project status

The repository contains the first implementation scaffold:

- outage ingestion
- LGA boundary ingestion
- exact warning-polygon ingestion from a configurable GeoJSON URL
- combined-warning extent calculation
- static PNG map renderer with legends and source timestamps
- WMS radar overlay support
- machine-readable generation manifest
- GitHub Pages frontend
- manually runnable and scheduled GitHub Actions workflow
- demo-mode geometry for renderer testing only

The application **does not pretend there are no warnings when the BOM spatial source is not configured**. It reports `source_unconfigured` distinctly from `no_active_warnings`.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m src.generate --demo
```

On Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m src.generate --demo
```

Demo mode creates a synthetic Southeast Queensland warning polygon so the map renderer can be developed without misrepresenting it as live BOM data.

## Live configuration

```text
BOM_WARNING_GEOJSON_URL=https://...
BOM_RADAR_WMS_URL=https://...
BOM_RADAR_WMS_LAYER=...
```

The warning endpoint may return either a GeoJSON FeatureCollection or a single Feature. Features should contain polygon/multipolygon geometry. Useful properties include `product_id`, `warning_id`, `headline`, `issued`, `expires`, `warning_type` and `hazard`, but the parser tolerates other property names.

For a WMS radar source, the generator requests a transparent PNG in EPSG:4326 for the exact map extent.

## Output

Generated files are written under:

```text
site/generated/
  manifest.json
  warning-outages-combined.png
  warning-radar-combined.png
  warning-outages-<warning-id>.png
  warning-radar-<warning-id>.png
```

The manifest contains generation time, warning metadata, source health, map filenames and timestamps.

## Architecture

```text
BOM warning geometry ─┐
Power outage GeoJSON ─┼─> Python generator ─> PNG maps + manifest ─> GitHub Pages
QLD LGA boundaries ───┤
BOM radar WMS ────────┘
```

The frontend remains static. A future one-click generation button should call a tiny authenticated relay such as a Cloudflare Worker, which can safely dispatch the GitHub Actions workflow without exposing a GitHub token in browser JavaScript.

## Important source/licensing note

BOM's anonymous FTP products are useful for investigation and internal development, but BOM directs users intending to publish Bureau data toward Registered User Services. The production design therefore keeps BOM URLs configurable and is intended to use registered spatial/radar services rather than hard-wiring an unofficial or reverse-engineered endpoint.
