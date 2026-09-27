const cfg = window.MAPPING_CONFIG?.arcgis || {};
const ORG_KEY = "mapping.arcgis.orgPrefix";
const SOURCE_KEY = "mapping.arcgis.standardSources.";
const ADMIN_KEY = "mapping.arcgis.administrativeLayers.";

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
let ArcGISMap;
let MapView;
let reactiveUtils;
let esriRequest;
let portal;
let portalUrl;

const runtimeSources = new Map();
const runtimeAdminLayers = new Map();
const runtimeCameraLayers = new Map();
const cameraLayerPromises = new Map();

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

function adminStorageKey(key) {
  return ADMIN_KEY + orgPrefix(getLocal(ORG_KEY)) + "." + key;
}

function loadSavedAdminLayer(key) {
  try {
    return JSON.parse(getLocal(adminStorageKey(key)) || "null");
  } catch {
    return null;
  }
}

function saveAdminLayer(key, layer) {
  const safe = {
    itemId: layer.itemId,
    itemTitle: layer.itemTitle || null,
    itemType: layer.itemType || null,
    modified: layer.modified || null,
    layerId: Number.isFinite(Number(layer.layerId)) ? Number(layer.layerId) : null,
    layerTitle: layer.layerTitle || null,
    sourceType: layer.sourceType || null,
    nameField: layer.nameField || null,
    path: Array.isArray(layer.path) ? layer.path.slice(0, 12) : [],
    verifiedAt: new Date().toISOString()
  };
  setLocal(adminStorageKey(key), JSON.stringify(safe));
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

function adminLayerPathScore(path, spec) {
  const values = (path || []).map(normalise).filter(Boolean);
  const leaf = normalise(spec?.leafTitle);
  let score = values.includes(leaf) ? 500 : 0;

  const hints = (spec?.pathHints || []).map(normalise).filter(Boolean);
  hints.forEach((hint, index) => {
    if (values.includes(hint)) score += 40 + index * 8;
  });

  if (hints.length && values.length >= hints.length) {
    const suffix = values.slice(-hints.length);
    if (suffix.every((value, index) => value === hints[index])) score += 500;
  }

  return score;
}

function administrativeLayerUrl(baseUrl, layerId) {
  const clean = String(baseUrl || "").replace(/\/$/, "");
  if (!clean) return null;
  if (/\/(?:FeatureServer|MapServer)\/\d+$/i.test(clean)) return clean;

  const numericId = Number(layerId);
  if (Number.isFinite(numericId) && /\/(?:FeatureServer|MapServer)$/i.test(clean)) {
    return clean + "/" + numericId;
  }
  return clean;
}

function findConfiguredAdministrativeNodes(value, spec, path=[], inheritedUrl=null, output=[], seen=new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => findConfiguredAdministrativeNodes(entry, spec, path, inheritedUrl, output, seen));
    return output;
  }

  const label = String(value.title || value.name || "").trim();
  const nextPath = label ? [...path, label] : path;
  const nextUrl = typeof value.url === "string" && value.url ? value.url : inheritedUrl;

  let layerId = value.layerId;
  if (layerId == null && (typeof value.id === "number" || /^\d+$/.test(String(value.id || "")))) {
    layerId = Number(value.id);
  }

  if (label && normalise(label) === normalise(spec.leafTitle)) {
    const url = administrativeLayerUrl(nextUrl, layerId);
    if (url) {
      output.push({
        url,
        layerId: Number.isFinite(Number(layerId)) ? Number(layerId) : null,
        layerTitle: label,
        path: nextPath,
        score: adminLayerPathScore(nextPath, spec)
      });
    }
  }

  Object.values(value).forEach((child) => {
    if (child && typeof child === "object") {
      findConfiguredAdministrativeNodes(child, spec, nextPath, nextUrl, output, seen);
    }
  });

  return output;
}

function findServiceAdministrativeNodes(serviceMetadata, serviceUrl, itemTitle, spec) {
  const output = [];
  const layers = Array.isArray(serviceMetadata?.layers) ? serviceMetadata.layers : [];
  if (!layers.length) return output;

  const byId = new Map(layers.map((layer) => [Number(layer.id), layer]));
  const pathFor = (layer) => {
    const names = [];
    const visited = new Set();
    let current = layer;
    while (current && !visited.has(Number(current.id))) {
      visited.add(Number(current.id));
      if (current.name) names.unshift(String(current.name));
      const parentId = Number(current.parentLayerId);
      current = Number.isFinite(parentId) && parentId >= 0 ? byId.get(parentId) : null;
    }
    if (itemTitle && normalise(names[0]) !== normalise(itemTitle)) names.unshift(itemTitle);
    return names;
  };

  layers.forEach((layer) => {
    if (normalise(layer.name) !== normalise(spec.leafTitle)) return;
    const path = pathFor(layer);
    output.push({
      url: administrativeLayerUrl(serviceUrl, layer.id),
      layerId: Number(layer.id),
      layerTitle: String(layer.name || spec.leafTitle),
      path,
      score: adminLayerPathScore(path, spec)
    });
  });

  return output;
}

async function verifyAdministrativeCandidate(candidate, portalItem, spec) {
  if (!candidate?.url) return null;
  const response = await esriRequest(candidate.url, {
    responseType: "json",
    authMode: "auto",
    query: { f: "json" }
  });
  const metadata = response?.data || {};
  const geometryType = String(metadata.geometryType || "");
  if (!/polygon/i.test(geometryType)) return null;

  const capabilities = String(metadata.capabilities || "");
  if (capabilities && !/query/i.test(capabilities)) return null;

  const path = Array.isArray(candidate.path) && candidate.path.length
    ? candidate.path
    : [candidate.layerTitle || metadata.name || spec.leafTitle];

  return {
    itemId: portalItem.id,
    itemTitle: portalItem.title || portalItem.id,
    itemType: portalItem.type || null,
    modified: portalItem.modified || null,
    layerId: Number.isFinite(Number(candidate.layerId)) ? Number(candidate.layerId) : Number(metadata.id),
    layerTitle: String(metadata.name || candidate.layerTitle || spec.leafTitle),
    path,
    geometryType,
    queryUrl: candidate.url,
    score: Number(candidate.score || 0)
  };
}

async function inspectAdministrativeItem(item, spec) {
  const portalItem = item instanceof PortalItem
    ? item
    : new PortalItem({ id: item?.id || item?.itemId, portal });
  await portalItem.load();

  let data = null;
  try {
    data = await portalItem.fetchData();
  } catch {}

  const candidates = findConfiguredAdministrativeNodes(
    data,
    spec,
    portalItem.title ? [portalItem.title] : []
  );

  if (portalItem.url) {
    try {
      const serviceResponse = await esriRequest(portalItem.url, {
        responseType: "json",
        authMode: "auto",
        query: { f: "json" }
      });
      const metadata = serviceResponse?.data || {};
      candidates.push(...findServiceAdministrativeNodes(metadata, portalItem.url, portalItem.title, spec));

      const directTitle = String(metadata.name || portalItem.title || "");
      if (/polygon/i.test(String(metadata.geometryType || "")) &&
          normalise(directTitle) === normalise(spec.leafTitle)) {
        candidates.push({
          url: portalItem.url,
          layerId: Number.isFinite(Number(metadata.id)) ? Number(metadata.id) : null,
          layerTitle: directTitle,
          path: [portalItem.title || directTitle],
          score: 600
        });
      }
    } catch {}
  }

  const unique = new Map();
  candidates.forEach((candidate) => {
    const key = String(candidate.url || "");
    const previous = unique.get(key);
    if (!previous || Number(candidate.score || 0) > Number(previous.score || 0)) {
      unique.set(key, candidate);
    }
  });

  const ordered = [...unique.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  for (const candidate of ordered) {
    try {
      const verified = await verifyAdministrativeCandidate(candidate, portalItem, spec);
      if (verified) return verified;
    } catch {}
  }

  return null;
}

async function findAdministrativeItems(spec) {
  const terms = [...new Set([
    spec.leafTitle,
    ...(Array.isArray(spec.pathHints) ? spec.pathHints : [])
  ].map((value) => String(value || "").trim()).filter(Boolean))];

  const byId = new Map();
  for (const term of terms) {
    try {
      const escaped = term.replaceAll('"', '\\"');
      const result = await portal.queryItems({
        query: 'title:"' + escaped + '"',
        num: 100,
        sortField: "modified",
        sortOrder: "desc"
      });
      (result.results || []).forEach((item) => {
        if (!["web map", "feature service", "map service"].includes(normalise(item.type))) return;
        if (!byId.has(item.id)) byId.set(item.id, item);
      });
    } catch {}
  }

  // If the hierarchy is embedded inside a user's Web Map, its group-layer
  // titles may not be indexed as portal item titles. Include recent Web Maps
  // owned by the signed-in user as a bounded fallback discovery set.
  const username = String(portal.user?.username || "").trim();
  if (username) {
    try {
      const result = await portal.queryItems({
        query: 'owner:"' + username.replaceAll('"', '\\"') + '" AND type:"Web Map"',
        num: 50,
        sortField: "modified",
        sortOrder: "desc"
      });
      (result.results || []).forEach((item) => {
        if (!byId.has(item.id)) byId.set(item.id, item);
      });
    } catch {}
  }

  return [...byId.values()].sort((a, b) => {
    const aTitle = normalise(a.title);
    const bTitle = normalise(b.title);
    const leaf = normalise(spec.leafTitle);
    const root = normalise(spec.pathHints?.[0]);
    const aScore = (aTitle === leaf ? 200 : 0) + (aTitle === root ? 120 : 0) + Number(a.modified || 0) / 1e13;
    const bScore = (bTitle === leaf ? 200 : 0) + (bTitle === root ? 120 : 0) + Number(b.modified || 0) / 1e13;
    return bScore - aScore;
  });
}

function publicAdministrativeLayer(layer) {
  if (!layer) return null;
  return {
    key: layer.key,
    available: true,
    sourceType: layer.sourceType || "authenticated",
    title: layer.layerTitle,
    itemTitle: layer.itemTitle,
    path: Array.isArray(layer.path) ? [...layer.path] : [],
    geometryType: layer.geometryType || "esriGeometryPolygon",
    nameField: layer.nameField || null
  };
}

async function findExactAdministrativePortalItem(spec) {
  const wantedTitle = normalise(spec.itemTitle);
  const byId = new Map();

  try {
    const result = await portal.queryItems({
      query: 'title:"' + String(spec.itemTitle).replaceAll('"', '\\"') + '"',
      num: 100,
      sortField: "modified",
      sortOrder: "desc"
    });
    (result.results || []).forEach((item) => {
      if (normalise(item.title) !== wantedTitle) return;
      byId.set(item.id, item);
    });
  } catch {}

  if (!byId.size) {
    try {
      const groups = await portal.user?.fetchGroups();
      const settled = await Promise.allSettled((groups || []).map(async (group) => {
        const result = await group.queryItems({
          query: 'title:"' + String(spec.itemTitle).replaceAll('"', '\\"') + '"',
          num: 50,
          sortField: "modified",
          sortOrder: "desc"
        });
        return result.results || [];
      }));
      settled.forEach((entry) => {
        if (entry.status !== "fulfilled") return;
        entry.value.forEach((item) => {
          if (normalise(item.title) !== wantedTitle) return;
          byId.set(item.id, item);
        });
      });
    } catch {}
  }

  return [...byId.values()].sort((a, b) => Number(b.modified || 0) - Number(a.modified || 0))[0] || null;
}

async function resolveExactPortalAdministrativeLayer(key, spec, saved=null) {
  let portalItem = null;

  if (saved?.itemId) {
    try {
      const candidate = new PortalItem({ id: saved.itemId, portal });
      await candidate.load();
      if (normalise(candidate.title) === normalise(spec.itemTitle)) {
        portalItem = candidate;
      }
    } catch {}
  }

  if (!portalItem) {
    const item = await findExactAdministrativePortalItem(spec);
    if (!item?.id) {
      throw new Error('The ArcGIS item "' + spec.itemTitle + '" is not accessible to this account.');
    }
    portalItem = new PortalItem({ id: item.id, portal });
    await portalItem.load();
  }

  if (!portalItem.url) {
    throw new Error('The ArcGIS item "' + spec.itemTitle + '" does not expose a service URL.');
  }

  const layerUrl = administrativeLayerUrl(portalItem.url, spec.layerId);
  const response = await esriRequest(layerUrl, {
    responseType: "json",
    authMode: "auto",
    query: { f: "json" }
  });
  const metadata = response?.data || {};
  if (metadata.error) throw new Error(metadata.error.message || "Administrative layer metadata request failed.");

  if (!/polygon/i.test(String(metadata.geometryType || ""))) {
    throw new Error('Expected polygon geometry for "' + spec.layerTitle + '".');
  }
  if (normalise(metadata.name) !== normalise(spec.layerTitle)) {
    throw new Error(
      'Administrative layer name changed: expected "' + spec.layerTitle +
      '" but ArcGIS reports "' + String(metadata.name || "") + '".'
    );
  }
  if (spec.nameField && normalise(metadata.displayField) !== normalise(spec.nameField)) {
    throw new Error(
      'Administrative display field changed: expected "' + spec.nameField +
      '" but ArcGIS reports "' + String(metadata.displayField || "") + '".'
    );
  }
  const capabilities = String(metadata.capabilities || "");
  if (capabilities && !/query/i.test(capabilities)) {
    throw new Error('Administrative layer "' + spec.layerTitle + '" is not queryable.');
  }

  return {
    key,
    sourceType: "authenticated",
    itemId: portalItem.id,
    itemTitle: portalItem.title || spec.itemTitle,
    itemType: portalItem.type || null,
    modified: portalItem.modified || null,
    layerId: Number(spec.layerId),
    layerTitle: String(metadata.name || spec.layerTitle),
    nameField: spec.nameField || metadata.displayField || null,
    path: [portalItem.title || spec.itemTitle, String(metadata.name || spec.layerTitle)],
    geometryType: String(metadata.geometryType || "esriGeometryPolygon"),
    queryUrl: layerUrl,
    score: 1000
  };
}

async function resolvePublicAdministrativeLayer(key, spec) {
  const response = await esriRequest(spec.publicUrl, {
    responseType: "json",
    authMode: "anonymous",
    query: { f: "json" }
  });
  const metadata = response?.data || {};
  if (metadata.error) throw new Error(metadata.error.message || "Public administrative layer metadata request failed.");

  if (!/polygon/i.test(String(metadata.geometryType || ""))) {
    throw new Error('Expected polygon geometry for public layer "' + spec.layerTitle + '".');
  }
  if (normalise(metadata.name) !== normalise(spec.layerTitle)) {
    throw new Error(
      'Public administrative layer name changed: expected "' + spec.layerTitle +
      '" but service reports "' + String(metadata.name || "") + '".'
    );
  }
  if (spec.nameField && normalise(metadata.displayField) !== normalise(spec.nameField)) {
    throw new Error(
      'Public administrative display field changed: expected "' + spec.nameField +
      '" but service reports "' + String(metadata.displayField || "") + '".'
    );
  }

  return {
    key,
    sourceType: "public",
    itemId: null,
    itemTitle: "Queensland Government Administrative Boundaries",
    itemType: "Map Service",
    modified: null,
    layerId: Number(spec.layerId),
    layerTitle: String(metadata.name || spec.layerTitle),
    nameField: spec.nameField || metadata.displayField || null,
    path: ["Boundaries", "AdministrativeBoundaries", String(metadata.name || spec.layerTitle)],
    geometryType: String(metadata.geometryType || "esriGeometryPolygon"),
    queryUrl: spec.publicUrl,
    score: 1000
  };
}

async function resolveAdministrativeLayer(key, clearCached=false) {
  const spec = cfg.administrativeLayers?.[key];
  if (!spec) throw new Error("No administrative layer is configured for " + key + ".");

  if (clearCached) {
    removeLocal(adminStorageKey(key));
    runtimeAdminLayers.delete(key);
  }

  if (runtimeAdminLayers.has(key)) return runtimeAdminLayers.get(key);

  let resolved;
  if (spec.sourceType === "public") {
    resolved = await resolvePublicAdministrativeLayer(key, spec);
  } else if (spec.sourceType === "portal-item") {
    const saved = loadSavedAdminLayer(key);
    resolved = await resolveExactPortalAdministrativeLayer(key, spec, saved);
    saveAdminLayer(key, resolved);
  } else {
    throw new Error("Unsupported administrative source type for " + key + ".");
  }

  runtimeAdminLayers.set(key, resolved);
  return resolved;
}

async function resolveAllAdministrativeLayers(clearCached=false) {
  const keys = Object.keys(cfg.administrativeLayers || {});
  const settled = await Promise.allSettled(
    keys.map((key) => resolveAdministrativeLayer(key, clearCached))
  );

  const results = {};
  settled.forEach((entry, index) => {
    const key = keys[index];
    if (entry.status === "fulfilled") {
      results[key] = { ok: true, layer: publicAdministrativeLayer(entry.value) };
    } else {
      results[key] = {
        ok: false,
        error: safeMessage(entry.reason, "Administrative boundary layer could not be resolved.")
      };
    }
  });

  window.dispatchEvent(new CustomEvent("mapping:arcgis-admin-boundaries", {
    detail: results
  }));
  return results;
}


function cameraServiceMatches(url, serviceName) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const match = path.match(/\/([^/]+)\/FeatureServer(?:\/\d+)?$/i);
    return Boolean(match && normalise(match[1]) === normalise(serviceName));
  } catch {
    return false;
  }
}

async function findCameraPortalCandidates(spec) {
  const aliases = spec.itemTitles || [];
  const allowed = new Set(aliases.map(normalise));
  const candidates = new Map();
  const query = aliases.map((title) =>
    'title:"' + title.replaceAll('"', '\\"') + '"'
  ).join(" OR ");

  function include(items) {
    (items || []).forEach((item) => {
      if (item?.id && (allowed.has(normalise(item.title)) ||
          cameraServiceMatches(item.url, spec.serviceName))) {
        candidates.set(item.id, item);
      }
    });
  }

  try {
    const found = await portal.queryItems({
      query, num: 100, sortField: "modified", sortOrder: "desc"
    });
    include(found.results);
  } catch {}

  if (!candidates.size) {
    try {
      const groups = await portal.user?.fetchGroups();
      const settled = await Promise.allSettled((groups || []).map(async (group) => {
        const found = await group.queryItems({ query, num: 100 });
        return found.results || [];
      }));
      settled.forEach((entry) => {
        if (entry.status === "fulfilled") include(entry.value);
      });
    } catch {}
  }

  return [...candidates.values()].sort((a,b) =>
    Number(b.modified || 0) - Number(a.modified || 0)
  );
}

async function resolveCameraLayer(key) {
  if (runtimeCameraLayers.has(key)) return runtimeCameraLayers.get(key);
  if (cameraLayerPromises.has(key)) return cameraLayerPromises.get(key);
  const spec = cfg.cameraLayers?.[key];
  if (!spec) throw new Error("Unknown camera source: " + key + ".");

  const promise = (async () => {
    const candidates = await findCameraPortalCandidates(spec);
    if (!candidates.length) {
      throw new Error(spec.layerTitle + " is not discoverable in this ArcGIS account.");
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        const item = new PortalItem({ id: candidate.id, portal });
        await item.load();
        if (!cameraServiceMatches(item.url, spec.serviceName)) continue;

        const url = administrativeLayerUrl(item.url, spec.layerId);
        const response = await esriRequest(url, {
          responseType: "json", authMode: "auto", query: { f: "json" }
        });
        const metadata = response?.data || {};
        if (metadata.error) throw new Error(metadata.error.message || "Layer metadata request failed.");

        const fields = new Set((metadata.fields || []).map((field) => normalise(field.name)));
        if (normalise(metadata.name) !== normalise(spec.layerTitle) ||
            !/point/i.test(String(metadata.geometryType || "")) ||
            !fields.has(normalise(spec.nameField))) {
          throw new Error(spec.layerTitle + " did not match the expected point-layer schema.");
        }
        if (metadata.capabilities && !/query/i.test(String(metadata.capabilities))) {
          throw new Error(spec.layerTitle + " does not support feature queries.");
        }

        const resolved = {
          key,
          queryUrl: url,
          itemId: item.id,
          title: spec.layerTitle,
          hasAttachments: Boolean(metadata.hasAttachments),
          objectIdField: metadata.objectIdField || "OBJECTID"
        };
        runtimeCameraLayers.set(key, resolved);
        return resolved;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(lastError?.message ||
      spec.layerTitle + " service was not found among accessible ArcGIS items.");
  })();

  cameraLayerPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    if (cameraLayerPromises.get(key) === promise) cameraLayerPromises.delete(key);
  }
}

async function queryPublicTrafficCameraLayer(extent) {
  const endpoint = window.MAPPING_CONFIG?.publicSources?.trafficCameraFallback;
  if (!endpoint) throw new Error("Public TMR camera fallback is not configured.");
  const bounds = Array.isArray(extent)
    ? extent
    : [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
  if (bounds.length !== 4 || !bounds.every(Number.isFinite)) {
    throw new Error("Invalid traffic-camera query extent.");
  }
  // Explicit anonymous mode: never send the private organisation OAuth
  // credentials to Queensland Government's public spatial service.
  const response = await esriRequest(endpoint.replace(/\/$/, "") + "/query", {
    responseType: "json",
    authMode: "anonymous",
    query: {
      where: "1=1",
      outFields: "objectid,camera_id,description,direction,district,locality,postcode,image_url",
      returnGeometry: true,
      f: "geojson",
      outSR: 4326,
      geometry: bounds.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: 2000
    }
  });
  const result = response?.data || {};
  if (result.error) throw new Error(result.error.message || "TMR fallback query failed.");
  if (result.type !== "FeatureCollection" || !Array.isArray(result.features)) {
    throw new Error("TMR fallback did not return GeoJSON.");
  }
  if (result.exceededTransferLimit) {
    throw new Error("TMR fallback camera results were truncated.");
  }
  return result;
}

async function queryCameraLayer(key, extent) {
  const layer = await resolveCameraLayer(key);
  const bounds = Array.isArray(extent)
    ? extent : [extent.xmin,extent.ymin,extent.xmax,extent.ymax];
  const response = await esriRequest(layer.queryUrl.replace(/\/$/, "") + "/query", {
    responseType: "json",
    authMode: "auto",
    query: {
      where: "1=1",
      outFields: "*",
      returnGeometry: true,
      f: "geojson",
      outSR: 4326,
      geometry: bounds.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: 2000
    }
  });
  const payload = response?.data || {};
  if (payload.error) throw new Error(payload.error.message || "Camera layer request failed.");
  if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error(layer.title + " did not return GeoJSON point features.");
  }
  if (payload.exceededTransferLimit) {
    throw new Error(layer.title + " returned a truncated camera list.");
  }
  return {
    ...payload,
    source: {
      key: layer.key,
      itemId: layer.itemId,
      title: layer.title,
      hasAttachments: layer.hasAttachments,
      objectIdField: layer.objectIdField
    }
  };
}

async function fetchCameraAttachment(key, objectId) {
  const layer = await resolveCameraLayer(key);
  if (!layer.hasAttachments) throw new Error("This camera layer has no attachments.");
  if (!Number.isSafeInteger(Number(objectId))) throw new Error("Invalid camera object ID.");
  const response = await esriRequest(layer.queryUrl.replace(/\/$/, "") + "/queryAttachments", {
    responseType: "json", authMode: "auto",
    query: { objectIds: String(objectId), returnUrl: true, f: "json" }
  });
  const payload = response?.data || {};
  if (payload.error) throw new Error(payload.error.message || "Camera attachment query failed.");
  const images = (payload.attachmentGroups || [])
    .filter((entry) => String(entry.parentObjectId) === String(objectId))
    .flatMap((entry) => entry.attachmentInfos || [])
    .filter((entry) => String(entry.contentType || "").toLowerCase().startsWith("image/"))
    .sort((a,b) => Number(b.lastEditDate || 0)-Number(a.lastEditDate || 0));
  if (!images.length) throw new Error("This camera currently has no image attachment.");

  // Images are fetched on user clicks only. SDK-managed OAuth tokens
  // are not embedded in links, stored or committed.
  const attachmentUrl = layer.queryUrl.replace(/\/$/, "") +
    "/" + Number(objectId) + "/attachments/" + Number(images[0].id);
  const image = await esriRequest(attachmentUrl, {
    responseType: "blob", authMode: "auto"
  });
  if (!image?.data?.size) throw new Error("The camera image attachment was empty.");
  return image.data;
}

async function queryAdministrativeLayerFromResolved(key, extent, outFields="*") {
  const resolved = runtimeAdminLayers.get(key);
  if (!resolved) {
    throw new Error("Administrative boundary layer has not finished resolving for this session.");
  }
  const bounds = Array.isArray(extent)
    ? extent
    : [extent.xmin, extent.ymin, extent.xmax, extent.ymax];

  const response = await esriRequest(String(resolved.queryUrl).replace(/\/$/, "") + "/query", {
    responseType: "json",
    authMode: "auto",
    query: {
      where: "1=1",
      outFields,
      returnGeometry: true,
      outSR: 4326,
      f: "geojson",
      geometry: bounds.join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      resultRecordCount: 2000
    }
  });

  const payload = response?.data || {};
  if (payload.error) throw new Error(payload.error.message || "Administrative boundary query failed.");
  if (payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new Error("Administrative boundary query did not return GeoJSON polygons.");
  }

  return {
    ...payload,
    source: publicAdministrativeLayer(resolved)
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

function safeParameterObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry == null) continue;
    if (["string", "number", "boolean"].includes(typeof entry)) {
      output[String(key)] = String(entry);
    }
  }
  return output;
}

function findWmsItemConfig(value, seen=new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (!Array.isArray(value)) {
    const layerType = normalise(value.layerType || value.type);
    const looksLikeWms = layerType === "wms" || Boolean(
      value.mapUrl || value.customParameters || value.customLayerParameters
    );

    if (looksLikeWms) {
      return {
        url: typeof value.url === "string" ? value.url : null,
        mapUrl: typeof value.mapUrl === "string" ? value.mapUrl : null,
        version: typeof value.version === "string" ? value.version : null,
        customParameters: safeParameterObject(value.customParameters),
        customLayerParameters: safeParameterObject(value.customLayerParameters)
      };
    }
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findWmsItemConfig(child, seen);
    if (found) return found;
  }
  return null;
}

function buildWmsRequestConfig(serviceUrl, data) {
  const itemConfig = findWmsItemConfig(data) || {};
  const mapUrl = itemConfig.mapUrl || itemConfig.url || serviceUrl;
  if (!mapUrl) return null;

  let url;
  try {
    url = new URL(mapUrl, portalUrl || window.location.href);
  } catch {
    return {
      url: serviceUrl,
      mapUrl: serviceUrl,
      version: itemConfig.version || "1.3.0",
      customParameters: itemConfig.customParameters || {},
      customLayerParameters: itemConfig.customLayerParameters || {}
    };
  }

  // Keep query parameters already registered on the ArcGIS item URL. These may
  // include credentials required by the upstream WMS gateway. Values remain in
  // memory only and are never written to localStorage or displayed in the UI.
  try {
    const registered = new URL(serviceUrl, portalUrl || window.location.href);
    registered.searchParams.forEach((value, key) => {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    });
  } catch {}

  const mergedParameters = {
    ...(itemConfig.customParameters || {}),
    ...(itemConfig.customLayerParameters || {})
  };
  Object.entries(mergedParameters).forEach(([key, value]) => {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  });

  return {
    url: url.toString(),
    mapUrl: url.toString(),
    version: itemConfig.version || "1.3.0",
    customParameters: itemConfig.customParameters || {},
    customLayerParameters: itemConfig.customLayerParameters || {}
  };
}

async function renderWmsPrintImage(role, extent, width, height, sourceOverride=null, metadataOverride=null, options={}) {
  const spec = cfg.standardSources?.[role];
  const source = sourceOverride || runtimeSources.get(role)?.source || loadSavedSource(role);
  if (!spec || !source?.itemId) throw new Error("The standard " + role + " WMS has not been resolved.");

  const printTask = portal.helperServices?.printTask?.url;
  if (!printTask) throw new Error("This ArcGIS organisation does not advertise a print service.");

  const { data, serviceUrl } = await getPortalItemAndData(source);
  if (!serviceUrl) throw new Error("The authenticated WMS item does not expose a service URL.");

  const requestConfig = buildWmsRequestConfig(serviceUrl, data);
  if (!requestConfig?.url) throw new Error("The authenticated WMS item does not expose a usable GetMap URL.");

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
  const spatialReference = Number(options?.spatialReference || 4326);

  const webMap = {
    mapOptions: {
      extent: {
        xmin: bounds[0],
        ymin: bounds[1],
        xmax: bounds[2],
        ymax: bounds[3],
        spatialReference: { wkid: spatialReference }
      },
      spatialReference: { wkid: spatialReference },
      background: {
        color: [255, 255, 255, 0]
      }
    },
    operationalLayers: [{
      id: role + "-wms",
      url: requestConfig.url,
      mapUrl: requestConfig.mapUrl,
      itemId: source.itemId,
      title: spec.itemTitle,
      type: "wms",
      layerType: "WMS",
      opacity: 1,
      visibility: true,
      version: requestConfig.version,
      format: "png32",
      transparentBackground: true,
      customParameters: requestConfig.customParameters,
      customLayerParameters: requestConfig.customLayerParameters,
      layers: sublayerNames.map((name) => ({ name })),
      visibleLayers: sublayerNames,
      styles: sublayerNames.map(() => "")
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
    sublayerTitles: resolvedSublayers.map((entry) => entry.title),
    diagnostics: {
      usesRegisteredMapUrl: Boolean(requestConfig.mapUrl),
      customParameterCount: Object.keys(requestConfig.customParameters || {}).length,
      customLayerParameterCount: Object.keys(requestConfig.customLayerParameters || {}).length
    }
  };
}

function parseFeatureInfoText(value) {
  const text = String(value || "");
  const properties = {};

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^getfeatureinfo/i.test(trimmed) || /^layer\b/i.test(trimmed) || /^feature\b/i.test(trimmed)) return;

    const equals = trimmed.indexOf("=");
    const colon = trimmed.indexOf(":");
    let splitAt = equals > 0 ? equals : colon;
    if (splitAt <= 0) return;

    const key = trimmed.slice(0, splitAt).trim().replace(/^["']|["']$/g, "");
    let entry = trimmed.slice(splitAt + 1).trim();
    entry = entry.replace(/^["']|["']$/g, "");
    if (!key || !entry) return;
    properties[key] = entry;
  });

  return properties;
}

async function getWmsFeatureInfo(role, extent, width, height, pixelX, pixelY, options={}) {
  const spec = cfg.standardSources?.[role];
  const source = runtimeSources.get(role)?.source || loadSavedSource(role);
  if (!spec || !source?.itemId) throw new Error("The standard " + role + " WMS has not been resolved.");

  const { data, serviceUrl } = await getPortalItemAndData(source);
  if (!serviceUrl) throw new Error("The authenticated WMS item does not expose a service URL.");

  const requestConfig = buildWmsRequestConfig(serviceUrl, data);
  if (!requestConfig?.url) throw new Error("The authenticated WMS item does not expose a usable GetFeatureInfo URL.");

  const title = String(options.sublayerTitle || spec.sublayerTitle || "").trim();
  const configuredName = String(spec.wmsLayerNames?.[title] || (
    normalise(title) === normalise(spec.sublayerTitle) ? spec.wmsLayerName : ""
  ) || "").trim();
  const metadata = findSublayerMetadata(data, title);
  const name = configuredName || metadata?.name;
  if (!name) throw new Error('Required WMS sublayer is not available: "' + title + '".');

  const bounds = Array.isArray(extent)
    ? extent
    : [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
  const spatialReference = Number(options.spatialReference || 4326);
  const version = String(requestConfig.version || "1.3.0");
  const is130 = version.startsWith("1.3");
  const crs = "EPSG:" + spatialReference;
  const requestBounds = is130 && spatialReference === 4326
    ? [bounds[1], bounds[0], bounds[3], bounds[2]]
    : bounds;

  const target = new URL(requestConfig.url, portalUrl || window.location.href);
  const params = {
    SERVICE: "WMS",
    VERSION: version,
    REQUEST: "GetFeatureInfo",
    LAYERS: name,
    QUERY_LAYERS: name,
    STYLES: "",
    FORMAT: "image/png",
    INFO_FORMAT: "text/plain",
    WIDTH: Math.max(1, Math.round(width)),
    HEIGHT: Math.max(1, Math.round(height)),
    BBOX: requestBounds.join(",")
  };

  if (is130) {
    params.CRS = crs;
    params.I = Math.max(0, Math.min(params.WIDTH - 1, Math.round(pixelX)));
    params.J = Math.max(0, Math.min(params.HEIGHT - 1, Math.round(pixelY)));
  } else {
    params.SRS = crs;
    params.X = Math.max(0, Math.min(params.WIDTH - 1, Math.round(pixelX)));
    params.Y = Math.max(0, Math.min(params.HEIGHT - 1, Math.round(pixelY)));
  }

  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, String(value)));

  const response = await esriRequest(target.toString(), {
    responseType: "text",
    authMode: "auto"
  });

  const text = typeof response?.data === "string"
    ? response.data
    : String(response?.data || "");

  return {
    sublayerTitle: title,
    sublayerName: name,
    properties: parseFeatureInfoText(text)
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

  const { portalItem, data, serviceUrl } = await getPortalItemAndData(source);
  const metadata = findSublayerMetadata(data, spec.sublayerTitle);
  const requestConfig = buildWmsRequestConfig(serviceUrl, data);
  const configuredPrimaryName = String(
    spec.wmsLayerName ||
    spec.wmsLayerNames?.[spec.sublayerTitle] ||
    metadata?.name ||
    spec.sublayerTitle
  ).trim();

  // Prefer normal browser WMS loading when the upstream service supports CORS.
  // Use the same registered GetMap URL and custom parameters as the print path
  // so verification and operational rendering cannot diverge.
  try {
    const layer = new WMSLayer({
      portalItem,
      url: requestConfig?.url || serviceUrl,
      title: spec.itemTitle,
      customParameters: requestConfig?.customParameters || {},
      customLayerParameters: requestConfig?.customLayerParameters || {},
      sublayers: [{ name: configuredPrimaryName }]
    });
    await layer.load();

    const sublayer =
      findTargetSublayer(layer, spec.sublayerTitle) ||
      layer.findSublayerByName?.(configuredPrimaryName) ||
      layer.sublayers?.at?.(0);
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

async function renderTopographicBasemap(extent, width, height, options={}) {
  if (!ArcGISMap || !MapView || !reactiveUtils) {
    throw new Error("ArcGIS basemap rendering is not ready.");
  }

  const bounds = Array.isArray(extent)
    ? extent
    : [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
  const outputWidth = Math.max(64, Math.round(width));
  const outputHeight = Math.max(64, Math.round(height));
  const spatialReference = Number(options?.spatialReference || 4326);
  const styleId = String(window.MAPPING_CONFIG?.rendering?.basemapStyle || "arcgis/topographic");

  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: outputWidth + "px",
    height: outputHeight + "px",
    pointerEvents: "none",
    overflow: "hidden"
  });
  container.setAttribute("aria-hidden", "true");
  document.body.appendChild(container);

  const map = new ArcGISMap({ basemap: styleId });
  const view = new MapView({
    container,
    map,
    extent: {
      xmin: bounds[0],
      ymin: bounds[1],
      xmax: bounds[2],
      ymax: bounds[3],
      spatialReference: { wkid: spatialReference }
    },
    constraints: {
      snapToZoom: false,
      rotationEnabled: false
    },
    ui: { components: [] }
  });

  try {
    await view.when();
    await map.basemap?.loadAll?.();
    await reactiveUtils.whenOnce(() => !view.updating);

    // Give the browser two paint frames after the final tile update so the
    // screenshot captures the completed vector basemap.
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const screenshot = await view.takeScreenshot({
      width: outputWidth,
      height: outputHeight,
      format: "png"
    });

    const attribution = [...new Set(
      (view.attributionItems || [])
        .map((item) => String(item?.text || "").trim())
        .filter(Boolean)
    )].join(" | ");

    const response = await fetch(screenshot.dataUrl);
    const blob = await response.blob();
    if (!blob?.size) throw new Error("ArcGIS Topographic returned an empty screenshot.");

    const actualExtent = view.extent;
    return {
      blob,
      style: styleId,
      attribution,
      spatialReference: Number(view.spatialReference?.wkid || spatialReference),
      extent: actualExtent
        ? [actualExtent.xmin, actualExtent.ymin, actualExtent.xmax, actualExtent.ymax]
        : bounds
    };
  } finally {
    view.destroy();
    container.remove();
  }
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
    },
    getWmsFeatureInfo(role, extent, width, height, pixelX, pixelY, options={}) {
      return getWmsFeatureInfo(role, extent, width, height, pixelX, pixelY, options);
    },
    renderBasemapImage(extent, width, height, options={}) {
      return renderTopographicBasemap(extent, width, height, options);
    },
    resolveAdministrativeLayers: resolveAllAdministrativeLayers,
    queryCameraLayer(key, extent) {
      return queryCameraLayer(key, extent);
    },
    queryPublicTrafficCameraLayer(extent) {
      return queryPublicTrafficCameraLayer(extent);
    },
    fetchCameraAttachment(key, objectId) {
      return fetchCameraAttachment(key, objectId);
    },
    getAdministrativeLayer(key) {
      return publicAdministrativeLayer(runtimeAdminLayers.get(key));
    },
    queryAdministrativeLayer(key, extent, outFields="*") {
      return resolveAdministrativeLayer(key, false)
        .then(() => queryAdministrativeLayerFromResolved(key, extent, outFields));
    },
    queryResolvedAdministrativeLayer(key, extent, outFields="*") {
      return queryAdministrativeLayerFromResolved(key, extent, outFields);
    }
  };

  window.dispatchEvent(new CustomEvent("mapping:arcgis-ready", {
    detail: { portal, portalUrl }
  }));

  // Administrative layers are optional context. Resolve them after the core
  // WMS workflow is ready; individual queries also resolve lazily if needed.
  void resolveAllAdministrativeLayers(false);
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
  [OAuthInfo, esriId, Portal, PortalItem, WMSLayer, ArcGISMap, MapView, reactiveUtils, esriRequest] = await $arcgis.import([
    "@arcgis/core/identity/OAuthInfo.js",
    "@arcgis/core/identity/IdentityManager.js",
    "@arcgis/core/portal/Portal.js",
    "@arcgis/core/portal/PortalItem.js",
    "@arcgis/core/layers/WMSLayer.js",
    "@arcgis/core/Map.js",
    "@arcgis/core/views/MapView.js",
    "@arcgis/core/core/reactiveUtils.js",
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
    runtimeAdminLayers.clear();
    runtimeCameraLayers.clear();
    cameraLayerPromises.clear();
    window.MAPPING_ARCGIS = null;
    showLogin("Signed out of this application. Your organisation SSO session may remain active in the browser.");
  });

  ui.reconnect?.addEventListener("click", () => {
    void resolveAllStandardSources(true);
    void resolveAllAdministrativeLayers(true);
    runtimeCameraLayers.clear();
    cameraLayerPromises.clear();
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
