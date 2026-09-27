(() => {
  const cfg = window.MAPPING_CONFIG || {};
  const publicSources = cfg.publicSources || {};
  const renderCfg = cfg.rendering || {};
  const QLD_EXTENT = renderCfg.qldExtent || [137.7, -29.3, 154.2, -9.0];
  const OUTPUT_SR = Number(renderCfg.outputSpatialReference || 3857);
  const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
  const generateButton = document.querySelector("#generateButton");
  const mapsEl = document.querySelector("#maps");
  const emptyEl = document.querySelector("#emptyState");
  const statusCard = document.querySelector("#statusCard");
  const statusBadge = document.querySelector("#statusBadge");
  const statusTitle = document.querySelector("#statusTitle");
  const statusMessage = document.querySelector("#statusMessage");
  const generatedAt = document.querySelector("#generatedAt");
  const warningCount = document.querySelector("#warningCount");
  const modeEl = document.querySelector("#mode");
  const cellTrackingToggle = document.querySelector("#cellTrackingToggle");
  const trackingToggleLabel = document.querySelector("#trackingToggleLabel");
  const warningLayerDetail = document.querySelector("#warningLayerDetail");
  const mapProductsDescription = document.querySelector("#mapProductsDescription");
  const profileButtons = [...document.querySelectorAll("[data-warning-profile]")];
  const floodSelectionPanel = document.querySelector("#floodSelectionPanel");
  const floodCandidateList = document.querySelector("#floodCandidateList");
  const floodSelectionStatus = document.querySelector("#floodSelectionStatus");
  const floodSelectionNote = document.querySelector("#floodSelectionNote");
  const refreshFloodProductsButton = document.querySelector("#refreshFloodProducts");
  const affectedAreasPanel = document.querySelector("#affectedAreasPanel");
  const affectedAreasStatus = document.querySelector("#affectedAreasStatus");
  const affectedLgaCount = document.querySelector("#affectedLgaCount");
  const affectedLgaList = document.querySelector("#affectedLgaList");
  const affectedLgaSource = document.querySelector("#affectedLgaSource");
  const affectedLgaSourceState = document.querySelector("#affectedLgaSourceState");
  const affectedDistrictCount = document.querySelector("#affectedDistrictCount");
  const affectedDistrictList = document.querySelector("#affectedDistrictList");
  const affectedDistrictSource = document.querySelector("#affectedDistrictSource");
  const affectedDistrictSourceState = document.querySelector("#affectedDistrictSourceState");
  const cameraPanel = document.querySelector("#cameraPanel");
  const cameraStatus = document.querySelector("#cameraStatus");
  const cameraList = document.querySelector("#cameraList");
  const TRACKING_PREF_KEY = "mapping.includeThunderstormCellTracking";
  const PROFILE_PREF_KEY = "mapping.warningProfile";
  const PROFILES = cfg.arcgis?.warningProfiles || {};

  let outputUrls = [];
  let feedsReady = false;
  let generating = false;
  let scanningFloods = false;
  let floodScanned = false;
  let floodCandidates = [];
  let selectedFloodCandidateId = null;
  let cameraAnalysisRun = 0;
  let queenslandBoundaryPromise = null;
  const adminBoundaryState = {
    localGovernment: { status: "resolving", layer: null, error: "" },
    disasterDistricts: { status: "resolving", layer: null, error: "" }
  };

  function storedProfileKey() {
    try {
      const saved = localStorage.getItem(PROFILE_PREF_KEY);
      if (saved && PROFILES[saved]) return saved;
    } catch {}
    return PROFILES.thunderstorm ? "thunderstorm" : Object.keys(PROFILES)[0];
  }

  let activeProfileKey = storedProfileKey();

  // Same BOM rain-rate key used by the previous registered-WMS renderer.
  const RAIN_RATE_LEGEND = [
    ["<2", "#f5f5ff"],
    ["2–3", "#b4b4ff"],
    ["3–5", "#7878ff"],
    ["5–7", "#1414ff"],
    ["7–10", "#00d8c3"],
    ["10–15", "#009690"],
    ["15–25", "#006666"],
    ["25–35", "#ffff00"],
    ["35–55", "#ffc800"],
    ["55–80", "#ff9600"],
    ["80–120", "#ff6400"],
    ["120–180", "#ff0000"],
    ["180–270", "#c80000"],
    ["270–400", "#780000"],
    ["400+", "#280000"]
  ];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function loadTrackingPreference() {
    try {
      return localStorage.getItem(TRACKING_PREF_KEY) === "true";
    } catch {
      return false;
    }
  }

  function saveTrackingPreference(enabled) {
    try {
      localStorage.setItem(TRACKING_PREF_KEY, String(Boolean(enabled)));
    } catch {}
  }

  function currentProfile() {
    return PROFILES[activeProfileKey] || PROFILES.thunderstorm || {
      key: "thunderstorm",
      label: "Severe Thunderstorm",
      outputTitle: "Severe Thunderstorm Warning",
      detectionSublayerTitles: ["Severe Thunderstorm Warning | Australia"],
      renderSublayerTitles: ["Severe Thunderstorm Warning | Australia"],
      supportsTracking: true,
      trackingSublayerTitles: [
        "Severe Thunderstorm Warning Storm Direction | Australia",
        "Severe Thunderstorm Warning Storm Cell | Australia"
      ],
      legendLabel: "Severe thunderstorm warning",
      filenamePrefix: "warning",
      activeScopeLabel: "severe-thunderstorm warning"
    };
  }

  function profileTitles(profile, key) {
    const values = profile?.[key];
    return Array.isArray(values) ? values.filter(Boolean) : [];
  }

  function trackingTitles(profile=currentProfile()) {
    return profile?.supportsTracking
      ? profileTitles(profile, "trackingSublayerTitles")
      : [];
  }

  function updateWarningSourceDetail(profile=currentProfile()) {
    if (!warningLayerDetail) return;
    const titles = profileTitles(profile, "renderSublayerTitles");
    warningLayerDetail.textContent = (titles.length > 1 ? "Sublayers: " : "Sublayer: ") + titles.join(" + ");
  }

  function updateProfileControls() {
    const profile = currentProfile();
    const isFlooding = profile.key === "flooding";

    profileButtons.forEach((button) => {
      const active = button.dataset.warningProfile === activeProfileKey;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });

    if (trackingToggleLabel) trackingToggleLabel.hidden = !profile.supportsTracking;
    if (floodSelectionPanel) floodSelectionPanel.hidden = !isFlooding;
    if (affectedAreasPanel) affectedAreasPanel.hidden = isFlooding;
    if (cameraPanel) cameraPanel.hidden = isFlooding;
    if (mapProductsDescription) {
      mapProductsDescription.textContent = isFlooding
        ? "Exactly two products are generated for the selected Flood Warning or Flood Watch: Warning/Watch + Radar and Warning/Watch + Infrastructure Impacts."
        : "Exactly two products are generated for the selected warning type: Warning + Radar and Warning + Infrastructure Impacts.";
    }

    updateWarningSourceDetail(profile);
    updateGenerateState();
  }

  function updateGenerateState() {
    if (!generateButton) return;
    const profile = currentProfile();
    const needsFloodSelection = profile.key === "flooding" && floodCandidates.length > 0 && !selectedFloodCandidateId;
    const waitingForFloodScan = profile.key === "flooding" && !floodScanned;
    generateButton.disabled = !feedsReady || generating || scanningFloods || needsFloodSelection || waitingForFloodScan;
    generateButton.textContent = generating ? "Generating…" : "Generate maps";

    if (refreshFloodProductsButton) {
      refreshFloodProductsButton.disabled = !feedsReady || scanningFloods || generating;
      refreshFloodProductsButton.textContent = scanningFloods ? "Scanning…" : "Refresh active flood products";
    }
  }

  function clearGeneratedProducts(message) {
    revokeOutputs();
    cameraAnalysisRun += 1;
    resetAffectedAreas();
    resetCameraPanel();
    if (mapsEl) mapsEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent = message;
    }
    if (generatedAt) generatedAt.textContent = "—";
  }

  function setActiveProfile(key, { persist=true, scanFloods=true }={}) {
    if (!PROFILES[key] || key === activeProfileKey && profileButtons.length === 0) return;
    activeProfileKey = key;
    if (persist) {
      try { localStorage.setItem(PROFILE_PREF_KEY, key); } catch {}
    }

    const profile = currentProfile();
    clearGeneratedProducts(
      profile.key === "flooding"
        ? "Select an active Flood Warning or Flood Watch before generating the two map products."
        : "Generate the two current " + profile.label.toLowerCase() + " map products."
    );
    if (warningCount) warningCount.textContent = "—";
    if (modeEl) modeEl.textContent = profile.label;
    updateProfileControls();

    if (feedsReady) {
      setStatus(
        "ok",
        profile.label + " mapping ready",
        profile.key === "flooding"
          ? "Scanning identifies active flood warning/watch products; select one product to control the map extent."
          : "Generate maps to detect the current " + profile.activeScopeLabel + " extent and compose the two products.",
        "Ready"
      );
    }

    if (profile.key === "flooding" && feedsReady && scanFloods && !scanningFloods) {
      scanFloodProducts().catch(() => {});
    }
  }

  function setBoundarySourceBadge(element, status, label) {
    if (!element) return;
    element.textContent = label;
    element.className = "boundary-source-status " + (
      status === "ok" ? "ok" : (status === "warning" ? "warning" : "error")
    );
  }

  function boundaryPathLabel(layer) {
    const path = Array.isArray(layer?.path) ? layer.path.filter(Boolean) : [];
    if (path.length) return path.join(" › ");
    return layer?.title || layer?.itemTitle || "";
  }

  function renderBoundarySourceState() {
    const lga = adminBoundaryState.localGovernment;
    const district = adminBoundaryState.disasterDistricts;

    if (lga.status === "public") {
      setBoundarySourceBadge(affectedLgaSourceState, "ok", "Public source");
      if (affectedLgaSource) {
        affectedLgaSource.textContent = "Queensland Government Local government layer connected: AdministrativeBoundaries › Local government.";
      }
    } else if (lga.status === "authenticated") {
      setBoundarySourceBadge(affectedLgaSourceState, "ok", "Authenticated");
      if (affectedLgaSource) {
        const path = boundaryPathLabel(lga.layer);
        affectedLgaSource.textContent = "Authenticated ArcGIS layer connected" + (path ? ": " + path + "." : ".");
      }
    } else if (lga.status === "unavailable") {
      setBoundarySourceBadge(affectedLgaSourceState, "error", "Unavailable");
      if (affectedLgaSource) {
        affectedLgaSource.textContent = "Queensland Government Local government layer could not be verified.";
      }
    } else {
      setBoundarySourceBadge(affectedLgaSourceState, "warning", "Resolving");
      if (affectedLgaSource) {
        affectedLgaSource.textContent = "Searching the signed-in ArcGIS content for the Local government polygon layer; public LGA boundaries remain available as fallback.";
      }
    }

    if (district.status === "authenticated") {
      setBoundarySourceBadge(affectedDistrictSourceState, "ok", "Authenticated");
      if (affectedDistrictSource) {
        const path = boundaryPathLabel(district.layer);
        affectedDistrictSource.textContent = "Authenticated ArcGIS layer connected" + (path ? ": " + path + "." : ".");
      }
    } else if (district.status === "unavailable") {
      setBoundarySourceBadge(affectedDistrictSourceState, "error", "Unavailable");
      if (affectedDistrictSource) {
        affectedDistrictSource.textContent = district.error
          ? "Unavailable: " + district.error
          : "Disaster District service could not be resolved from accessible ArcGIS content.";
      }
    } else {
      setBoundarySourceBadge(affectedDistrictSourceState, "warning", "Resolving");
      if (affectedDistrictSource) {
        affectedDistrictSource.textContent = "Searching the signed-in ArcGIS content for Queensland Disaster District Management Groups.";
      }
    }
  }

  function updateBoundaryDiscoveryState(detail={}) {
    for (const key of ["localGovernment", "disasterDistricts"]) {
      const result = detail?.[key];
      if (!result) continue;
      adminBoundaryState[key] = result.ok
        ? {
            status: result.layer?.sourceType === "public" ? "public" : "authenticated",
            layer: result.layer || null,
            error: ""
          }
        : { status: "unavailable", layer: null, error: String(result.error || "") };
    }
    renderBoundarySourceState();
  }

  function resetAffectedAreas(message="Generate a Severe Thunderstorm or Severe Weather map to analyse affected areas.") {
    if (affectedAreasStatus) affectedAreasStatus.textContent = "Generate to analyse";
    if (affectedLgaCount) affectedLgaCount.textContent = "—";
    if (affectedDistrictCount) affectedDistrictCount.textContent = "—";
    if (affectedLgaList) affectedLgaList.textContent = message;
    if (affectedDistrictList) affectedDistrictList.textContent = message;
    renderBoundarySourceState();
  }

  function renderAffectedAreas(result) {
    if (!result || currentProfile().key === "flooding") return;

    if (!result.active) {
      if (affectedAreasStatus) affectedAreasStatus.textContent = "No active warning";
      if (affectedLgaCount) affectedLgaCount.textContent = "0";
      if (affectedDistrictCount) affectedDistrictCount.textContent = "0";
      if (affectedLgaList) affectedLgaList.textContent = "No active warning pixels detected in Queensland.";
      if (affectedDistrictList) affectedDistrictList.textContent = "No active warning pixels detected in Queensland.";
      return;
    }

    const lgas = result.lgas || [];
    const districts = result.districts || [];
    if (affectedAreasStatus) {
      const districtSummary = result.districtAvailable
        ? districts.length + " district" + (districts.length === 1 ? "" : "s")
        : "districts unavailable";
      affectedAreasStatus.textContent = lgas.length + " LGA" + (lgas.length === 1 ? "" : "s") +
        " · " + districtSummary;
    }
    if (affectedLgaCount) affectedLgaCount.textContent = String(lgas.length);
    if (affectedDistrictCount) affectedDistrictCount.textContent = result.districtAvailable ? String(districts.length) : "—";
    if (affectedLgaList) {
      affectedLgaList.textContent = lgas.length ? lgas.join(" · ") : "No LGA intersections detected.";
    }
    if (affectedDistrictList) {
      affectedDistrictList.textContent = result.districtAvailable
        ? (districts.length ? districts.join(" · ") : "No disaster-district intersections detected.")
        : "Disaster districts are not available for this run. Layer discovery may still be completing in the background.";
    }
    // Source availability is displayed independently from the warning result.
    // A run may use the public LGA fallback while private discovery continues.
    if (result.lgaSource === "public") {
      adminBoundaryState.localGovernment.status = "public";
    } else if (result.lgaSource === "authenticated") {
      adminBoundaryState.localGovernment.status = "authenticated";
    }
    if (result.districtAvailable) {
      adminBoundaryState.disasterDistricts.status = "authenticated";
    }
    renderBoundarySourceState();
  }

  function resetCameraPanel(message="Generate a Severe Thunderstorm or Severe Weather map to find cameras inside the warning area.") {
    if (cameraStatus) cameraStatus.textContent = "Generate to analyse";
    if (!cameraList) return;
    cameraList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state camera-empty";
    empty.textContent = message;
    cameraList.appendChild(empty);
  }

  function warningMaskContainsPoint(mask, coordinates) {
    if (!mask?.visible || !Array.isArray(coordinates) || coordinates.length < 2) return false;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;

    const [xmin, ymin, xmax, ymax] = mask.extent || QLD_EXTENT;
    if (lon < xmin || lon > xmax || lat < ymin || lat > ymax) return false;

    const px = (lon - xmin) / Math.max(Number.EPSILON, xmax - xmin) * mask.width;
    const py = (ymax - lat) / Math.max(Number.EPSILON, ymax - ymin) * mask.height;
    const gx = clamp(Math.floor(px / mask.step), 0, mask.gridWidth - 1);
    const gy = clamp(Math.floor(py / mask.step), 0, mask.gridHeight - 1);
    return Boolean(mask.visible[gy * mask.gridWidth + gx]);
  }

  function safeCameraImageUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      if (url.protocol === "http:" && url.hostname.endsWith("qldtraffic.qld.gov.au")) {
        url.protocol = "https:";
      }
      return url.toString();
    } catch {
      return "";
    }
  }

  function normaliseTrafficCamera(feature) {
    if (feature?.geometry?.type !== "Point") return null;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const props = feature.properties || {};
    const imageUrl = safeCameraImageUrl(props.image_url);
    if (!imageUrl) return null;

    const description = String(props.description || "").trim();
    const locality = String(props.locality || "").trim();
    const direction = String(props.direction || "").trim();
    const district = String(props.district || "").trim();
    const postcode = String(props.postcode || "").trim();

    return {
      id: String(props.id ?? imageUrl),
      coordinates: [Number(coordinates[0]), Number(coordinates[1])],
      description: description || locality || "QLDTraffic camera",
      locality,
      direction,
      district,
      postcode,
      imageUrl
    };
  }

  const CAMERA_SOURCES = [
    { key: "tmr", title: "TMR traffic cameras" },
    { key: "floodCameras", title: "TMR flood cameras" },
    { key: "bccResilience", title: "BCC City Resilience cameras" }
  ];

  function normaliseHostedCamera(feature, kind, source) {
    if (feature?.geometry?.type !== "Point" ||
        !Array.isArray(feature.geometry.coordinates)) return null;
    const props = feature.properties || {};
    const isFlood = kind === "floodCameras";
    const name = String(props.Location_Name || props.location_name || "Camera").trim();
    const objectId = props[source.objectIdField || "OBJECTID"] ??
      props.OBJECTID ?? props.objectid;
    const links = isFlood
      ? Object.entries(props)
        .filter(([field]) => /^image_?url[0-9]*$/i.test(field))
        .sort(([a],[b]) => {
          const number = (field) => Number(field.match(/[0-9]+$/)?.[0] || 0);
          return number(a)-number(b);
        })
        .map(([field,value]) => ({
          label: "Image " + (field.match(/[0-9]+$/)?.[0] || "1"),
          url: safeCameraImageUrl(value)
        }))
        .filter((entry,index,all) =>
          entry.url && all.findIndex((other)=>other.url===entry.url)===index
        )
      : [];
    const subtitle = isFlood
      ? [props.Local_Government_Name,props.Direction].filter(Boolean).join(" · ")
      : [props.camera_source,props.event_status,
          props.image_last_updated
            ? "Updated: "+String(props.image_last_updated) : ""
        ].filter(Boolean).join(" · ");
    return {
      description:name,
      coordinates:feature.geometry.coordinates,
      subtitle,links,kind,objectId,
      hasAttachments:Boolean(source.hasAttachments),
      portalItemId:source.itemId
    };
  }

  function arcgisCameraItemUrl(itemId) {
    try {
      const root=window.MAPPING_ARCGIS?.portalUrl;
      if (!root || !/^[a-f0-9]{32}$/i.test(String(itemId||""))) return "";
      const url=new URL("/home/item.html",root);
      url.searchParams.set("id",itemId);
      return url.toString();
    } catch { return ""; }
  }

  async function openBCCCameraImage(camera,button) {
    const tab=window.open("about:blank","_blank");
    if (!tab) { button.textContent="Allow pop-ups to view";return; }
    tab.opener=null;
    tab.document.title="Loading camera";
    tab.document.body.textContent="Loading camera image from ArcGIS…";
    button.disabled=true;
    try {
      const image=await window.MAPPING_ARCGIS.fetchCameraAttachment(
        "bccResilience",camera.objectId
      );
      const blobUrl=URL.createObjectURL(image);
      if (!tab.closed) tab.location.replace(blobUrl);
      window.setTimeout(()=>URL.revokeObjectURL(blobUrl),120000);
    } catch(error) {
      if (!tab.closed) {
        tab.document.body.textContent="Camera image unavailable: "+
          cleanMessage(error,"Unable to open image.")+
          ". Try the ArcGIS layer link in the Mapping app.";
      }
    } finally { button.disabled=false; }
  }

  function renderAllCameraSources(state,runId) {
    if (runId!==cameraAnalysisRun || !cameraList) return;
    const found=CAMERA_SOURCES.reduce((sum,source)=>
      sum+(state[source.key]?.cameras?.length||0),0);
    const pending=CAMERA_SOURCES.filter((source)=>
      state[source.key]?.status==="checking").length;
    const failed=CAMERA_SOURCES.filter((source)=>
      state[source.key]?.status==="unavailable").length;
    if (cameraStatus) {
      cameraStatus.textContent=found+" camera"+(found===1?"":"s")+
        (pending?" · "+pending+" checking":"")+
        (failed?" · "+failed+" unavailable":"");
    }
    cameraList.innerHTML="";
    CAMERA_SOURCES.forEach(({key,title})=>{
      const data=state[key] || {status:"checking",cameras:[]};
      const group=document.createElement("section");
      group.className="camera-source";
      const header=document.createElement("div");
      header.className="camera-source-heading";
      const name=document.createElement("strong");
      name.textContent=title;
      const badge=document.createElement("span");
      badge.className="boundary-source-status "+(
        data.status==="unavailable"?"error":
        data.status==="checking"?"warning":"ok"
      );
      badge.textContent=data.status==="checking"?"Checking":
        data.status==="unavailable"?"Unavailable":
        data.cameras.length+" found";
      header.append(name,badge);
      group.appendChild(header);

      if (data.note) {
        const note=document.createElement("p");
        note.className="camera-source-note";
        note.textContent=data.note;
        group.appendChild(note);
      }
      if (!data.cameras.length) {
        const note=document.createElement("p");
        note.className="camera-source-note";
        note.textContent=data.status==="unavailable" ? data.error:
          data.status==="checking"?"Checking this source…":
          "No cameras from this source inside the warning.";
        group.appendChild(note);
      }
      data.cameras.forEach((camera)=>{
        const item=document.createElement("article");
        item.className="camera-item";
        const copy=document.createElement("div");
        copy.className="camera-copy";
        const h=document.createElement("strong");
        h.textContent=camera.description;
        const small=document.createElement("small");
        small.textContent=camera.subtitle||title;
        copy.append(h,small);
        const actions=document.createElement("div");
        actions.className="camera-actions";
        camera.links.forEach((target)=>{
          const a=document.createElement("a");
          a.className="camera-link";
          a.href=target.url;
          a.target="_blank";a.rel="noopener noreferrer";
          a.textContent=target.label;
          actions.appendChild(a);
        });
        if (camera.kind==="bccResilience" &&
            camera.hasAttachments && camera.objectId!=null) {
          const button=document.createElement("button");
          button.type="button";button.className="camera-link";
          button.textContent="View camera image";
          button.addEventListener("click",()=>
            void openBCCCameraImage(camera,button)
          );
          actions.appendChild(button);
        }
        const itemUrl=arcgisCameraItemUrl(camera.portalItemId);
        if (itemUrl) {
          const a=document.createElement("a");
          a.className="camera-layer-link";
          a.href=itemUrl;a.target="_blank";a.rel="noopener noreferrer";
          a.textContent="ArcGIS layer";
          actions.appendChild(a);
        }
        item.append(copy,actions);
        group.appendChild(item);
      });
      cameraList.appendChild(group);
    });
  }

  async function analyseCamerasForWarning(warning,profile,runId) {
    if (runId!==cameraAnalysisRun || profile?.key==="flooding") return;
    if (!warning?.active || !warning?.mask) {
      resetCameraPanel("No active Queensland warning pixels detected.");
      if (cameraStatus) cameraStatus.textContent="No active warning";
      return;
    }
    const state=Object.fromEntries(CAMERA_SOURCES.map((source)=>[
      source.key,{status:"checking",cameras:[],error:""}
    ]));
    renderAllCameraSources(state,runId);
    // Independent requests: camera feeds cannot delay or fail JPEG generation.
    await Promise.allSettled(CAMERA_SOURCES.map(async ({key})=>{
      try {
        let cameras;
        let sourceNote="";
        if (key==="tmr") {
          if (!publicSources.trafficCameras) throw new Error("No TMR camera feed.");
          let data;
          try {
            data=await promiseTimeout(fetchJson(publicSources.trafficCameras),
              10000,"TMR traffic-camera feed timed out.");
            if (!Array.isArray(data?.features)) throw new Error("TMR API returned no features.");
          } catch (apiError) {
            const sdk=window.MAPPING_ARCGIS;
            if (!sdk?.queryPublicTrafficCameraLayer) throw apiError;
            data=await promiseTimeout(sdk.queryPublicTrafficCameraLayer(warning.extent),
              14000,"TMR state-road camera fallback timed out.");
            sourceNote="Using TMR state-road camera fallback; image freshness is not supplied by this source.";
          }
          cameras=data.features.map(normaliseTrafficCamera).filter(Boolean)
            .map((camera)=>({
              ...camera,subtitle:[camera.locality,camera.direction,camera.district]
                .filter(Boolean).join(" · "),
              links:[{label:"Camera image",url:camera.imageUrl}]
            }));
        } else {
          const sdk=window.MAPPING_ARCGIS;
          if (!sdk?.queryCameraLayer) throw new Error("ArcGIS camera access is not ready.");
          const data=await promiseTimeout(sdk.queryCameraLayer(key,warning.extent),
            14000,"Authenticated camera query timed out.");
          cameras=data.features.map((feature)=>
            normaliseHostedCamera(feature,key,data.source)
          ).filter(Boolean);
        }
        if (runId!==cameraAnalysisRun) return;
        state[key]={
          status:"ready",error:"",note:sourceNote,
          cameras:cameras.filter((camera)=>
            warningMaskContainsPoint(warning.mask,camera.coordinates)
          ).sort((a,b)=>a.description.localeCompare(b.description,"en-AU"))
        };
      } catch(error) {
        if (runId!==cameraAnalysisRun) return;
        state[key]={
          status:"unavailable",cameras:[],
          error:cleanMessage(error,"Camera source could not be accessed.")
        };
      }
      renderAllCameraSources(state,runId);
    }));
  }

  function promiseTimeout(promise, ms, message) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      })
    ]);
  }

  function cleanMessage(error, fallback="Map generation failed.") {
    return String(error?.message || error || fallback)
      .replace(/https?:\/\/\S+/gi, "[service]")
      .replace(/([?&](?:subscription[-_]?key|token|key|apikey|api_key)=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, 350);
  }

  function setStatus(kind, title, message, badge) {
    if (statusCard) statusCard.className = "scope-banner " + kind;
    if (statusBadge) {
      statusBadge.className = "scope-badge " + kind;
      statusBadge.textContent = badge;
    }
    if (statusTitle) statusTitle.textContent = title;
    if (statusMessage) statusMessage.textContent = message;
  }

  async function blobToBitmap(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Unable to decode rendered map image."));
      };
      img.src = url;
    });
  }

  function backgroundSample(data, width, height) {
    const points = [
      [2, 2],
      [Math.max(2, width - 3), 2],
      [2, Math.max(2, height - 3)],
      [Math.max(2, width - 3), Math.max(2, height - 3)]
    ];
    const sums = [0, 0, 0, 0];
    points.forEach(([x, y]) => {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) sums[c] += data[i + c];
    });
    return sums.map((v) => v / points.length);
  }

  function pixelToGeographic(x, y, width, height, extent=QLD_EXTENT) {
    const [xmin, ymin, xmax, ymax] = extent;
    return [
      xmin + (x / width) * (xmax - xmin),
      ymax - (y / height) * (ymax - ymin)
    ];
  }

  function padGeographicExtent(extent) {
    const [xmin, ymin, xmax, ymax] = extent;
    const lonSpan = Math.max(0.4, xmax - xmin);
    const latSpan = Math.max(0.4, ymax - ymin);
    const lonPad = Math.max(0.25, lonSpan * 0.16);
    const latPad = Math.max(0.25, latSpan * 0.16);
    return [
      clamp(xmin - lonPad, QLD_EXTENT[0], QLD_EXTENT[2]),
      clamp(ymin - latPad, QLD_EXTENT[1], QLD_EXTENT[3]),
      clamp(xmax + lonPad, QLD_EXTENT[0], QLD_EXTENT[2]),
      clamp(ymax + latPad, QLD_EXTENT[1], QLD_EXTENT[3])
    ];
  }

  function unionExtents(extents) {
    const valid = (extents || []).filter((extent) => Array.isArray(extent) && extent.length === 4);
    if (!valid.length) return null;
    return [
      Math.min(...valid.map((extent) => extent[0])),
      Math.min(...valid.map((extent) => extent[1])),
      Math.max(...valid.map((extent) => extent[2])),
      Math.max(...valid.map((extent) => extent[3]))
    ];
  }

  async function analyseDetectionBlob(blob, detectionSize, { components=false }={}) {
    const image = await blobToBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = detectionSize[0];
    canvas.height = detectionSize[1];
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bg = backgroundSample(pixels, canvas.width, canvas.height);
    const step = 2;
    const gridWidth = Math.ceil(canvas.width / step);
    const gridHeight = Math.ceil(canvas.height / step);
    const visible = new Uint8Array(gridWidth * gridHeight);

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    let hits = 0;

    for (let gy = 0; gy < gridHeight; gy += 1) {
      const y = Math.min(canvas.height - 1, gy * step);
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const x = Math.min(canvas.width - 1, gx * step);
        const i = (y * canvas.width + x) * 4;
        const a = pixels[i + 3];
        const alphaDelta = Math.abs(a - bg[3]);
        const colourDelta =
          Math.abs(pixels[i] - bg[0]) +
          Math.abs(pixels[i + 1] - bg[1]) +
          Math.abs(pixels[i + 2] - bg[2]);

        const isVisible = a > 12 && (alphaDelta > 18 || colourDelta > 55 || bg[3] < 25);
        if (!isVisible) continue;

        visible[gy * gridWidth + gx] = 1;
        hits += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const mask = {
      visible,
      gridWidth,
      gridHeight,
      step,
      width: canvas.width,
      height: canvas.height,
      extent: [...QLD_EXTENT]
    };

    if (hits < 35 || maxX < minX || maxY < minY) {
      return { active: false, extent: [...QLD_EXTENT], components: [], mask };
    }

    const rawExtent = [
      pixelToGeographic(minX, maxY + step, canvas.width, canvas.height)[0],
      pixelToGeographic(minX, maxY + step, canvas.width, canvas.height)[1],
      pixelToGeographic(maxX + step, minY, canvas.width, canvas.height)[0],
      pixelToGeographic(maxX + step, minY, canvas.width, canvas.height)[1]
    ];

    if (!components) {
      return { active: true, extent: padGeographicExtent(rawExtent), components: [], mask };
    }

    const visited = new Uint8Array(visible.length);
    const found = [];
    const neighbours = [-1, 0, 1];

    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const root = gy * gridWidth + gx;
        if (!visible[root] || visited[root]) continue;

        const queue = [[gx, gy]];
        visited[root] = 1;
        let cursor = 0;
        let count = 0;
        let cMinX = canvas.width;
        let cMinY = canvas.height;
        let cMaxX = -1;
        let cMaxY = -1;
        let sampleX = gx * step;
        let sampleY = gy * step;

        while (cursor < queue.length) {
          const [cx, cy] = queue[cursor++];
          const px = Math.min(canvas.width - 1, cx * step);
          const py = Math.min(canvas.height - 1, cy * step);
          count += 1;
          cMinX = Math.min(cMinX, px);
          cMinY = Math.min(cMinY, py);
          cMaxX = Math.max(cMaxX, px);
          cMaxY = Math.max(cMaxY, py);

          for (const dy of neighbours) {
            for (const dx of neighbours) {
              if (!dx && !dy) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
              const ni = ny * gridWidth + nx;
              if (!visible[ni] || visited[ni]) continue;
              visited[ni] = 1;
              queue.push([nx, ny]);
            }
          }
        }

        if (count < 10) continue;
        sampleX = Math.round((cMinX + cMaxX) / 2);
        sampleY = Math.round((cMinY + cMaxY) / 2);

        // If the bounding-box centre is not a visible sample, use the first
        // visible cell in this component so GetFeatureInfo lands inside it.
        const centerGX = Math.max(0, Math.min(gridWidth - 1, Math.round(sampleX / step)));
        const centerGY = Math.max(0, Math.min(gridHeight - 1, Math.round(sampleY / step)));
        if (!visible[centerGY * gridWidth + centerGX]) {
          const [fallbackGX, fallbackGY] = queue[Math.floor(queue.length / 2)] || queue[0];
          sampleX = Math.min(canvas.width - 1, fallbackGX * step);
          sampleY = Math.min(canvas.height - 1, fallbackGY * step);
        }

        const southwest = pixelToGeographic(cMinX, cMaxY + step, canvas.width, canvas.height);
        const northeast = pixelToGeographic(cMaxX + step, cMinY, canvas.width, canvas.height);
        found.push({
          extent: [southwest[0], southwest[1], northeast[0], northeast[1]],
          sampleX,
          sampleY,
          sampleCoord: pixelToGeographic(sampleX, sampleY, canvas.width, canvas.height),
          hits: count
        });
      }
    }

    return {
      active: true,
      extent: padGeographicExtent(rawExtent),
      components: found.sort((a, b) => b.hits - a.hits),
      mask
    };
  }


  function validateQueenslandBoundary(collection) {
    const features = (collection?.features || []).filter((feature) =>
      feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon"
    );
    if (collection?.type !== "FeatureCollection" || features.length < 50) {
      throw new Error("The Queensland local-government boundary request returned incomplete polygon data.");
    }

    const insideQueensland = [
      [153.028, -27.47], // Brisbane
      [145.77, -16.92],  // Cairns
      [139.49, -20.72]   // Mount Isa
    ];
    if (insideQueensland.some((point) =>
      !features.some((feature) => pointInGeometry(point, feature.geometry))
    )) {
      throw new Error("The Queensland boundary dataset failed geographic coverage checks.");
    }

    // Make sure a southern NSW point cannot be treated as Queensland.
    if (features.some((feature) => pointInGeometry([153.61, -28.65], feature.geometry))) {
      throw new Error("The Queensland boundary dataset unexpectedly includes interstate territory.");
    }

    return { type: "FeatureCollection", features, _source: "public" };
  }

  function loadQueenslandBoundary() {
    if (!queenslandBoundaryPromise) {
      queenslandBoundaryPromise = queryArcgis(publicSources.lga, QLD_EXTENT, "1=1", "lga")
        .then(validateQueenslandBoundary)
        .catch((error) => {
          queenslandBoundaryPromise = null;
          throw error;
        });
    }
    return queenslandBoundaryPromise;
  }

  function makeQueenslandMaskCanvas(boundary, width, height, project) {
    if (!Array.isArray(boundary?.features) || !boundary.features.length) {
      throw new Error("Queensland boundary polygons are required to clip the warning.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    // Fill polygons separately, preserving polygon holes while forming the
    // union of neighbouring LGAs (one global even-odd fill would cancel overlaps).
    for (const feature of boundary.features) {
      if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) continue;
      ctx.beginPath();
      pathGeometry(ctx, feature.geometry, project);
      ctx.fill("evenodd");
    }
    return canvas;
  }

  function clipDetectionToQueensland(detection, boundary) {
    const mask = detection?.mask;
    if (!mask?.visible) throw new Error("The warning detection did not return a raster mask.");

    const [xmin, ymin, xmax, ymax] = mask.extent || QLD_EXTENT;
    const project = ([lon, lat]) => [
      ((lon - xmin) / (xmax - xmin)) * mask.width,
      ((ymax - lat) / (ymax - ymin)) * mask.height
    ];
    const boundaryCanvas = makeQueenslandMaskCanvas(boundary, mask.width, mask.height, project);
    const boundaryPixels = boundaryCanvas.getContext("2d").getImageData(
      0, 0, mask.width, mask.height
    ).data;

    const clipped = new Uint8Array(mask.visible.length);
    let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1, hits = 0;

    for (let gy = 0; gy < mask.gridHeight; gy += 1) {
      const y = Math.min(mask.height - 1, gy * mask.step);
      for (let gx = 0; gx < mask.gridWidth; gx += 1) {
        const index = gy * mask.gridWidth + gx;
        if (!mask.visible[index]) continue;
        const x = Math.min(mask.width - 1, gx * mask.step);
        if (boundaryPixels[(y * mask.width + x) * 4 + 3] < 12) continue;
        clipped[index] = 1;
        hits += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    // Keep the original detector's minimum signal threshold. Warnings outside
    // Queensland no longer trigger a warning-area extent or camera/LGA results.
    const active = hits >= 35 && maxX >= minX && maxY >= minY;
    const extent = active ? padGeographicExtent([
      pixelToGeographic(minX, maxY + mask.step, mask.width, mask.height, mask.extent)[0],
      pixelToGeographic(minX, maxY + mask.step, mask.width, mask.height, mask.extent)[1],
      pixelToGeographic(maxX + mask.step, minY, mask.width, mask.height, mask.extent)[0],
      pixelToGeographic(maxX + mask.step, minY, mask.width, mask.height, mask.extent)[1]
    ]) : [...QLD_EXTENT];

    return {
      ...detection,
      active,
      extent,
      components: [],
      mask: { ...mask, visible: clipped },
      queenslandBoundary: boundary
    };
  }

  function clipWmsImageToQueensland(image, maskCanvas, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, width, height);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCanvas, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  }

  async function renderDetectionLayer(sublayerTitles, { components=false }={}) {
    const arcgis = window.MAPPING_ARCGIS;
    if (!arcgis?.renderWmsImage) throw new Error("Authenticated ArcGIS rendering is not ready.");

    const detectionSize = renderCfg.warningDetectionSize || [720, 900];
    const result = await arcgis.renderWmsImage(
      "warning",
      QLD_EXTENT,
      detectionSize[0],
      detectionSize[1],
      { sublayerTitles }
    );
    const analysis = await analyseDetectionBlob(result.blob, detectionSize, { components });
    return { ...analysis, detectionBlob: result.blob, detectionSize };
  }

  async function detectWarningExtent(profile=currentProfile()) {
    const titles = profileTitles(profile, "detectionSublayerTitles");
    const [detection, boundary] = await Promise.all([
      renderDetectionLayer(titles, { components: false }),
      loadQueenslandBoundary()
    ]);
    return clipDetectionToQueensland(detection, boundary);
  }

  function lonLatToWebMercator(coord) {
    const lon = Number(coord?.[0]);
    const lat = clamp(Number(coord?.[1]), -85.05112878, 85.05112878);
    const x = lon * WEB_MERCATOR_HALF_WORLD / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
    return [x, y * WEB_MERCATOR_HALF_WORLD / 180];
  }

  function geographicExtentToWebMercator(extent) {
    const southwest = lonLatToWebMercator([extent[0], extent[1]]);
    const northeast = lonLatToWebMercator([extent[2], extent[3]]);
    return [southwest[0], southwest[1], northeast[0], northeast[1]];
  }

  function extentAspect(extent) {
    const [xmin, ymin, xmax, ymax] = extent;
    // Projected output extents are already in linear metres.
    if ([xmin, ymin, xmax, ymax].some((value) => Math.abs(value) > 1000)) {
      return Math.max(0.01, xmax - xmin) / Math.max(0.01, ymax - ymin);
    }

    const midLat = ((ymin + ymax) / 2) * Math.PI / 180;
    const physicalWidth = Math.max(0.01, (xmax - xmin) * Math.cos(midLat));
    const physicalHeight = Math.max(0.01, ymax - ymin);
    return physicalWidth / physicalHeight;
  }

  function mapSize(extent) {
    const aspect = extentAspect(extent);
    let width;
    let height;

    if (aspect >= 1) {
      width = renderCfg.maxOutputWidth || 1500;
      height = Math.round(width / aspect);
      height = clamp(height, 850, 1250);
    } else {
      height = 1350;
      width = Math.round(height * aspect);
      width = clamp(width, renderCfg.minOutputWidth || 1100, renderCfg.maxOutputWidth || 1500);
    }

    return [Math.round(width), Math.round(height)];
  }

  function extentIntersectsGeometry(geometry, extent) {
    const bbox = geometryBounds(geometry);
    if (!bbox) return false;
    return !(bbox[2] < extent[0] || bbox[0] > extent[2] || bbox[3] < extent[1] || bbox[1] > extent[3]);
  }

  function geometryBounds(geometry) {
    if (!geometry?.coordinates) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function visit(value) {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number" && typeof value[1] === "number") {
        const x = value[0], y = value[1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        return;
      }
      value.forEach(visit);
    }

    visit(geometry.coordinates);
    if (!Number.isFinite(minX)) return null;
    return [minX, minY, maxX, maxY];
  }

  function representativePoint(geometry) {
    const bbox = geometryBounds(geometry);
    return bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
  }

  function queryArcgis(url, extent, where="1=1", outFields="*") {
    const query = new URL(url.replace(/\/$/, "") + "/query");
    query.searchParams.set("where", where);
    query.searchParams.set("outFields", outFields);
    query.searchParams.set("returnGeometry", "true");
    query.searchParams.set("outSR", "4326");
    query.searchParams.set("f", "geojson");
    query.searchParams.set("geometry", extent.join(","));
    query.searchParams.set("geometryType", "esriGeometryEnvelope");
    query.searchParams.set("inSR", "4326");
    query.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    return fetch(query, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Reference layer request returned HTTP " + response.status);
      return response.json();
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Public data request returned HTTP " + response.status);
    return response.json();
  }

  function isCurrentRoadEvent(props, now=Date.now()) {
    const status = String(props?.status || "").trim().toLowerCase();
    if (status && status !== "published") return false;
    const duration = props?.duration && typeof props.duration === "object" ? props.duration : {};
    const start = duration.start ? Date.parse(duration.start) : NaN;
    const end = duration.end ? Date.parse(duration.end) : NaN;
    if (Number.isFinite(start) && now < start) return false;
    if (Number.isFinite(end) && now > end) return false;
    return true;
  }

  function roadPassability(props) {
    const impact = props?.impact && typeof props.impact === "object" ? props.impact : {};
    const impactType = String(impact.impact_type || "").trim().toLowerCase();
    const impactSubtype = String(impact.impact_subtype || "").trim().toLowerCase();
    const description = String(props?.description || "").trim().toLowerCase();
    const advice = String(props?.advice || "").trim().toLowerCase();
    const text = [impactType, impactSubtype, description, advice].join(" ");

    const hardMarkers = [
      "road closed to all traffic",
      "road closed",
      "closed to all vehicles",
      "closed to all traffic",
      "road is closed"
    ];
    if (hardMarkers.some((marker) => text.includes(marker))) return "impassable";

    if (impactType === "closures") {
      if (["lane", "partial", "shoulder"].some((marker) => text.includes(marker))) {
        return "passable_with_conditions";
      }
      return "impassable";
    }

    if (["road restricted", "lanes affected"].includes(impactType)) return "passable_with_conditions";
    if (["road restricted", "lane closure", "lanes affected"].some((marker) => text.includes(marker))) {
      return "passable_with_conditions";
    }
    return null;
  }

  function lineGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === "LineString" || geometry.type === "MultiLineString") return geometry;
    if (geometry.type === "GeometryCollection") {
      const lines = (geometry.geometries || []).filter((g) => g.type === "LineString" || g.type === "MultiLineString");
      if (!lines.length) return null;
      return { type: "GeometryCollection", geometries: lines };
    }
    return null;
  }

  function normaliseRoads(payload, extent, statewide) {
    const result = [];
    for (const feature of payload?.features || []) {
      const props = feature?.properties || {};
      if (!isCurrentRoadEvent(props)) continue;
      const passability = roadPassability(props);
      if (!passability) continue;
      if (statewide && passability !== "impassable") continue;

      let geometry = feature.geometry;
      const areaAlert = props.area_alert === true || ["1", "true", "t", "yes", "y"].includes(String(props.area_alert || "").toLowerCase());
      if (areaAlert) {
        geometry = lineGeometry(geometry);
        if (!geometry) continue;
      }
      if (!geometry || !extentIntersectsGeometry(geometry, extent)) continue;

      const road = props.road_summary && typeof props.road_summary === "object" ? props.road_summary : {};
      result.push({
        geometry,
        passability,
        roadName: String(road.road_name || props.road_name || "").trim(),
        locality: String(road.locality || props.locality || "").trim()
      });
    }
    return result;
  }

  function normaliseOutages(payload, extent) {
    return (payload?.features || [])
      .filter((feature) => {
        const props = feature?.properties || {};
        const type = String(props.outage_type || "").trim().toLowerCase();
        return (!type || type === "unplanned") && feature.geometry && extentIntersectsGeometry(feature.geometry, extent);
      })
      .map((feature) => {
        const props = feature.properties || {};
        const known = props.affected_customers_known !== false;
        const affected = Number(props.affected_customers);
        return {
          geometry: feature.geometry,
          affected: known && Number.isFinite(affected) ? affected : null
        };
      });
  }

  async function loadPreferredLga(extent) {
    const layer = await queryArcgis(publicSources.lga, extent, "1=1", "*");
    return { ...layer, _source: "public" };
  }

  async function loadDisasterDistricts(extent) {
    const arcgis = window.MAPPING_ARCGIS;
    const resolved = arcgis?.getAdministrativeLayer?.("disasterDistricts");

    if (!resolved?.available || !arcgis?.queryResolvedAdministrativeLayer) {
      return {
        type: "FeatureCollection",
        features: [],
        _source: "unavailable",
        _error: "Administrative layer discovery is still running or the district layer was not found."
      };
    }

    try {
      const districts = await promiseTimeout(
        arcgis.queryResolvedAdministrativeLayer("disasterDistricts", extent, "*"),
        5000,
        "Authenticated disaster-district query timed out."
      );
      return { ...districts, _source: "authenticated" };
    } catch (error) {
      return {
        type: "FeatureCollection",
        features: [],
        _source: "unavailable",
        _error: cleanMessage(error, "Authenticated disaster-district layer is unavailable for this run.")
      };
    }
  }

  async function loadPublicData(extent, statewide, {
    includeDisasterDistricts=false,
    queenslandBoundary=null
  }={}) {
    const lgaInExtent = queenslandBoundary
      ? {
          ...queenslandBoundary,
          features: queenslandBoundary.features.filter((feature) =>
            extentIntersectsGeometry(feature.geometry, extent)
          )
        }
      : null;
    const jobs = {
      mainland: queryArcgis(publicSources.mainland, extent, "1=1", "feature_type,name"),
      coastline: queryArcgis(publicSources.coastline, extent, "1=1", "feature_type"),
      border: queryArcgis(publicSources.stateBorder, extent, "1=1", "border_desc,state_desc"),
      lga: lgaInExtent ? Promise.resolve(lgaInExtent) : loadPreferredLga(extent),
      disasterDistricts: includeDisasterDistricts
        ? loadDisasterDistricts(extent)
        : Promise.resolve({ type: "FeatureCollection", features: [], _source: "not-requested" }),
      roads: queryArcgis(publicSources.majorRoads, extent, "symbol_class IN ('Motorway','Highway')", "road_name_full,symbol_class"),
      centres: queryArcgis(publicSources.populationCentres, extent, "1=1", "name,population,operational_status,upper_scale"),
      outages: fetchJson(publicSources.powerOutages),
      traffic: fetchJson(publicSources.roadConditions)
    };

    const entries = await Promise.allSettled(Object.entries(jobs).map(async ([key, promise]) => [key, await promise]));
    const data = {};
    const warnings = [];

    entries.forEach((entry) => {
      if (entry.status === "fulfilled") {
        data[entry.value[0]] = entry.value[1];
      } else {
        warnings.push(cleanMessage(entry.reason, "A public context source could not be loaded."));
      }
    });

    data.outagesNorm = normaliseOutages(data.outages || { features: [] }, extent);
    data.roadsNorm = normaliseRoads(data.traffic || { features: [] }, extent, statewide);
    return { data, warnings };
  }

  function normalisedPropertyMap(properties={}) {
    const map = new Map();
    Object.entries(properties || {}).forEach(([key, value]) => {
      map.set(String(key).toLowerCase().replace(/[^a-z0-9]/g, ""), value);
    });
    return map;
  }

  function propertyValue(properties, aliases) {
    const map = normalisedPropertyMap(properties);
    for (const alias of aliases) {
      const value = map.get(String(alias).toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function pointInRing(point, ring) {
    let inside = false;
    const x = point[0];
    const y = point[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]?.[0];
      const yi = ring[i]?.[1];
      const xj = ring[j]?.[0];
      const yj = ring[j]?.[1];
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      const intersects = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInGeometry(point, geometry) {
    if (!geometry || !Array.isArray(point)) return false;
    if (geometry.type === "Polygon") {
      const rings = geometry.coordinates || [];
      if (!rings.length || !pointInRing(point, rings[0])) return false;
      return !rings.slice(1).some((ring) => pointInRing(point, ring));
    }
    if (geometry.type === "MultiPolygon") {
      return (geometry.coordinates || []).some((polygon) =>
        pointInGeometry(point, { type: "Polygon", coordinates: polygon })
      );
    }
    return false;
  }

  function administrativeName(feature, kind) {
    const props = feature?.properties || {};
    const aliases = kind === "district"
      ? [
          "PROP_DD", "prop_dd", "ddmg_name", "ddmg", "disaster_district_name", "disaster_district",
          "district_name", "district", "name", "NAME"
        ]
      : [
          "lga_name", "lga_name24", "lga", "local_government",
          "local_government_area", "council_name", "name", "NAME"
        ];

    const direct = propertyValue(props, aliases);
    if (direct) return direct;

    const preferredKey = Object.keys(props).find((key) => {
      const normal = String(key).toLowerCase();
      if (kind === "district") return normal.includes("district") && normal.includes("name");
      return (normal.includes("lga") || normal.includes("local_government")) && normal.includes("name");
    });
    const value = preferredKey ? props[preferredKey] : "";
    return value == null ? "" : String(value).trim();
  }

  function warningMaskIntersectsGeometry(mask, geometry) {
    if (!mask?.visible || !geometry) return false;
    const bbox = geometryBounds(geometry);
    if (!bbox) return false;

    const [xmin, ymin, xmax, ymax] = mask.extent || QLD_EXTENT;
    const lonSpan = Math.max(Number.EPSILON, xmax - xmin);
    const latSpan = Math.max(Number.EPSILON, ymax - ymin);
    const pixelX = (lon) => (lon - xmin) / lonSpan * mask.width;
    const pixelY = (lat) => (ymax - lat) / latSpan * mask.height;

    const gx0 = clamp(Math.floor(pixelX(bbox[0]) / mask.step) - 1, 0, mask.gridWidth - 1);
    const gx1 = clamp(Math.ceil(pixelX(bbox[2]) / mask.step) + 1, 0, mask.gridWidth - 1);
    const gy0 = clamp(Math.floor(pixelY(bbox[3]) / mask.step) - 1, 0, mask.gridHeight - 1);
    const gy1 = clamp(Math.ceil(pixelY(bbox[1]) / mask.step) + 1, 0, mask.gridHeight - 1);
    if (gx1 < gx0 || gy1 < gy0) return false;

    const bboxCells = (gx1 - gx0 + 1) * (gy1 - gy0 + 1);
    const requiredHits = bboxCells <= 16 ? 1 : 3;
    let hits = 0;

    for (let gy = gy0; gy <= gy1; gy += 1) {
      for (let gx = gx0; gx <= gx1; gx += 1) {
        if (!mask.visible[gy * mask.gridWidth + gx]) continue;
        const x = Math.min(mask.width - 1, gx * mask.step);
        const y = Math.min(mask.height - 1, gy * mask.step);
        const point = pixelToGeographic(x, y, mask.width, mask.height, mask.extent);
        if (!pointInGeometry(point, geometry)) continue;
        hits += 1;
        if (hits >= requiredHits) return true;
      }
    }

    return false;
  }

  function affectedAdministrativeNames(mask, collection, kind) {
    const names = new Set();
    for (const feature of collection?.features || []) {
      if (!feature?.geometry || !warningMaskIntersectsGeometry(mask, feature.geometry)) continue;
      const name = administrativeName(feature, kind);
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "en-AU"));
  }

  function analyseAffectedAreas(warning, data) {
    if (!warning?.active || !warning?.mask) {
      return { active: false, lgas: [], districts: [], districtAvailable: true };
    }

    const districtAvailable = data.disasterDistricts?._source === "authenticated";
    return {
      active: true,
      lgas: affectedAdministrativeNames(warning.mask, data.lga, "lga"),
      districts: districtAvailable
        ? affectedAdministrativeNames(warning.mask, data.disasterDistricts, "district")
        : [],
      lgaSource: data.lga?._source || "public",
      districtAvailable
    };
  }

  function catchmentAtPoint(collection, point) {
    return (collection?.features || []).find((feature) => pointInGeometry(point, feature.geometry)) || null;
  }

  function summariseNames(names) {
    const values = [...new Set((names || []).filter(Boolean))];
    if (!values.length) return "";
    if (values.length <= 2) return values.join(", ");
    return values.slice(0, 2).join(", ") + " +" + (values.length - 2) + " more";
  }

  async function identifyFloodComponent(component, type, sublayerTitle, detectionSize, references) {
    const arcgis = window.MAPPING_ARCGIS;
    let info = null;
    if (arcgis?.getWmsFeatureInfo) {
      info = await arcgis.getWmsFeatureInfo(
        "warning",
        QLD_EXTENT,
        detectionSize[0],
        detectionSize[1],
        component.sampleX,
        component.sampleY,
        { sublayerTitle, spatialReference: 4326 }
      ).catch(() => null);
    }

    const properties = info?.properties || {};
    let productId = propertyValue(properties, [
      "product_id", "productid", "product_code", "productcode",
      "warning_id", "warningid", "watch_id", "watchid",
      "event_id", "eventid", "identifier"
    ]);
    let productTitle = propertyValue(properties, [
      "warning_title", "watch_title", "product_name", "productname",
      "headline", "title"
    ]);
    let catchmentName = propertyValue(properties, [
      "dist_name", "catchment_name", "catchment", "area_name", "areaname"
    ]);

    const referenceCollection = type === "warning"
      ? references.warningCatchments
      : references.watchCatchments;
    const referenceFeature = catchmentAtPoint(referenceCollection, component.sampleCoord);
    const referenceProps = referenceFeature?.properties || {};

    if (!catchmentName) catchmentName = String(referenceProps.dist_name || referenceProps.DIST_NAME || "").trim();
    if (type === "warning" && !productId) {
      productId = String(referenceProps.product_id || referenceProps.PRODUCT_ID || "").trim();
    }

    return {
      ...component,
      type,
      sublayerTitle,
      productId,
      productTitle,
      catchmentName,
      featureInfoAvailable: Boolean(info && Object.keys(properties).length)
    };
  }

  async function scanFloodLayer(sublayerTitle, type, references) {
    const detected = await renderDetectionLayer([sublayerTitle], { components: true });
    if (!detected.active) return [];

    const limited = detected.components.slice(0, 40);
    const identified = [];
    for (const component of limited) {
      identified.push(await identifyFloodComponent(
        component,
        type,
        sublayerTitle,
        detected.detectionSize,
        references
      ));
    }
    return identified;
  }

  function groupFloodComponents(components) {
    const groups = new Map();
    let fallbackIndex = 0;

    components.forEach((component) => {
      const typeLabel = component.type === "warning" ? "Flood Warning" : "Flood Watch";
      const identity = component.productId || component.productTitle;
      const groupKey = identity
        ? component.type + ":" + identity
        : component.type + ":detected:" + (++fallbackIndex);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          type: component.type,
          typeLabel,
          productId: component.productId || "",
          productTitle: component.productTitle || "",
          components: [],
          catchmentNames: new Set(),
          featureInfoAvailable: false,
          groupingMode: identity ? "product" : "detected-area"
        });
      }

      const group = groups.get(groupKey);
      group.components.push(component);
      if (component.catchmentName) group.catchmentNames.add(component.catchmentName);
      group.featureInfoAvailable ||= component.featureInfoAvailable;
      if (!group.productId && component.productId) group.productId = component.productId;
      if (!group.productTitle && component.productTitle) group.productTitle = component.productTitle;
    });

    return [...groups.values()].map((group, index) => {
      const extent = padGeographicExtent(unionExtents(group.components.map((component) => component.extent)));
      const names = [...group.catchmentNames];

      let descriptor = group.productTitle || "";
      if (!descriptor) descriptor = summariseNames(names);
      if (!descriptor) descriptor = group.productId || ("Detected area " + (index + 1));

      const title = group.typeLabel + " — " + descriptor;
      const meta = [
        group.productId || null,
        group.components.length + (group.components.length === 1 ? " detected area" : " detected areas"),
        group.groupingMode === "detected-area" ? "product identifier unavailable" : null
      ].filter(Boolean).join(" · ");

      return {
        ...group,
        extent,
        title,
        meta,
        catchmentNames: names
      };
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === "warning" ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }

  function renderFloodCandidates() {
    if (!floodCandidateList) return;
    floodCandidateList.innerHTML = "";

    if (!floodScanned) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Scanning has not been completed for the current session.";
      floodCandidateList.appendChild(empty);
      return;
    }

    if (!floodCandidates.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No active Flood Warning or Flood Watch areas were detected in Queensland. Generate maps will use the statewide extent.";
      floodCandidateList.appendChild(empty);
      return;
    }

    floodCandidates.forEach((candidate) => {
      const label = document.createElement("label");
      label.className = "flood-candidate";
      if (candidate.id === selectedFloodCandidateId) label.classList.add("selected");

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "floodProduct";
      input.value = candidate.id;
      input.checked = candidate.id === selectedFloodCandidateId;

      const copy = document.createElement("span");
      copy.className = "flood-candidate-copy";

      const strong = document.createElement("strong");
      strong.textContent = candidate.title;

      const meta = document.createElement("small");
      meta.textContent = candidate.meta;

      copy.append(strong, meta);
      label.append(input, copy);
      floodCandidateList.appendChild(label);

      input.addEventListener("change", () => {
        selectedFloodCandidateId = candidate.id;
        renderFloodCandidates();
        if (warningCount) warningCount.textContent = floodCandidates.length.toString();
        if (modeEl) modeEl.textContent = candidate.typeLabel;
        setStatus("ok", "Flood product selected", candidate.title + " will control the output extent.", "Selected");
        updateGenerateState();
      });
    });
  }

  async function loadFloodReferenceCatchments() {
    const warningPromise = publicSources.bomFloodWarningCatchments
      ? queryArcgis(
          publicSources.bomFloodWarningCatchments,
          QLD_EXTENT,
          "state_code='QLD'",
          "aac,aac_parent,dist_name,disp_order,product_id,state_code"
        )
      : Promise.resolve({ features: [] });

    const watchPromise = publicSources.bomFloodWatchCatchments
      ? queryArcgis(
          publicSources.bomFloodWatchCatchments,
          QLD_EXTENT,
          "1=1",
          "aac,aac_parent,dist_name,disp_order,office"
        )
      : Promise.resolve({ features: [] });

    const [warning, watch] = await Promise.allSettled([warningPromise, watchPromise]);
    return {
      warningCatchments: warning.status === "fulfilled" ? warning.value : { features: [] },
      watchCatchments: watch.status === "fulfilled" ? watch.value : { features: [] }
    };
  }

  async function scanFloodProducts() {
    const profile = PROFILES.flooding;
    if (!profile || !window.MAPPING_ARCGIS?.renderWmsImage) return;

    scanningFloods = true;
    floodScanned = false;
    selectedFloodCandidateId = null;
    updateGenerateState();
    if (floodSelectionStatus) floodSelectionStatus.textContent = "Scanning";
    if (floodCandidateList) {
      floodCandidateList.innerHTML = '<div class="empty-state">Scanning active Flood Warning and Flood Watch areas…</div>';
    }
    setStatus("warning", "Scanning flood products…", "Detecting active flood warning/watch areas and grouping warning catchments by product identity.", "Scanning");

    try {
      const references = await loadFloodReferenceCatchments();
      const [warnings, watches] = await Promise.all([
        scanFloodLayer(profile.floodWarningSublayerTitle, "warning", references),
        scanFloodLayer(profile.floodWatchSublayerTitle, "watch", references)
      ]);

      floodCandidates = groupFloodComponents([...warnings, ...watches]);
      floodScanned = true;

      if (floodCandidates.length === 1) {
        selectedFloodCandidateId = floodCandidates[0].id;
      }

      if (floodSelectionStatus) floodSelectionStatus.textContent = floodCandidates.length
        ? floodCandidates.length + " active"
        : "None active";
      if (warningCount) warningCount.textContent = floodCandidates.length ? floodCandidates.length.toString() : "0";
      if (modeEl) modeEl.textContent = floodCandidates.length ? "Select flood product" : "Statewide";
      renderFloodCandidates();

      const fallbackGroups = floodCandidates.filter((candidate) => candidate.groupingMode === "detected-area");
      if (floodSelectionNote) {
        floodSelectionNote.textContent = fallbackGroups.length
          ? "The selected product controls the output extent. Both Flood Warning and Flood Watch overlays remain visible within it. One or more watch areas did not expose a product identifier, so those are listed as separate detected areas rather than being merged statewide."
          : "The selected product controls the output extent. Both Flood Warning and Flood Watch overlays remain visible within that selected extent.";
      }

      if (!floodCandidates.length) {
        setStatus("ok", "No active flood products detected", "The Flooding tab can generate the same two products using the statewide Queensland extent.", "Statewide");
      } else if (selectedFloodCandidateId) {
        setStatus("ok", "Flood product selected", floodCandidates[0].title + " will control the output extent.", "Selected");
      } else {
        setStatus("ok", "Active flood products found", "Select the Flood Warning or Flood Watch you are mapping, then generate the two products.", "Select");
      }
    } catch (error) {
      floodCandidates = [];
      floodScanned = false;
      selectedFloodCandidateId = null;
      renderFloodCandidates();
      if (floodSelectionStatus) floodSelectionStatus.textContent = "Error";
      setStatus("error", "Flood scan failed", cleanMessage(error), "Error");
    } finally {
      scanningFloods = false;
      updateGenerateState();
    }
  }

  function makeTransform(extent, width, height) {
    const [xmin, ymin, xmax, ymax] = extent;
    return (coord) => {
      const [x, y] = lonLatToWebMercator(coord);
      return [
        ((x - xmin) / (xmax - xmin)) * width,
        ((ymax - y) / (ymax - ymin)) * height
      ];
    };
  }

  function traceLine(ctx, coords, project) {
    let started = false;
    for (const coord of coords || []) {
      if (!Array.isArray(coord) || typeof coord[0] !== "number") continue;
      const [x, y] = project(coord);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
  }

  function pathGeometry(ctx, geometry, project) {
    if (!geometry) return;
    const type = geometry.type;

    if (type === "Point") {
      const [x, y] = project(geometry.coordinates);
      ctx.moveTo(x + 3, y);
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      return;
    }

    if (type === "LineString") return traceLine(ctx, geometry.coordinates, project);
    if (type === "MultiLineString") return geometry.coordinates.forEach((line) => traceLine(ctx, line, project));

    if (type === "Polygon") {
      geometry.coordinates.forEach((ring) => {
        traceLine(ctx, ring, project);
        ctx.closePath();
      });
      return;
    }

    if (type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => {
        polygon.forEach((ring) => {
          traceLine(ctx, ring, project);
          ctx.closePath();
        });
      });
      return;
    }

    if (type === "GeometryCollection") {
      (geometry.geometries || []).forEach((child) => pathGeometry(ctx, child, project));
    }
  }

  function drawFeatureSet(ctx, featureCollection, project, options={}) {
    for (const feature of featureCollection?.features || []) {
      if (!feature.geometry) continue;
      ctx.beginPath();
      pathGeometry(ctx, feature.geometry, project);
      if (options.fillStyle) {
        ctx.fillStyle = options.fillStyle;
        ctx.fill("evenodd");
      }
      if (options.strokeStyle) {
        ctx.strokeStyle = options.strokeStyle;
        ctx.lineWidth = options.lineWidth || 1;
        ctx.stroke();
      }
    }
  }

  function candidateName(props) {
    const keys = [
      "lga_name", "LGA_NAME", "lga_name24", "LGA_NAME24", "lga", "LGA", "name", "NAME",
      "local_government", "local_government_area", "council_name", "locality", "road_name_full"
    ];
    for (const key of keys) {
      const value = props?.[key];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function collisionFree(labels, x, y, text, fontSize) {
    const width = text.length * fontSize * 0.56;
    const box = [x - width / 2 - 4, y - fontSize - 3, x + width / 2 + 4, y + 4];
    for (const existing of labels) {
      if (!(box[2] < existing[0] || box[0] > existing[2] || box[3] < existing[1] || box[1] > existing[3])) {
        return false;
      }
    }
    labels.push(box);
    return true;
  }

  function drawLgaLabels(ctx, lga, project, active) {
    if (!active) return;
    const labels = [];
    ctx.save();
    ctx.font = "600 14px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(72,78,84,.72)";
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 3;

    for (const feature of lga?.features || []) {
      const text = candidateName(feature.properties);
      const point = representativePoint(feature.geometry);
      if (!text || !point) continue;
      const [x, y] = project(point);
      if (!collisionFree(labels, x, y, text, 14)) continue;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function drawPopulationCentres(ctx, centres, project, statewide) {
    const features = [...(centres?.features || [])];
    features.sort((a, b) => Number(b.properties?.population || 0) - Number(a.properties?.population || 0));
    const limit = statewide ? 14 : 18;
    const labels = [];
    ctx.save();
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (const feature of features.slice(0, limit)) {
      if (feature.geometry?.type !== "Point") continue;
      const name = candidateName(feature.properties);
      if (!name) continue;
      const [x, y] = project(feature.geometry.coordinates);
      ctx.fillStyle = "rgba(80,87,94,.75)";
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();

      if (!collisionFree(labels, x + 5 + name.length * 3, y, name, 12)) continue;
      ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(name, x + 5, y);
      ctx.fillStyle = "rgba(66,72,78,.8)";
      ctx.fillText(name, x + 5, y);
    }
    ctx.restore();
  }

  function drawOutages(ctx, outages, project, statewide) {
    const labelCandidates = [];
    for (const outage of outages) {
      const geomType = outage.geometry?.type;
      ctx.beginPath();
      pathGeometry(ctx, outage.geometry, project);

      if (geomType === "Polygon" || geomType === "MultiPolygon") {
        ctx.fillStyle = "rgba(210,35,42,.22)";
        ctx.fill("evenodd");
        ctx.strokeStyle = "rgba(146,20,27,.9)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(187,24,31,.95)";
        ctx.fill();
      }

      if (outage.affected != null) {
        const point = representativePoint(outage.geometry);
        if (point) labelCandidates.push({ affected: outage.affected, point });
      }
    }

    labelCandidates.sort((a, b) => b.affected - a.affected);
    const labels = [];
    const limit = statewide ? 10 : 18;
    ctx.save();
    ctx.font = "700 13px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const item of labelCandidates.slice(0, limit)) {
      const [x, y] = project(item.point);
      const text = "⚡ " + item.affected.toLocaleString("en-AU");
      if (!collisionFree(labels, x, y, text, 13)) continue;
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = "#8f1017";
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  function drawRoadConditions(ctx, roads, project) {
    const ordered = [...roads].sort((a, b) => {
      const av = a.passability === "impassable" ? 0 : 1;
      const bv = b.passability === "impassable" ? 0 : 1;
      return av - bv;
    });

    // Road events are intentionally unlabelled. The key and footer explain
    // their meaning without placing road names over the operational picture.
    for (const road of ordered) {
      ctx.beginPath();
      pathGeometry(ctx, road.geometry, project);
      ctx.strokeStyle = road.passability === "impassable" ? "#bd1f24" : "#d97706";
      ctx.lineWidth = road.passability === "impassable" ? 3.2 : 2.4;
      ctx.stroke();
    }
  }

  function drawContext(ctx, width, height, extent, data, active, basemapImage=null) {
    const project = makeTransform(extent, width, height);

    if (basemapImage) {
      // ArcGIS Topographic supplies land/water, relief, roads and place labels.
      // Avoid redrawing those handcrafted context layers over it.
      ctx.drawImage(basemapImage, 0, 0, width, height);
    } else {
      // Graceful fallback when the signed-in ArcGIS account cannot access the
      // Basemap Styles service.
      ctx.fillStyle = "#dcecf4";
      ctx.fillRect(0, 0, width, height);

      drawFeatureSet(ctx, data.mainland, project, {
        fillStyle: "#f2eee4",
        strokeStyle: "rgba(112,106,94,.25)",
        lineWidth: 0.8
      });

      drawFeatureSet(ctx, data.roads, project, {
        strokeStyle: "rgba(124,118,107,.34)",
        lineWidth: 1.2
      });

      drawPopulationCentres(ctx, data.centres, project, !active);
    }

    // Keep operational Queensland context above either basemap.
    drawFeatureSet(ctx, data.lga, project, {
      strokeStyle: "rgba(101,107,111,.42)",
      lineWidth: 1
    });

    drawLgaLabels(ctx, data.lga, project, active);

    drawFeatureSet(ctx, data.coastline, project, {
      strokeStyle: "#4d5458",
      lineWidth: 1.5
    });

    drawFeatureSet(ctx, data.border, project, {
      strokeStyle: "#3e4549",
      lineWidth: 2
    });

    return project;
  }

  function makeProductCanvas(mapWidth, mapHeight, title, subtitle) {
    const top = 66;
    const legendHeight = 116;
    const footerHeight = 72;
    const canvas = document.createElement("canvas");
    canvas.width = mapWidth;
    canvas.height = mapHeight + top + legendHeight + footerHeight;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#17191b";
    ctx.font = "700 24px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, 16, 30);

    ctx.fillStyle = "#61666a";
    ctx.font = "14px Arial";
    ctx.fillText(subtitle, 16, 52);

    return {
      canvas,
      ctx,
      mapX: 0,
      mapY: top,
      mapWidth,
      mapHeight,
      legendY: top + mapHeight,
      legendHeight,
      footerY: top + mapHeight + legendHeight,
      footerHeight
    };
  }

  function drawLegendLine(ctx, x, y, colour, label, width=42, dashed=false) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    if (dashed) ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#4f5559";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width + 8, y);
  }

  function drawLegendBox(ctx, x, y, fill, stroke, label, width=30) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.fillRect(x, y - 8, width, 16);
    ctx.strokeRect(x, y - 8, width, 16);

    ctx.fillStyle = "#4f5559";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + width + 8, y);
  }

  function drawWarningLegendEntry(ctx, x, y, profile) {
    const label = (profile?.legendLabel || "Warning") + (profile?.key === "thunderstorm" ? "" : " · BoM symbology");
    if (profile?.key === "thunderstorm") {
      drawLegendBox(ctx, x, y, "rgba(255,212,59,.28)", "#b45309", label);
    } else {
      drawLegendBox(ctx, x, y, "rgba(255,255,255,.8)", "#697177", label);
    }
  }

  function drawRadarLegend(ctx, product, active, trackingEnabled=false, profile=currentProfile()) {
    const y = product.legendY;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, y, product.canvas.width, product.legendHeight);
    ctx.strokeStyle = "#d4d6d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(product.canvas.width, y);
    ctx.stroke();

    let x = 16;
    const rowY = y + 21;
    if (active) {
      drawWarningLegendEntry(ctx, x, rowY, profile);
      x += profile?.key === "flooding" ? 280 : 250;
    }
    drawLegendLine(ctx, x, rowY, "#3e4549", "Queensland coastline / state border");
    x += 280;
    drawLegendLine(ctx, x, rowY, "rgba(101,107,111,.72)", "Local government area boundary", 36);

    ctx.fillStyle = "#3f4448";
    ctx.font = "700 11px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Radar rain rate (mm/h)", 16, y + 54);

    const barX = 155;
    const barY = y + 45;
    const available = product.canvas.width - barX - 16;
    const cellWidth = available / RAIN_RATE_LEGEND.length;
    RAIN_RATE_LEGEND.forEach(([label, colour], index) => {
      const sx = barX + index * cellWidth;
      ctx.fillStyle = colour;
      ctx.fillRect(sx, barY, cellWidth + 0.5, 16);
      ctx.strokeStyle = "rgba(70,75,80,.35)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(sx, barY, cellWidth + 0.5, 16);
      ctx.fillStyle = "#555b60";
      ctx.font = "8px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, sx + cellWidth / 2, barY + 20);
    });

    ctx.fillStyle = "#71767a";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      trackingEnabled
        ? "Thunderstorm cell tracking overlay: storm cell and direction."
        : "Bureau of Meteorology radar rain-rate symbology",
      16,
      y + 103
    );
  }

  function drawInfrastructureLegend(ctx, product, active, hasPointOutages=false, trackingEnabled=false, profile=currentProfile()) {
    const y = product.legendY;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, y, product.canvas.width, product.legendHeight);
    ctx.strokeStyle = "#d4d6d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(product.canvas.width, y);
    ctx.stroke();

    const row1 = y + 25;
    const row2 = y + 67;
    let x = 16;

    if (active) {
      drawWarningLegendEntry(ctx, x, row1, profile);
      x += profile?.key === "flooding" ? 280 : 250;
    }
    drawLegendLine(ctx, x, row1, "#3e4549", "Queensland coastline / state border");
    x += 280;
    drawLegendLine(ctx, x, row1, "rgba(101,107,111,.72)", "Local government area boundary", 36);

    x = 16;
    drawLegendBox(ctx, x, row2, "rgba(210,35,42,.22)", "#92141b", "Unplanned power outage area (⚡ number = customers affected)");
    x += 410;
    drawLegendLine(ctx, x, row2, "#bd1f24", "Road closed / impassable");
    x += 215;

    if (active) {
      drawLegendLine(ctx, x, row2, "#d97706", "Road restricted / conditional access");
    } else if (hasPointOutages) {
      ctx.fillStyle = "#bb181f";
      ctx.beginPath();
      ctx.arc(x + 8, row2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4f5559";
      ctx.font = "12px Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("Outage location where no polygon is available", x + 22, row2);
    }

    ctx.fillStyle = "#71767a";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      trackingEnabled
        ? "Thunderstorm cell tracking overlay: storm cell and direction."
        : "Road event names are intentionally omitted from the operational map.",
      16,
      y + 103
    );
  }

  function drawFooter(ctx, product, lines) {
    const y = product.footerY;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, y, product.canvas.width, product.footerHeight);
    ctx.strokeStyle = "#d4d6d8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(product.canvas.width, y);
    ctx.stroke();

    ctx.fillStyle = "#5b6064";
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.slice(0, 3).forEach((line, index) => {
      ctx.fillText(line, 14, y + 12 + index * 17);
    });
  }

  async function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("JPEG encoding failed.")),
        "image/jpeg",
        0.95
      );
    });
  }

  function aestDownloadTimestamp(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23"
    }).formatToParts(date);

    const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
    return [
      part("day"),
      part("month"),
      part("year"),
      part("hour") + part("minute")
    ].join("_");
  }

  function revokeOutputs() {
    outputUrls.forEach((url) => URL.revokeObjectURL(url));
    outputUrls = [];
  }

  function addMapCard(blob, title, filenameBase, meta, generatedDate) {
    const url = URL.createObjectURL(blob);
    outputUrls.push(url);

    const card = document.createElement("article");
    card.className = "map-card";

    const imageLink = document.createElement("a");
    imageLink.href = url;
    imageLink.target = "_blank";
    imageLink.rel = "noopener";

    const image = document.createElement("img");
    image.src = url;
    image.alt = title;
    imageLink.appendChild(image);

    const info = document.createElement("div");
    info.className = "map-info";

    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const p = document.createElement("p");
    p.textContent = meta;
    copy.append(heading, p);

    const download = document.createElement("a");
    download.className = "download";
    download.href = url;
    download.download = filenameBase + "_" + aestDownloadTimestamp(generatedDate) + ".jpg";
    download.textContent = "Download JPEG";

    info.append(copy, download);
    card.append(imageLink, info);
    mapsEl.appendChild(card);
  }

  async function buildProducts(
    extent, active, publicData, publicWarnings,
    profile=currentProfile(), selection=null, queenslandBoundary=null
  ) {
    const arcgis = window.MAPPING_ARCGIS;
    const requestedRenderExtent = geographicExtentToWebMercator(extent);
    const [mapWidth, mapHeight] = mapSize(requestedRenderExtent);

    const trackingEnabled = Boolean(profile.supportsTracking && cellTrackingToggle?.checked);
    const optionalTrackingTitles = trackingEnabled ? trackingTitles(profile) : [];
    const warningTitles = profileTitles(profile, "renderSublayerTitles");

    // ArcGIS Topographic is a Web Mercator basemap. Render it first and use
    // the exact extent actually displayed by MapView for every other layer.
    const basemapResult = arcgis.renderBasemapImage
      ? await arcgis.renderBasemapImage(
          requestedRenderExtent,
          mapWidth,
          mapHeight,
          { spatialReference: OUTPUT_SR }
        ).catch(() => null)
      : null;

    const renderExtent = Array.isArray(basemapResult?.extent)
      ? basemapResult.extent
      : requestedRenderExtent;

    const commonRenderOptions = { spatialReference: OUTPUT_SR };
    const renderJobs = [
      arcgis.renderWmsImage("warning", renderExtent, mapWidth, mapHeight, {
        ...commonRenderOptions,
        sublayerTitles: warningTitles
      }),
      arcgis.renderWmsImage("radar", renderExtent, mapWidth, mapHeight, commonRenderOptions)
    ];

    if (trackingEnabled && optionalTrackingTitles.length) {
      renderJobs.push(
        arcgis.renderWmsImage("warning", renderExtent, mapWidth, mapHeight, {
          ...commonRenderOptions,
          sublayerTitles: optionalTrackingTitles
        })
      );
    }

    const renderResults = await Promise.all(renderJobs);
    const warningResult = renderResults[0];
    const radarResult = renderResults[1];
    const trackingResult = renderResults[2] || null;

    const imageJobs = [
      blobToBitmap(warningResult.blob),
      blobToBitmap(radarResult.blob)
    ];
    if (trackingResult) imageJobs.push(blobToBitmap(trackingResult.blob));
    const basemapIndex = imageJobs.length;
    if (basemapResult?.blob) imageJobs.push(blobToBitmap(basemapResult.blob));

    const decoded = await Promise.all(imageJobs);
    const warningImage = decoded[0];
    const radarImage = decoded[1];
    const trackingImage = trackingResult ? decoded[2] : null;
    const basemapImage = basemapResult?.blob ? decoded[basemapIndex] : null;

    // Flooding retains its existing behaviour. Severe thunderstorm and severe
    // weather layers are clipped to the union of Queensland LGA polygons,
    // including the optional storm-cell/direction overlay. Radar is not clipped.
    const qldMask = profile.key === "flooding" ? null : makeQueenslandMaskCanvas(
      queenslandBoundary, mapWidth, mapHeight, makeTransform(renderExtent, mapWidth, mapHeight)
    );
    const warningOverlay = qldMask
      ? clipWmsImageToQueensland(warningImage, qldMask, mapWidth, mapHeight)
      : warningImage;
    const trackingOverlay = trackingImage && qldMask
      ? clipWmsImageToQueensland(trackingImage, qldMask, mapWidth, mapHeight)
      : trackingImage;
    const basemapAttribution = basemapResult?.attribution
      ? "Basemap: ArcGIS Topographic · " + basemapResult.attribution
      : "Basemap: built-in Queensland context · ArcGIS Topographic unavailable for this signed-in account.";

    const selectedLabel = selection?.title || "";
    const scopeText = active
      ? (selectedLabel || ("Current " + profile.activeScopeLabel + " extent"))
      : ("Queensland statewide · no active " + profile.activeScopeLabel + " detected");
    const generated = new Date();
    const stamp = generated.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) + " AEST";

    const activeRadarTitle = profile.key === "flooding"
      ? "Queensland Flooding + Radar"
      : "Queensland " + profile.outputTitle + " + Radar";
    const activeInfraTitle = profile.key === "flooding"
      ? "Queensland Flooding + Infrastructure Impacts"
      : "Queensland " + profile.outputTitle + " + Infrastructure Impacts";

    const radarProduct = makeProductCanvas(
      mapWidth,
      mapHeight,
      active ? activeRadarTitle : "Queensland Statewide Radar",
      scopeText
    );
    const rctx = radarProduct.ctx;
    rctx.save();
    rctx.translate(radarProduct.mapX, radarProduct.mapY);
    drawContext(rctx, mapWidth, mapHeight, renderExtent, publicData, active, basemapImage);

    // Warning fill/context sits below radar. Keep the radar at native/full
    // opacity so weak returns remain visible.
    rctx.drawImage(warningOverlay, 0, 0, mapWidth, mapHeight);
    rctx.globalAlpha = 1;
    rctx.drawImage(radarImage, 0, 0, mapWidth, mapHeight);

    if (trackingOverlay) rctx.drawImage(trackingOverlay, 0, 0, mapWidth, mapHeight);
    rctx.strokeStyle = "#454b4f";
    rctx.lineWidth = 1;
    rctx.strokeRect(0.5, 0.5, mapWidth - 1, mapHeight - 1);
    rctx.restore();
    drawRadarLegend(rctx, radarProduct, active, trackingEnabled, profile);
    drawFooter(rctx, radarProduct, [
      "Generated " + stamp,
      "Sources: Bureau of Meteorology warning/radar via ArcGIS · Queensland Government boundaries.",
      basemapAttribution
    ]);

    const infraProduct = makeProductCanvas(
      mapWidth,
      mapHeight,
      active ? activeInfraTitle : "Queensland Statewide Infrastructure Impacts",
      scopeText
    );
    const ictx = infraProduct.ctx;
    ictx.save();
    ictx.translate(infraProduct.mapX, infraProduct.mapY);
    const project = drawContext(ictx, mapWidth, mapHeight, renderExtent, publicData, active, basemapImage);
    ictx.drawImage(warningOverlay, 0, 0, mapWidth, mapHeight);
    if (trackingOverlay) ictx.drawImage(trackingOverlay, 0, 0, mapWidth, mapHeight);
    drawOutages(ictx, publicData.outagesNorm || [], project, !active);
    drawRoadConditions(ictx, publicData.roadsNorm || [], project);
    ictx.strokeStyle = "#454b4f";
    ictx.lineWidth = 1;
    ictx.strokeRect(0.5, 0.5, mapWidth - 1, mapHeight - 1);
    ictx.restore();

    const hasPointOutages = (publicData.outagesNorm || []).some((outage) =>
      outage.geometry?.type === "Point" || outage.geometry?.type === "MultiPoint"
    );
    drawInfrastructureLegend(ictx, infraProduct, active, hasPointOutages, trackingEnabled, profile);
    drawFooter(ictx, infraProduct, [
      "Generated " + stamp,
      "Sources: Bureau of Meteorology warning via ArcGIS · Queensland power outage feed · QLD Traffic · Queensland Government boundaries.",
      basemapAttribution
    ]);

    return {
      radarBlob: await canvasBlob(radarProduct.canvas),
      infraBlob: await canvasBlob(infraProduct.canvas),
      generated,
      trackingEnabled
    };
  }

  async function generateMaps() {
    if (!window.MAPPING_ARCGIS?.renderWmsImage) {
      setStatus("error", "Authenticated renderer is not ready", "Reconnect the standard ArcGIS feeds and try again.", "Not ready");
      return;
    }

    const profile = currentProfile();
    cameraAnalysisRun += 1;
    if (profile.key !== "flooding") resetCameraPanel("Generating warning mask…");
    generating = true;
    updateGenerateState();
    mapsEl.innerHTML = "";
    emptyEl.hidden = false;

    try {
      let warning;
      let selection = null;

      if (profile.key === "flooding") {
        if (!floodScanned) {
          await scanFloodProducts();
        }

        if (floodCandidates.length) {
          selection = floodCandidates.find((candidate) => candidate.id === selectedFloodCandidateId) || null;
          if (!selection) {
            setStatus("warning", "Select a flood product", "Choose the Flood Warning or Flood Watch you are mapping before generating.", "Select");
            return;
          }
          warning = { active: true, extent: selection.extent };
          emptyEl.textContent = "Loading public Queensland context for " + selection.title + "…";
        } else {
          warning = { active: false, extent: [...QLD_EXTENT] };
          emptyEl.textContent = "No active flood product detected; loading statewide Queensland context…";
        }
      } else {
        emptyEl.textContent = "Detecting current " + profile.activeScopeLabel + " extent from the authenticated warning WMS…";
        setStatus("warning", "Generating current maps…", "Checking the selected warning layer, loading public Queensland context and rendering the two products.", "Generating");
        warning = await detectWarningExtent(profile);
      }

      const extent = warning.extent;
      const statewide = !warning.active;

      if (profile.key !== "flooding") {
        const cameraRunId = ++cameraAnalysisRun;
        void analyseCamerasForWarning(warning, profile, cameraRunId);
      }

      if (warningCount && profile.key !== "flooding") warningCount.textContent = warning.active ? "Active" : "0";
      if (modeEl) modeEl.textContent = statewide ? "Statewide" : (selection?.typeLabel || "Warning extent");

      emptyEl.textContent = "Loading public Queensland context, outage and road-condition data…";
      const { data, warnings } = await loadPublicData(extent, statewide, {
        includeDisasterDistricts: profile.key !== "flooding",
        queenslandBoundary: warning.queenslandBoundary || null
      });

      if (profile.key !== "flooding") {
        renderAffectedAreas(analyseAffectedAreas(warning, data));
      }

      emptyEl.textContent = "Rendering authenticated weather imagery and composing JPEG products…";
      const products = await buildProducts(
        extent, warning.active, data, warnings, profile, selection, warning.queenslandBoundary || null
      );

      revokeOutputs();
      mapsEl.innerHTML = "";

      const prefix = profile.filenamePrefix || "warning";
      const radarCardTitle = warning.active
        ? (profile.key === "flooding" ? "Flooding + Radar" : "Warning + Radar")
        : "Statewide Radar";
      const infraCardTitle = warning.active
        ? (profile.key === "flooding" ? "Flooding + Infrastructure Impacts" : "Warning + Infrastructure Impacts")
        : "Statewide Infrastructure Impacts";
      const selectionMeta = selection ? " · " + selection.title : "";

      addMapCard(
        products.radarBlob,
        radarCardTitle,
        warning.active ? prefix + "-radar-combined" : prefix + "-radar-statewide",
        (warning.active ? "radar · selected warning extent" : "radar · statewide") +
          selectionMeta +
          (products.trackingEnabled ? " · cell tracking" : ""),
        products.generated
      );
      addMapCard(
        products.infraBlob,
        infraCardTitle,
        warning.active ? prefix + "-infrastructure-combined" : prefix + "-infrastructure-statewide",
        (warning.active ? "infrastructure · selected warning extent" : "infrastructure · statewide") +
          selectionMeta +
          (products.trackingEnabled ? " · cell tracking" : ""),
        products.generated
      );

      emptyEl.hidden = true;
      if (generatedAt) {
        generatedAt.textContent = products.generated.toLocaleTimeString("en-AU", {
          timeZone: "Australia/Brisbane",
          hour: "2-digit",
          minute: "2-digit"
        }) + " AEST";
      }

      const activeMessage = selection
        ? "The two products use the selected flood product extent: " + selection.title + "."
        : "The two products use the combined detected extent of the current authenticated " + profile.activeScopeLabel + ".";
      const statewideMessage = "No active " + profile.activeScopeLabel + " pixels were detected within Queensland, so the two products use the statewide extent.";

      setStatus(
        warnings.length ? "warning" : "ok",
        warning.active ? "Current maps generated" : "Statewide maps generated",
        warning.active ? activeMessage : statewideMessage,
        warnings.length ? "Partial" : "Current"
      );
    } catch (error) {
      mapsEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = cleanMessage(error);
      setStatus("error", "Map generation failed", cleanMessage(error), "Error");
    } finally {
      generating = false;
      updateGenerateState();
    }
  }

  if (cellTrackingToggle) {
    cellTrackingToggle.checked = loadTrackingPreference();
    cellTrackingToggle.addEventListener("change", () => {
      saveTrackingPreference(cellTrackingToggle.checked);
    });
  }

  profileButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.warningProfile;
      if (!key || !PROFILES[key]) return;
      setActiveProfile(key, { persist: true, scanFloods: true });
    });
  });

  refreshFloodProductsButton?.addEventListener("click", () => {
    scanFloodProducts().catch(() => {});
  });

  window.addEventListener("mapping:arcgis-ready", () => {
    adminBoundaryState.localGovernment = { status: "resolving", layer: null, error: "" };
    adminBoundaryState.disasterDistricts = { status: "resolving", layer: null, error: "" };
    renderBoundarySourceState();
  });

  window.addEventListener("mapping:arcgis-admin-boundaries", (event) => {
    updateBoundaryDiscoveryState(event.detail || {});
  });

  window.addEventListener("mapping:arcgis-sources", (event) => {
    feedsReady = Boolean(event.detail?.ready);
    updateProfileControls();
    if (feedsReady && currentProfile().key === "flooding" && !floodScanned && !scanningFloods) {
      scanFloodProducts().catch(() => {});
    }
  });

  generateButton?.addEventListener("click", generateMaps);

  updateProfileControls();
  renderBoundarySourceState();
  resetCameraPanel();
  if (modeEl) modeEl.textContent = currentProfile().label;
  updateWarningSourceDetail();
})();
