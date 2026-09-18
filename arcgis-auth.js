const cfg = window.MAPPING_CONFIG?.arcgis || {};
const ORG_KEY = "mapping.arcgis.orgPrefix";
const SOURCE_KEY = "mapping.arcgis.standardSources.";

const q = (selector) => document.querySelector(selector);
const ui = {
  gate: q("#loginGate"),
  shell: q("#appShell"),
  form: q("#arcgisLoginForm"),
  org: q("#orgPrefix"),
  login: q("#arcgisLoginButton"),
  status: q("#loginStatus"),
  user: q("#arcgisAccountName"),
  host: q("#arcgisAccountOrg"),
  signOut: q("#arcgisSignOut"),
  reconnect: q("#reconnectSources"),
  warning: q("#warningLayerSelection"),
  warningState: q("#warningLayerState"),
  warningDetail: q("#warningLayerDetail"),
  radar: q("#radarLayerSelection"),
  radarState: q("#radarLayerState"),
  radarDetail: q("#radarLayerDetail")
};

let esriId;
let OAuthInfo;
let Portal;
let PortalItem;
let WMSLayer;
let esriRequest;
let portal;
let portalUrl;

const runtimeSources = new Map();

function getLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setLocal(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function removeLocal(key) {
  try { localStorage.removeItem(key); } catch {}
}

function orgPrefix(value) {
  return String(value || "").trim().toLowerCase();
}

function validPrefix(value) {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

function sourceStorageKey(role) {
  return SOURCE_KEY + orgPrefix(getLocal(ORG_KEY)) + "." + role;
}

function loadSavedSource(role) {
  try {
    return JSON.parse(getLocal(sourceStorageKey(role)) || "null");
  } catch {
    return null;
  }
}

function saveSource(role, source) {
  setLocal(sourceStorageKey(role), JSON.stringify(source));
}

function authStatus(message = "", type = "info") {
  if (!ui.status) return;
  ui.status.textContent = message;
  ui.status.className = "auth-status " + type;
  ui.status.hidden = !message;
}

function showLogin(message = "", type = "info") {
  if (ui.gate) ui.gate.hidden = false;
  if (ui.shell) ui.shell.hidden = true;

  const saved = orgPrefix(getLocal(ORG_KEY));
  if (ui.org && validPrefix(saved)) ui.org.value = saved;

  if (ui.login) {
    ui.login.disabled = false;
    ui.login.textContent = "Continue with ArcGIS";
  }

  authStatus(message, type);
}

function sourceUi(role) {
  return role === "warning"
    ? { title: ui.warning, state: ui.warningState, detail: ui.warningDetail }
    : { title: ui.radar, state: ui.radarState, detail: ui.radarDetail };
}

function safeMessage(error, fallback="Source request failed.") {
  const raw = String(error?.message || error || fallback);
  if (/403|forbidden/i.test(raw)) return "The authenticated WMS item was found, but direct browser access is not permitted by the service.";
  if (/failed to fetch|cors|network/i.test(raw)) return "The authenticated WMS item was found, but the service does not permit direct requests from this web origin.";
  if (/not found/i.test(raw)) return raw.replace(/https?:\/\/\S+/gi, "[private service]");
  return raw
    .replace(/https?:\/\/\S+/gi, "[private service]")
    .replace(/([?&](?:subscription[-_]?key|token|key|apikey|api_key)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 320);
}

function renderSourceState(role, state, message) {
  const refs = sourceUi(role);
  const spec = cfg.standardSources?.[role] || {};

  if (refs.title) {
    refs.title.textContent = spec.itemTitle || "Standard ArcGIS WMS";
    refs.title.classList.toggle("configured", state === "connected");
  }

  if (refs.state) {
    refs.state.textContent = state === "connected"
      ? "Connected"
      : (state === "error" ? "Unavailable" : "Connecting");
    refs.state.className = "source-status " + (
      state === "connected" ? "ok" : (state === "error" ? "error" : "warning")
    );
  }

  if (refs.detail) {
    refs.detail.textContent = message || (
      spec.sublayerTitle
        ? "Sublayer: " + spec.sublayerTitle
        : "Resolving standard authenticated source…"
    );
  }
}

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemMatchesSpec(item, spec) {
  return normalise(item?.title) === normalise(spec.itemTitle)
    && normalise(item?.type) === normalise(spec.itemType || "WMS");
}

function normalisePortalItem(item, groupTitles = []) {
  return {
    itemId: item.id,
    title: item.title || item.id,
    type: item.type || null,
    owner: item.owner || null,
    modified: item.modified || null,
    groupTitles: [...new Set(groupTitles.filter(Boolean))]
  };
}

async function findSharedItems(spec) {
  const groups = await portal.user?.fetchGroups();
  if (!groups?.length) return [];

  const query = 'title:"' + String(spec.itemTitle).replaceAll('"', '\\"') + '" AND type:"WMS"';
  const settled = await Promise.allSettled(groups.map(async (group) => {
    const result = await group.queryItems({
      query,
      num: 100,
      sortField: "modified",
      sortOrder: "desc"
    });
    return { group, items: result.results || [] };
  }));

  const byId = new Map();
  settled.forEach((entry) => {
    if (entry.status !== "fulfilled") return;
    const groupTitle = entry.value.group?.title || "ArcGIS group";

    entry.value.items.forEach((item) => {
      if (!itemMatchesSpec(item, spec)) return;

      const existing = byId.get(item.id);
      if (existing) {
        existing.groupTitles = [...new Set([...existing.groupTitles, groupTitle])];
      } else {
        byId.set(item.id, normalisePortalItem(item, [groupTitle]));
      }
    });
  });

  return [...byId.values()];
}

async function findAccessibleItems(spec) {
  const query = 'title:"' + String(spec.itemTitle).replaceAll('"', '\\"') + '" AND type:"WMS"';
  const result = await portal.queryItems({
    query,
    num: 100,
    sortField: "modified",
    sortOrder: "desc"
  });

  return (result.results || [])
    .filter((item) => itemMatchesSpec(item, spec))
    .map((item) => normalisePortalItem(item));
}

async function locateStandardItem(role) {
  const spec = cfg.standardSources?.[role];
  if (!spec) throw new Error("No standard " + role + " source is configured.");

  const saved = loadSavedSource(role);
  if (saved?.itemId && itemMatchesSpec(saved, spec)) return saved;

  const shared = await findSharedItems(spec);
  const accessible = shared.length ? shared : await findAccessibleItems(spec);
  if (!accessible.length) {
    throw new Error('The standard ArcGIS item "' + spec.itemTitle + '" is not accessible to this account.');
  }

  accessible.sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0));
  return accessible[0];
}

function findTargetSublayer(layer, wantedTitle) {
  const wanted = normalise(wantedTitle);
  return layer.allSublayers?.find((sublayer) => {
    return normalise(sublayer.title) === wanted || normalise(sublayer.name) === wanted;
  }) || null;
}

function findSublayerMetadata(value, wantedTitle, seen=new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  const wanted = normalise(wantedTitle);
  const title = normalise(value.title);
  const name = normalise(value.name);

  if ((title === wanted || name === wanted) && value.name) {
    return {
      name: String(value.name),
      title: String(value.title || wantedTitle)
    };
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSublayerMetadata(entry, wantedTitle, seen);
      if (found) return found;
    }
    return null;
  }

  for (const child of Object.values(value)) {
    const found = findSublayerMetadata(child, wantedTitle, seen);
    if (found) return found;
  }
  return null;
}

async function getPortalItemAndData(source) {
  const portalItem = new PortalItem({ id: source.itemId, portal });
  await portalItem.load();

  let data = null;
  try {
    data = await portalItem.fetchData();
  } catch {}

  return { portalItem, data, serviceUrl: portalItem.url || null };
}

async function renderWmsPrintImage(role, extent, width, height, sourceOverride=null, metadataOverride=null, options={}) {
  const spec = cfg.standardSources?.[role];
  const source = sourceOverride || runtimeSources.get(role)?.source || loadSavedSource(role);
  if (!spec || !source?.itemId) throw new Error("The standard " + role + " WMS has not been resolved.");

  const printTask = portal.helperServices?.printTask?.url;
  if (!printTask) throw new Error("This ArcGIS organisation does not advertise a print service.");

  const { data, serviceUrl } = await getPortalItemAndData(source);
  if (!serviceUrl) throw new Error("The authenticated WMS item does not expose a service URL.");

  const metadata = metadataOverride || findSublayerMetadata(data, spec.sublayerTitle);
  const requestedTitles = Array.isArray(options?.sublayerTitles) && options.sublayerTitles.length
    ? options.sublayerTitles
    : [spec.sublayerTitle];

  const resolvedSublayers = requestedTitles.map((title) => {
    const configuredByTitle = spec.wmsLayerNames && typeof spec.wmsLayerNames === "object"
      ? String(spec.wmsLayerNames[title] || "").trim()
      : "";

    if (configuredByTitle) {
      const liveMetadata = findSublayerMetadata(data, title);
      if (liveMetadata?.name && normalise(liveMetadata.name) !== normalise(configuredByTitle)) {
        throw new Error(
          'WMS sublayer mapping changed for "' + title + '": expected "' +
          configuredByTitle + '" but ArcGIS metadata reports "' + liveMetadata.name + '".'
        );
      }

      return {
        name: configuredByTitle,
        title
      };
    }

    if (normalise(title) === normalise(spec.sublayerTitle)) {
      const configuredNativeName = String(spec.wmsLayerName || "").trim();
      if (configuredNativeName || source.sublayerName) {
        const chosenName = configuredNativeName || source.sublayerName;
        const liveMetadata = findSublayerMetadata(data, spec.sublayerTitle);
        if (liveMetadata?.name && normalise(liveMetadata.name) !== normalise(chosenName)) {
          throw new Error(
            'WMS sublayer mapping changed for "' + spec.sublayerTitle + '": expected "' +
            chosenName + '" but ArcGIS metadata reports "' + liveMetadata.name + '".'
          );
        }

        return {
          name: chosenName,
          title: spec.sublayerTitle
        };
      }
    }

    const found = findSublayerMetadata(data, title);
    if (!found?.name) {
      throw new Error('Required WMS sublayer is not available: "' + title + '".');
    }
    return found;
  });

  const sublayerNames = [...new Set(resolvedSublayers.map((entry) => entry.name))];
  const taskUrl = String(printTask).replace(/\/$/, "") + "/execute";
  const bounds = Array.isArray(extent) ? extent : [extent.xmin, extent.ymin, extent.xmax, extent.ymax];

  const webMap = {
    mapOptions: {
      extent: {
        xmin: bounds[0],
        ymin: bounds[1],
        xmax: bounds[2],
        ymax: bounds[3],
        spatialReference: { wkid: 4326 }
      },
      background: {
        color: [255, 255, 255, 0]
      }
    },
    operationalLayers: [{
      url: serviceUrl,
      title: spec.itemTitle,
      type: "wms",
      opacity: 1,
      version: "1.3.0",
      format: "png32",
      transparentBackground: true,
      layers: sublayerNames.map((name) => ({ name })),
      visibleLayers: sublayerNames
    }],
    exportOptions: {
      outputSize: [Math.max(64, Math.round(width)), Math.max(64, Math.round(height))],
      dpi: 96
    }
  };

  const response = await esriRequest(taskUrl, {
    method: "post",
    responseType: "json",
    authMode: "auto",
    query: {
      Web_Map_as_JSON: JSON.stringify(webMap),
      Format: "PNG32",
      Layout_Template: "MAP_ONLY",
      f: "json"
    }
  });

  const payload = response?.data || {};
  if (payload.error) throw new Error(payload.error.message || "ArcGIS print service rejected the WMS.");
  const output = (payload.results || []).find((entry) => entry.paramName === "Output_File")?.value?.url;
  if (!output) throw new Error("ArcGIS print service returned no map image.");

  const imageResponse = await esriRequest(output, {
    responseType: "blob",
    authMode: "auto"
  });

  return {
    blob: imageResponse.data,
    url: output,
    sublayerName: sublayerNames[0],
    sublayerTitle: resolvedSublayers[0]?.title || metadata?.title || spec.sublayerTitle,
    sublayerNames,
    sublayerTitles: resolvedSublayers.map((entry) => entry.title)
  };
}

async function testPrintServiceWms(role, source, metadata) {
  const result = await renderWmsPrintImage(
    role,
    [137.8, -29.3, 154.2, -9.0],
    420,
    520,
    source,
    metadata
  );

  return {
    mode: "arcgis-print-service",
    sublayerName: result.sublayerName,
    sublayerTitle: result.sublayerTitle
  };
}
async function createConfiguredWmsLayer(role, sourceOverride = null) {
  const spec = cfg.standardSources?.[role];
  const source = sourceOverride || runtimeSources.get(role)?.source || loadSavedSource(role);

  if (!spec || !source?.itemId) {
    throw new Error("The standard " + role + " WMS has not been resolved.");
  }

  const { portalItem, data } = await getPortalItemAndData(source);
  const metadata = findSublayerMetadata(data, spec.sublayerTitle);

  // Prefer normal browser WMS loading when the upstream service supports CORS.
  try {
    const layer = new WMSLayer({
      portalItem,
      title: spec.itemTitle,
      sublayers: metadata?.name ? [{ name: metadata.name }] : [{ name: spec.sublayerTitle }]
    });
    await layer.load();

    const sublayer = findTargetSublayer(layer, spec.sublayerTitle) || layer.sublayers?.at?.(0);
    if (!sublayer) throw new Error("Required operational sublayer was not available.");

    layer.sublayers = [sublayer];
    return {
      mode: "browser-wms",
      layer,
      sublayerName: sublayer.name,
      sublayerTitle: sublayer.title || spec.sublayerTitle
    };
  } catch (browserError) {
    // Pure client-side WMS rendering is impossible when the upstream WMS does
    // not allow this origin. Use the organisation's configured ArcGIS print
    // service as the authenticated rendering fallback.
    try {
      return await testPrintServiceWms(role, source, metadata);
    } catch (printError) {
      const error = new Error(
        "The WMS item is accessible, but neither direct browser rendering nor the ArcGIS print-service fallback succeeded."
      );
      error.cause = { browserError, printError };
      throw error;
    }
  }
}

async function resolveStandardSource(role) {
  const spec = cfg.standardSources?.[role];
  renderSourceState(role, "connecting", "Locating shared WMS and verifying the required sublayer…");

  const source = await locateStandardItem(role);
  const verified = await createConfiguredWmsLayer(role, source);

  const saved = {
    itemId: source.itemId,
    title: source.title || spec.itemTitle,
    type: source.type || spec.itemType,
    owner: source.owner || null,
    modified: source.modified || null,
    groupTitles: source.groupTitles || [],
    itemTitle: spec.itemTitle,
    sublayerTitle: spec.sublayerTitle,
    sublayerName: verified.sublayerName,
    renderMode: verified.mode,
    verifiedAt: new Date().toISOString()
  };

  saveSource(role, saved);
  runtimeSources.set(role, { source: saved, verified });

  renderSourceState(
    role,
    "connected",
    "Sublayer: " + spec.sublayerTitle + " · " + (
      verified.mode === "browser-wms" ? "direct browser WMS" : "ArcGIS print-service rendering"
    )
  );

  return saved;
}

async function resolveAllStandardSources(clearCached = false) {
  if (clearCached) {
    ["warning", "radar"].forEach((role) => {
      removeLocal(sourceStorageKey(role));
      runtimeSources.delete(role);
    });
  }

  if (ui.reconnect) {
    ui.reconnect.disabled = true;
    ui.reconnect.textContent = "Checking sources…";
  }

  const results = {};
  for (const role of ["warning", "radar"]) {
    try {
      results[role] = { ok: true, source: await resolveStandardSource(role) };
    } catch (error) {
      runtimeSources.delete(role);
      const message = safeMessage(error, "The standard authenticated WMS could not be verified.");
      renderSourceState(role, "error", message);
      results[role] = { ok: false, error: message };
    }
  }

  if (ui.reconnect) {
    ui.reconnect.disabled = false;
    ui.reconnect.textContent = "Reconnect standard feeds";
  }

  window.dispatchEvent(new CustomEvent("mapping:arcgis-sources", {
    detail: {
      ready: Boolean(results.warning?.ok && results.radar?.ok),
      warning: results.warning,
      radar: results.radar
    }
  }));

  return results;
}

function configure(prefixValue) {
  portalUrl = "https://" + prefixValue + ".maps.arcgis.com";

  esriId.registerOAuthInfos([
    new OAuthInfo({
      appId: cfg.clientId,
      portalUrl,
      flowType: "authorization-code",
      popup: false,
      preserveUrlHash: true
    })
  ]);
}

async function showApp() {
  portal = new Portal({ url: portalUrl, authMode: "immediate" });
  await portal.load();

  if (ui.gate) ui.gate.hidden = true;
  if (ui.shell) ui.shell.hidden = false;

  if (ui.user) ui.user.textContent = portal.user?.fullName || portal.user?.username || "ArcGIS user";
  if (ui.host) ui.host.textContent = orgPrefix(getLocal(ORG_KEY)) + ".maps.arcgis.com";

  await resolveAllStandardSources(false);

  window.MAPPING_ARCGIS = {
    portal,
    portalUrl,
    resolveStandardSources: resolveAllStandardSources,
    getSource(role) {
      return runtimeSources.get(role)?.source || loadSavedSource(role);
    },
    createWmsLayer(role) {
      return createConfiguredWmsLayer(role);
    },
    renderWmsImage(role, extent, width, height, options={}) {
      return renderWmsPrintImage(role, extent, width, height, null, null, options);
    }
  };

  window.dispatchEvent(new CustomEvent("mapping:arcgis-ready", {
    detail: { portal, portalUrl }
  }));
}

async function startLogin(value) {
  const prefixValue = orgPrefix(value);

  if (!validPrefix(prefixValue)) {
    authStatus("Enter only the organisation prefix, without https://, dots, slashes or a path.", "error");
    return;
  }

  if (!cfg.clientId) {
    authStatus("ArcGIS OAuth is not configured for this site.", "error");
    return;
  }

  setLocal(ORG_KEY, prefixValue);

  if (ui.login) {
    ui.login.disabled = true;
    ui.login.textContent = "Opening ArcGIS…";
  }

  configure(prefixValue);
  await esriId.getCredential(portalUrl + "/sharing");
  await showApp();
}

async function init() {
  [OAuthInfo, esriId, Portal, PortalItem, WMSLayer, esriRequest] = await $arcgis.import([
    "@arcgis/core/identity/OAuthInfo.js",
    "@arcgis/core/identity/IdentityManager.js",
    "@arcgis/core/portal/Portal.js",
    "@arcgis/core/portal/PortalItem.js",
    "@arcgis/core/layers/WMSLayer.js",
    "@arcgis/core/request.js"
  ]);

  ui.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    startLogin(ui.org.value).catch((error) => {
      showLogin("ArcGIS sign-in failed: " + (error?.message || error), "error");
    });
  });

  ui.signOut?.addEventListener("click", () => {
    esriId.destroyCredentials();
    portal = null;
    runtimeSources.clear();
    window.MAPPING_ARCGIS = null;
    showLogin("Signed out of this application. Your organisation SSO session may remain active in the browser.");
  });

  ui.reconnect?.addEventListener("click", () => {
    void resolveAllStandardSources(true);
  });

  const savedPrefix = orgPrefix(getLocal(ORG_KEY));
  if (!validPrefix(savedPrefix)) {
    showLogin();
    return;
  }

  try {
    configure(savedPrefix);
    await esriId.checkSignInStatus(portalUrl + "/sharing");
    await showApp();
  } catch {
    showLogin();
  }
}

init().catch((error) => {
  showLogin("ArcGIS authentication could not initialise: " + (error?.message || error), "error");
});
