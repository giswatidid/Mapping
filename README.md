# Queensland Severe Thunderstorm Mapping

Browser-based operational mapping for Queensland severe thunderstorms.

The live application is:

https://giswatidid.github.io/Mapping/

## Operational products

The application is intentionally limited to two products:

1. **Warning + Radar**
2. **Warning + Infrastructure Impacts**

When multiple severe-thunderstorm warnings are active, they are treated as one combined operational extent. When no warning is active, the same two products use a statewide Queensland extent.

## Authentication and privacy

The public repository is organisation-agnostic.

At runtime the user enters an ArcGIS Online organisation prefix and authenticates through that organisation's normal ArcGIS/SSO flow using the generic external OAuth application.

The repository does **not** contain:

- an organisation-specific ArcGIS URL
- private ArcGIS item IDs
- private WMS service URLs
- ArcGIS access tokens
- client secrets
- private rendered weather output

Resolved ArcGIS item IDs are cached only in browser localStorage for the signed-in organisation.

## Standard authenticated weather feeds

After sign-in the application automatically locates these shared ArcGIS WMS items by title and verifies the exact operational sublayer.

### Severe thunderstorm warning

Parent WMS item title:

`BoM Severe Weather Warning WMS APIM PRD`

Required sublayer:

`Severe Thunderstorm Warning | Australia`

### Radar

Parent WMS item title:

`BoM Radar WMS APIM PRD`

Required sublayer:

`Radar Rain Rate | Australia | raster`

The item IDs and service URLs are discovered after authentication and are never hard-coded in the repository.

The application restricts each WMS to the required operational sublayers rather than rendering every layer exposed by the service. The warning WMS can optionally add storm-cell and storm-direction overlays without changing warning-extent detection. The UTC storm-cell time layer is intentionally excluded.

## Public infrastructure sources

### Power outages

Current unplanned outages:

`https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson`

Polygon/MultiPolygon outage geometry is retained. Points are used only when the upstream source genuinely provides point geometry.

### Road conditions

Live QLD Traffic events:

`https://data.qldtraffic.qld.gov.au/events_v2.geojson`

The operational rules remain:

- future events are ignored until their start time
- expired events are ignored
- only current/published events are used
- area-alert polygons are contextual and are not treated as road closures unless explicit road-line geometry is supplied
- full closures/impassable roads are red
- restrictions/conditional access are amber
- statewide quiet-day products suppress conditional restrictions to avoid clutter

## Queensland reference data

Queensland Government ArcGIS FeatureServers provide:

- LGA boundaries: `Boundaries/AdminBoundariesFramework/FeatureServer/11`
- coastline: `Basemaps/FoundationData/FeatureServer/55`
- state border: `Basemaps/FoundationData/FeatureServer/5`
- mainland/land polygon: `Location/GeographicalFeatures/FeatureServer/90`
- population centres: `Location/Places/FeatureServer/20`
- major roads: `Basemaps/FoundationData/FeatureServer/23`

The true coastline/state border is used rather than the offshore outer edge of LGA administrative polygons.

## Current architecture

```text
Browser
  ↓
generic ArcGIS organisation-prefix login
  ↓
ArcGIS OAuth / organisation SSO
  ↓
authenticated shared WMS discovery
  ├─ severe-thunderstorm warning WMS
  └─ radar rain-rate WMS
  ↓
public Queensland outage / road / reference data
  ↓
client-side map rendering
  ↓
two browser-generated JPEG products
```

Private weather data is not sent to GitHub Actions and is not committed to the repository.

## GitHub Actions

There is **no live scheduled map-generation workflow**.

The former server-side generation workflow and Cloudflare workflow-dispatch relay have been removed because authenticated ArcGIS data must be accessed in the signed-in browser session.

`.github/workflows/test-demo-maps.yml` remains **manual-only** as a synthetic renderer-development aid. It does not publish live operational maps.

## Cartographic priorities

### Warning + Radar

Bottom to top:

1. restrained land/water context
2. major roads and selected population centres
3. LGA boundaries/names
4. severe-thunderstorm warning
5. radar
6. warning outline/operational emphasis

### Warning + Infrastructure Impacts

Bottom to top:

1. restrained land/water context
2. major roads and selected population centres
3. LGA boundaries/names
4. severe-thunderstorm warning
5. power outage polygons
6. road closures/restrictions
7. outage customer labels

On active-warning maps, LGA labels provide low-priority background context. On statewide quiet-day maps, LGA labels are suppressed.

## Legacy Python renderer

The repository still contains the earlier Python renderer and synthetic tests as development/reference code while the browser renderer reaches full parity.

It is not used for live authenticated ArcGIS map generation and no automatic workflow invokes it.
