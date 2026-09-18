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
let esriConfig;
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
    serviceUrl: item.url || null,
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

async function createConfiguredWmsLayer(role, sourceOverride = null) {
  const spec = cfg.standardSources?.[role];
  const source = sourceOverride || runtimeSources.get(role)?.source || loadSavedSource(role);

  if (!spec || !source?.itemId) {
    throw new Error("The standard " + role + " WMS has not been resolved.");
  }

  const portalItem = new PortalItem({
    id: source.itemId,
    portal
  });

  // Load the private portal item first through the authenticated ArcGIS session.
  // WMS capabilities/image requests may then fall back through the organisation's
  // own sharing proxy when the upstream WMS does not permit github.io via CORS.
  await portalItem.load();

  const layer = new WMSLayer({
    portalItem,
    title: spec.itemTitle
  });

  await layer.load();

  const sublayer = findTargetSublayer(layer, spec.sublayerTitle);
  if (!sublayer) {
    const available = (layer.allSublayers || [])
      .map((entry) => entry.title || entry.name)
      .filter(Boolean)
      .slice(0, 12)
      .join(", ");

    throw new Error(
      'Required sublayer "' + spec.sublayerTitle + '" was not found in "' + spec.itemTitle + '".'
      + (available ? " Available examples: " + available : "")
    );
  }

  // Restrict the WMS to only the operational sublayer required by this app.
  layer.sublayers = [sublayer];

  return {
    layer,
    sublayerName: sublayer.name,
    sublayerTitle: sublayer.title || spec.sublayerTitle
  };
}

async function resolveStandardSource(role) {
  const spec = cfg.standardSources?.[role];
  renderSourceState(role, "connecting", "Locating shared WMS and verifying the required sublayer…");

  const source = await locateStandardItem(role);
  const verified = await createConfiguredWmsLayer(role, source);

  const saved = {
    ...source,
    itemTitle: spec.itemTitle,
    sublayerTitle: spec.sublayerTitle,
    sublayerName: verified.sublayerName,
    verifiedAt: new Date().toISOString()
  };

  saveSource(role, saved);
  runtimeSources.set(role, { source: saved, verified });

  renderSourceState(
    role,
    "connected",
    "Sublayer: " + spec.sublayerTitle
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
      renderSourceState(role, "error", String(error?.message || error));
      results[role] = { ok: false, error: String(error?.message || error) };
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

  // Esri requires a proxy when a cross-domain WMS server does not provide CORS.
  // Use the signed-in organisation's own sharing proxy; no private WMS request
  // is sent through GitHub, Cloudflare, or another application-controlled server.
  if (esriConfig?.request) {
    esriConfig.request.proxyUrl = portalUrl + "/sharing/proxy";
    esriConfig.request.timeout = 90000;
  }

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
  [OAuthInfo, esriId, Portal, PortalItem, WMSLayer, esriConfig] = await $arcgis.import([
    "@arcgis/core/identity/OAuthInfo.js",
    "@arcgis/core/identity/IdentityManager.js",
    "@arcgis/core/portal/Portal.js",
    "@arcgis/core/portal/PortalItem.js",
    "@arcgis/core/layers/WMSLayer.js",
    "@arcgis/core/config.js"
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
