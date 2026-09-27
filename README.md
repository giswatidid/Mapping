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

## Camera PDF proof-of-concept test

**Not part of the operational map generator.** After signing in to ArcGIS,
open the same page with `?cameraPdfTest=1` to display a separate test-only
**Camera PDF lab**. It does not require an active warning.

1. **Test camera image retrieval** selects up to two sample cameras from
   each of the existing TMR traffic, TMR flood and BCC resilience sources.
   South East Queensland is the initial test region; flood cameras fall back
   to a statewide lookup if no local samples are found. If the QLDTraffic API
   is blocked, the app queries Queensland Government's public
   **StateRoadInformation MapServer/4** traffic-camera layer anonymously through
   the ArcGIS SDK. The test also queries the existing signed-in
   **Web Cameras - LIVE** ArcGIS layer (which includes both traffic and flood
   camera photographs), correlates traffic locations by geographic distance
   and overlapping location-name words, and prioritises current hosted
   Image_Url fields where the match is unambiguous. Unmatched public
   cameras retain their original links for diagnostics; no image URL or
   camera association is guessed. Direct links still require CORS permission
   for browser-side PDF embedding. The test attempts
   to retrieve actual image bytes (not merely display a camera link) and
   reports per-source successes, failures and elapsed time. For TMR traffic
   cameras that cannot be fetched as image bytes, it additionally tests
   whether the browser can display the original camera URL at all. Distinct
   results distinguish a likely cross-origin embedding restriction from a
   blocked/unreachable image host. An **Open camera image** link lets the
   operator check the official public image directly. This test does not
   bypass CORS or introduce an image proxy; inaccessible cameras retain
   labelled placeholders in the PDF. No credentials,
   private service URLs or image bytes are logged or sent to GitHub.
2. **Generate sample PDF** produces a local landscape A4 PDF with an
   illustrative geographic overview map on page one, clickable numbered
   camera markers and six snapshot tiles arranged in **three columns by two
   rows** per subsequent page. Nearby camera pins are separated using small
   leader lines; intentional test-only layout repeats do not create duplicate
   map pins. Available images are embedded as JPEGs; failed images are explicit
   placeholders. Source update timestamps are converted to AEST where possible,
   and are displayed separately from the actual image retrieval time. An
   update timestamp must not be interpreted as a verified image capture time.
   A signed-in ArcGIS Topographic basemap is attempted but is optional.
   The PDF is labelled `TEST ONLY` and is not a weather-warning product.
   It has internal map/page and page/map navigation.
3. For 18- and 36-slot **layout/performance tests**, the same available
   samples repeat and are marked as layout repeats. This tests document
   size/layout, **not** retrieval of 18 or 36 unique live cameras.

The test-only PDF library is a **bundled, pinned jsPDF 2.5.2 copy** with
its upstream licence in `vendor/`. Its UMD entry has a browser-export
compatibility adjustment to avoid AMD loader collisions in the ArcGIS page.
The prototype checks that the library can generate a real PDF before proceeding.
It loads on demand only after pressing
Generate sample PDF, without requiring a corporate browser to reach a
third-party PDF CDN. Test mode is remembered for one hour in the same tab
so that the ArcGIS organisation's OAuth redirect can complete without losing
it; use **Exit test mode** to clear that flag. The diagnostic lab remains separate from the permanent report and continues
to test six slots, as well as intentional 18- and 36-slot layout repeats.
The lab and production report now share strict public/live TMR matching,
JPEG conversion, marker deconfliction and the bundled AMD-safe jsPDF loader.

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

### Testing the production report when there is no live warning

Use the existing [opt-in Camera PDF lab](https://giswatidid.github.io/Mapping/?cameraPdfTest=1#cameraPdfLab).
After **1. Test camera image retrieval** has found sample cameras, press
**3. Test production Camera PDF (simulated area)**. This invokes the same
production image download, verified-image eligibility, map, numbered markers,
index links and six-camera-per-page PDF code as the real report. The only
substitution is a **synthetic geographic selection mask** around those sample
camera locations: no BoM warning is simulated as a real observation and no
normal JPEG workflow or existing warning detection is altered. The synthetic
mask is NOT a real Queensland-clipped WMS warning. Every diagnostic page is
prominently marked **TEST ONLY - NOT AN ACTIVE WARNING**, and the downloaded
filename starts with `TEST-SIMULATED-`. The test includes only truly
retrievable image bytes (unlike the original layout-only sample PDF, which
retains placeholders for diagnostics). Test progress and a separate Cancel
button appear in the lab; the normal production button stays disabled when
no real warning has been detected. If all sources are unavailable, no PDF is
generated. A signed-in browser is required to validate actual authenticated
image retrieval; no server or proxy is involved.

The existing **2. Generate original layout-test PDF** is preserved for six,
18 and 36 repeated-slot layout troubleshooting, and is deliberately separate
from the new end-to-end production test.

The report is a **snapshot, not a live camera feed**. No private ArcGIS
organisation URL, item ID, token or camera image is persisted in the repo,
uploaded to another server or sent to GitHub. A signed-in browser must still
verify access to each live image source and its CORS settings.

Run the static JavaScript/eligibility/navigation test suite with
`node --test tests/camera-pdf.test.cjs` (also run in GitHub Actions on push).
The opt-in `?cameraPdfTest=1#cameraPdfLab` remains available for signed-in
image retrieval diagnostics and stress-test PDFs.

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
