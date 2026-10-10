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

For Severe Thunderstorm and Severe Weather, multiple active polygons are combined into the detected warning extent **only where warning pixels overlap Queensland**. The browser loads the existing public Queensland Government Local government polygons alongside warning detection, builds a Queensland land-area mask (including LGA islands), and excludes NSW/NT/SA warning pixels before deciding whether there is an active Queensland warning. If none remain, the same two products use the statewide Queensland extent. Both JPEGs clip the severe-weather/thunderstorm warning overlay to those Queensland polygons; optional storm tracking is clipped too. Radar and base-map context are unchanged. If the Queensland boundary cannot be loaded and validated, generation reports an error rather than misclassifying interstate warnings.

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

The boundary sources are deterministic. The same public Local government polygons are also loaded in parallel with Severe Thunderstorm/Severe Weather detection and reused for the JPEG context, avoiding a duplicate statewide LGA request:

- **Local government** uses the Queensland Government `Boundaries/AdministrativeBoundaries/MapServer/1` polygon layer directly. Its display/name field is `lga`.
- **Disaster districts** are resolved after ArcGIS sign-in by the exact accessible service item title `District_Disaster_Management_Groups_DDMG_Boundary_Status_Url`. The app does not depend on the portal UI's item-type label; it verifies the service itself, then requires layer `0`, named `DDMG_websites`, polygon geometry, query support, and display/name field `PROP_DD`.

No private disaster-district item ID or service URL is hard-coded in the repository. The authenticated service URL is obtained from the matched ArcGIS item at runtime and remains in browser memory. The resolved item ID/layer identity may be cached locally for that signed-in organisation.

The affected-areas panel shows source state independently of warning activity. The Local government source should report **Public source** once its exact Queensland Government layer is verified. Disaster districts report **Authenticated** only after the exact ArcGIS item/layer checks pass; otherwise they report **Unavailable** rather than being inferred.

Administrative-source resolution does not block map generation. Raster intersection is based on the same warning mask used for warning extent detection, not the rectangular map extent. Severe Thunderstorm analysis uses only `IDZ20006`; optional storm-cell/direction overlays do not affect the LGA or disaster-district result.

## Warning-area camera links

On **Severe Thunderstorm** and **Severe Weather**, the browser lists matching
cameras from three independent sources in the **Cameras in warning area** panel:

- **TMR traffic cameras**: public QLDTraffic `/v1/webcams` GeoJSON with
  `image_url` links, using the official published developer API key. If this
  API fails on a restricted network, the browser tries the separate public
  Queensland Government StateRoadInformation MapServer layer 4, via anonymous
  ArcGIS request. Image freshness is not established by that fallback.
- **TMR flood cameras**: authenticated ArcGIS FeatureServer layer 0,
  `Flood Cameras` in service `Web Cameras - LIVE`, with `Location_Name`
  and `Image_Url` / numbered `Image_Url` fields. Valid links are listed
  without preloading any camera images.
- **BCC City Resilience cameras**: authenticated ArcGIS FeatureServer layer 0
  in service `BCC_City_Resilience_cameras_view`, with `location_name`,
  `event_status`, camera IDs and `image_last_updated`. The service declares
  image attachments rather than a direct image URL attribute. A camera's
  **View camera image** button fetches only one available image attachment
  after a user click through their signed-in ArcGIS session. A link to the
  authenticated ArcGIS item is supplied as a fallback when images are missing
  or require different permissions.

The two additional services are discovered using configured item-title
candidates and verified against their **exact service names, layer names,
point geometry and name-field schema**. Hosted-service URLs, portal item IDs,
ArcGIS access tokens and private images are not hard-coded in this repository
or inserted into public links.

Camera locations are checked against the **actual Queensland-clipped warning
raster mask** rather than the rectangular map extent. Sources run in parallel,
independently of JPEG generation; an unavailable camera layer cannot prevent
either map product from being generated. Camera photos are never automatically
loaded or drawn onto the JPEGs. The camera panel is hidden on the Flooding tab.

## Production Camera Situation Report (Severe Thunderstorm / Severe Weather)

After **Generate maps** and the independent camera-source queries finish,
**Generate Camera PDF** becomes available inside **Cameras in warning area**.
It acts on the last completed Queensland-clipped warning mask and matched
camera results; it neither reruns warning detection nor starts downloading
images or generating PDFs during the normal two-JPEG workflow. Changing tabs,
regenerating maps or losing the ArcGIS feed invalidates the old report
context. Flooding retains its original behaviour and has no camera PDF.

The user-initiated action correlates the already-fetched public traffic
camera locations with the already-fetched authenticated Web Cameras - LIVE
layer. Matches require meaningful name overlap and geographic proximity;
ambiguous matches are discarded. Unmatched traffic cameras retain their
original source image URLs. Authenticated BCC attachments are retrieved on
demand through the existing session; requests remain entirely in the browser.
Image downloads run at controlled concurrency (three at a time), with
per-image timeouts, progress counts, partial-failure handling and a Cancel
button. Unavailable/CORS-blocked images are simply excluded. Public source
queries and links in the ordinary camera panel are unchanged.

**Eligibility is determined after actual image bytes are successfully
decoded and transcoded to JPEG.** A documented, explicitly named image
capture timestamp is checked only if it parses unambiguously (UTC/offset ISO
8601 or Unix seconds/milliseconds): photographs more than 60 minutes old
at report assembly are excluded. If no such verified capture timestamp is
available, the photograph is eligible but is labelled **Image time unknown**;
its actual **retrieval time** is displayed separately. Ordinary record-edit,
service-update, HTTP Last-Modified, BCC `image_last_updated` and attachment
edit timestamps are deliberately **not** treated as photograph capture time.
A malformed or timezone-free capture date is also treated as unknown.
Images cannot be deemed current merely because they were downloaded now.
When no eligible photos remain, the UI explains the result and creates
**no empty PDF**.

The self-contained, browser-generated **landscape A4** report includes:
- Page 1: warning type, AEST report-generation timestamp, ArcGIS topographic
  basemap where available, the **stored Queensland warning detection mask**
  shaded onto that basemap, numbered eligible-camera pins with leader lines,
  clickable snapshot-page links, and a clickable camera index. A geographic
  reference grid is shown if the basemap is unavailable. The warning shading
  represents the detected clipped raster pixels, **not** a newly requested
  live WMS or an authoritative vector boundary.
- Subsequent pages: precisely the available eligible photos (up to six per
  page), in three columns by two rows with no excluded-camera placeholders,
  camera name/source, verified capture time or **Image time unknown**, separate
  AEST image-retrieval time, back-to-map link and page numbers.
- Camera indices list each camera through 62 eligible images; exceptionally
  large reports index inclusive six-camera snapshot-page ranges so every
  snapshot page remains navigable.

### Validation

The camera PDF diagnostic section and test launcher have been removed from the live site. Production camera reports remain available after generating maps with an active warning.

The report is a **snapshot, not a live camera feed**. No private ArcGIS
organisation URL, item ID, token or camera image is persisted in the repo,
uploaded to another server or sent to GitHub. A signed-in browser must still
verify access to each live image source and its CORS settings.

Run the static JavaScript/eligibility/navigation test suite with
`node --test tests/camera-pdf.test.cjs` (also run in GitHub Actions on push).

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



### Live-storm export improvements (6 October 2026)

- Regional warning maps now retain at least 180 km of horizontal context and
  expand larger warning extents by 40% on each side. Both JPEGs share the actual
  ArcGIS basemap extent. Warning imagery remains clipped to Queensland; the
  surrounding basemap may show neighbouring states for context.
- Every map layer is clipped to the map frame before drawing, preventing LGA
  boundaries, roads, outage geometry and labels from entering the heading or
  legend. LGA labels are kept inside the frame.
- Severe thunderstorm and severe weather detection first scans Queensland,
  then scans the detected region at up to 1600 pixels on the longest side with
  single-pixel samples. The local WMS image aspect matches its geographic
  extent. This refined mask drives camera selection, affected-area analysis
  and the PDF warning approximation. If refinement fails or the warning
  disappears, generation stops and reports the error; it does not silently use
  coarse camera selection. Flooding retains its product/component scan.
- JPEGs and camera overview maps include a latitude-corrected distance scale
  and a Queensland locator where boundary geometry is available. JPEG subtitles
  name affected LGAs when known.
- Original BoM storm tracking is opt-in on the infrastructure map only. It is
  always omitted from radar maps because its white forecast circles obscure
  rain returns. The revised preference starts off; existing preferences for
  the old overlay do not re-enable it. A separate edge derived from the native
  yellow thunderstorm warning fill is drawn above radar.
- Generation time is separate from explicit source observation/issue times.
  Times absent from the registered layer are omitted from the export. Portal
  modification dates and ambiguous timestamps are never substituted.
- Camera PDFs filter the known TMR "Photo Not Available" graphic using a
  small luminance fingerprint before assigning camera numbers. This match
  tolerates ordinary image compression and resizing, and does not reject a
  photograph merely because it is dark. Other unknown placeholder graphics
  may require additional reference fingerprints. Camera failures/placeholders
  and stale images are counted separately in progress; the PDF records the
  excluded total. Unknown capture times remain explicitly labelled.
- Snapshot pages adapt for one to six photographs; camera headings and the
  small-report index wrap. The PDF boundary legend identifies the warning
  area as a refined raster approximation rather than authoritative vector
  geometry. Contiguous mask runs are painted together for performance.

Validation: `node --test tests/*.cjs` covers eligibility, placeholder exclusion
before numbering, cancellation, pagination/navigation, regional bounds, scale,
local raster registration and map-frame clipping. Regenerate with an authenticated live warning to confirm the source-specific imagery and timestamps.



### Consistent JPEG warning outlines and concise footer

Both thunderstorm JPEGs now use the same warning-outline raster, colour and
stroke width, derived once from their shared warning image and drawn using the
same map extent. The radar outline remains above radar; on infrastructure it
is above storm tracking and below outage/road symbols.

Footers retain generation time, source credits and required basemap attribution.
Explicit observation/issue timestamps are included only when available; absent
or ambiguous times produce no placeholder text or empty row. Infrastructure
maps only show a warning timestamp, since they do not contain radar. Generation
times use 24-hour AEST, and regional subtitles avoid repeated council suffixes.

### Queensland locator inset

The two JPEG maps use the official Queensland Mainland polygon for the grey
locator silhouette. This polygon comes from the coastline and state-border
datasets, rather than LGA polygons with offshore administrative areas. The
full-state geometry is loaded once per page and simplified only for the small
inset; both products retain the same red map-location box. If this source is
unavailable, the inset is omitted and retried on the next generation. Main-map
LGA boundaries, warning clipping and the Camera Situation Report are unchanged.
