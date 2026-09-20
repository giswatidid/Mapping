# Queensland Warning Mapping

Browser-based operational mapping for Queensland severe thunderstorms, severe weather and flooding.

The live application is:

https://giswatidid.github.io/Mapping/

## Warning tabs

The browser app has three operational tabs:

1. **Severe Thunderstorm**
   - `IDZ20006` Severe Thunderstorm Warning
   - optional `IDZ20007` storm cell and `IDZ20007_track` storm direction overlays
   - extent detection always uses only `IDZ20006`
2. **Severe Weather**
   - `IDZ20005` Severe Weather Warning
3. **Flooding**
   - `IDZ20013` Flood Warning
   - `IDZ20016` Flood Watch
   - Flood Warning/Watch selection determines the output extent rather than combining every flood product in Queensland

The flood selector is warning/watch driven. A Flood Warning can contain multiple catchments. The app first tries the authenticated WMS `GetFeatureInfo` response for a stable product/event identifier. For Flood Warnings it also uses the Bureau's public Flood Warning Catchments reference layer and its `product_id` field as a grouping fallback. If a Flood Watch does not expose a product identifier, the app lists its separate detected watch areas rather than incorrectly merging all watches statewide.

## Operational products

Every tab produces exactly two final JPEG products:

1. **Warning/Watch + Radar**
2. **Warning/Watch + Infrastructure Impacts**

For Severe Thunderstorm and Severe Weather, multiple active polygons are combined into the detected warning extent. If no active product is detected, the same two products use a statewide Queensland extent.

For Flooding, the user selects one active Flood Warning or Flood Watch. The selected product controls the output extent; both flood-warning and flood-watch overlays remain visible inside that extent. If no active flood product is detected, statewide output remains available.

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

Resolved ArcGIS item IDs are cached only in browser localStorage for the signed-in organisation. Registered WMS GetMap parameters remain in memory and are reused for operational rendering; they are not displayed or persisted.

## Standard authenticated weather feeds

### Warning WMS

Parent WMS item title:

`BoM Severe Weather Warning WMS APIM PRD`

Operational layer mappings used by the app:

- `IDZ20005` — Severe Weather Warning
- `IDZ20006` — Severe Thunderstorm Warning
- `IDZ20007` — Severe Thunderstorm Warning Storm Cell
- `IDZ20007_track` — Severe Thunderstorm Warning Storm Direction
- `IDZ20013` — Flood Warning
- `IDZ20013_label` — Flood Warning Catchment Name
- `IDZ20016` — Flood Watch
- `IDZ20016_label` — Flood Watch Catchment Name

The UTC storm-cell time layer remains intentionally excluded.

### Radar

Parent WMS item title:

`BoM Radar WMS APIM PRD`

Required sublayer:

`IDR00010` — Radar Rain Rate | Australia | raster

The item IDs and service URLs are discovered after authentication and are never hard-coded in the repository.

## Administrative boundaries and affected areas

For **Severe Thunderstorm** and **Severe Weather**, the browser analyses the actual visible warning raster pixels against administrative polygon layers after generation. It reports:

- Local government areas intersected by the warning pixels
- Queensland disaster districts intersected by the warning pixels

The boundary sources are deterministic:

- **Local government** uses the Queensland Government `Boundaries/AdministrativeBoundaries/MapServer/1` polygon layer directly. Its display/name field is `lga`.
- **Disaster districts** are resolved after ArcGIS sign-in by the exact accessible service item title `District_Disaster_Management_Groups_DDMG_Boundary_Status_Url`. The app does not depend on the portal UI's item-type label; it verifies the service itself, then requires layer `0`, named `DDMG_websites`, polygon geometry, query support, and display/name field `PROP_DD`.

No private disaster-district item ID or service URL is hard-coded in the repository. The authenticated service URL is obtained from the matched ArcGIS item at runtime and remains in browser memory. The resolved item ID/layer identity may be cached locally for that signed-in organisation.

The affected-areas panel shows source state independently of warning activity. The Local government source should report **Public source** once its exact Queensland Government layer is verified. Disaster districts report **Authenticated** only after the exact ArcGIS item/layer checks pass; otherwise they report **Unavailable** rather than being inferred.

Administrative-source resolution does not block map generation. Raster intersection is based on the same warning mask used for warning extent detection, not the rectangular map extent. Severe Thunderstorm analysis uses only `IDZ20006`; optional storm-cell/direction overlays do not affect the LGA or disaster-district result.

## Warning-area traffic cameras

For **Severe Thunderstorm** and **Severe Weather**, the browser also checks the Queensland Department of Transport and Main Roads QLDTraffic web-camera feed after the warning mask has been detected.

- Source endpoint: `https://api.qldtraffic.qld.gov.au/v1/webcams`
- The API returns GeoJSON Point features with camera metadata and the latest JPEG `image_url`.
- TMR publishes a public developer API key for this feed; the public key is globally limited to 100 requests per minute.
- Camera points are tested against the **actual warning raster mask**, not merely the warning bounding extent.
- Only cameras inside warning pixels are listed.
- The app does **not** download or embed camera images. Each result provides a **View latest image** link that opens the TMR image in a new tab.
- Cameras are deliberately **not rendered onto either JPEG product**.

The camera lookup is non-blocking. Once the warning mask is available, the QLDTraffic request runs independently while the map context and JPEG products continue rendering, so a slow or unavailable camera feed does not delay map generation.

## Public infrastructure and reference sources

### Power outages

`https://raw.githubusercontent.com/gowlettluke/qldpoweroutages/main/data/current_outages.geojson`

Only current unplanned outages are mapped. Polygon/MultiPolygon geometry is retained; points are used only when the source genuinely has no polygon.

### Road conditions

`https://data.qldtraffic.qld.gov.au/events_v2.geojson`

Rules remain:

- future events are ignored until their start time
- expired events are ignored
- only current/published events are used
- area-alert polygons alone are not treated as closures
- full closures/impassable roads are red
- restrictions/conditional access are amber
- statewide quiet-day products suppress conditional restrictions

### Bureau flood-catchment reference data

Public Bureau FeatureServer layers are used only to help identify/group flood products:

- Flood Watch Catchments: `National_Flood_Gauge_Network/FeatureServer/0`
- Flood Warning Catchments: `National_Flood_Gauge_Network/FeatureServer/1`

They do not replace the authenticated active Flood Warning/Flood Watch WMS layers.

### Queensland Government reference data

- LGA boundaries: `Boundaries/AdministrativeBoundaries/MapServer/1`
- coastline: `Basemaps/FoundationData/FeatureServer/55`
- state border: `Basemaps/FoundationData/FeatureServer/5`
- mainland/land polygon: `Location/GeographicalFeatures/FeatureServer/90`
- population centres: `Location/Places/FeatureServer/20`
- major roads: `Basemaps/FoundationData/FeatureServer/23`

## Rendering architecture

```text
Browser
  ↓
generic ArcGIS organisation-prefix login
  ↓
ArcGIS OAuth / organisation SSO
  ↓
authenticated shared WMS discovery
  ├─ warning WMS
  │   ├─ severe thunderstorm
  │   ├─ severe weather
  │   └─ flood warning / flood watch
  └─ radar rain-rate WMS
  ↓
public Queensland infrastructure/reference data
  ↓
ArcGIS Topographic + shared EPSG:3857 render extent
  ↓
client-side composition
  ↓
two browser-generated JPEG products
```

The registered WMS request configuration is preserved so the browser does not rebuild the private service request from a bare URL.

## GitHub Actions

There is **no live scheduled map-generation workflow**.

`.github/workflows/test-demo-maps.yml` remains manual-only as a synthetic renderer-development aid. It does not publish live operational maps.

## Legacy Python renderer

The repository still contains the earlier Python renderer and synthetic tests as development/reference code. It is not used for live authenticated ArcGIS map generation.
