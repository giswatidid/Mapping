const els = {
  generate: document.querySelector("#generateButton"),
  theme: document.querySelector("#themeToggleBtn"),
  statusCard: document.querySelector("#statusCard"),
  badge: document.querySelector("#statusBadge"),
  title: document.querySelector("#statusTitle"),
  message: document.querySelector("#statusMessage"),
  generatedAt: document.querySelector("#generatedAt"),
  warningCount: document.querySelector("#warningCount"),
  mode: document.querySelector("#mode"),
  maps: document.querySelector("#maps"),
  empty: document.querySelector("#emptyState"),
  sources: document.querySelector("#sources")
};

const sourceState = {
  warning: { status: "checking", message: "Verifying authenticated standard WMS sublayer." },
  radar: { status: "checking", message: "Verifying authenticated standard WMS sublayer." },
  outages: { status: "configured", message: "Public current unplanned outage GeoJSON." },
  road_conditions: { status: "configured", message: "Public live QLD Traffic GeoJSON." }
};

function statusClass(status) {
  if (status === "ok" || status === "configured") return "ok";
  if (status === "error") return "error";
  return "warning";
}

function renderSources() {
  if (!els.sources) return;
  els.sources.innerHTML = "";

  const labels = {
    warning: "warning WMS",
    radar: "radar WMS",
    outages: "power outages",
    road_conditions: "road conditions"
  };

  Object.entries(sourceState).forEach(([key, source]) => {
    const severity = statusClass(source.status);
    const item = document.createElement("div");
    item.className = "source-item " + severity;

    const head = document.createElement("div");
    head.className = "source-head";

    const strong = document.createElement("strong");
    strong.textContent = labels[key] || key;

    const status = document.createElement("span");
    status.className = "source-status " + severity;
    status.textContent = source.status.replaceAll("_", " ");

    const detail = document.createElement("span");
    detail.className = "source-detail";
    detail.textContent = source.message;

    head.append(strong, status);
    item.append(head, detail);
    els.sources.appendChild(item);
  });
}

function setFeedStatus(detail) {
  const warningOk = Boolean(detail?.warning?.ok);
  const radarOk = Boolean(detail?.radar?.ok);

  sourceState.warning = warningOk
    ? { status: "ok", message: "Standard severe-thunderstorm warning WMS sublayer verified for this ArcGIS session." }
    : { status: "error", message: detail?.warning?.error || "Standard warning WMS could not be verified." };

  sourceState.radar = radarOk
    ? { status: "ok", message: "Standard Australian radar rain-rate WMS sublayer verified for this ArcGIS session." }
    : { status: "error", message: detail?.radar?.error || "Standard radar WMS could not be verified." };

  renderSources();

  if (warningOk && radarOk) {
    els.statusCard.className = "scope-banner ok";
    els.badge.className = "scope-badge ok";
    els.badge.textContent = "Feeds ready";
    els.title.textContent = "Standard authenticated feeds connected";
    els.message.textContent = "Both required Bureau WMS services and their exact operational sublayers were verified in this signed-in browser session.";
    els.empty.textContent = "Authenticated feeds are ready. Client-side rendering will create the two map products here without publishing private weather data to GitHub.";
  } else {
    els.statusCard.className = "scope-banner error";
    els.badge.className = "scope-badge error";
    els.badge.textContent = "Source error";
    els.title.textContent = "A standard authenticated feed could not be verified";
    els.message.textContent = "Use “Reconnect standard feeds” after checking that the two shared WMS items remain available to this ArcGIS account.";
    els.empty.textContent = "Map generation is unavailable until both authenticated WMS sources are verified.";
  }

  // The old GitHub/Worker generator has been removed. This will be enabled
  // only by the browser renderer once it is attached to the authenticated sources.
  els.generate.disabled = true;
  els.generate.title = warningOk && radarOk
    ? "Authenticated feeds are ready; the client-side renderer is the next component."
    : "Both authenticated WMS feeds must be available before rendering.";
}

function setTheme(mode) {
  const night = mode === "night";
  document.body.classList.toggle("night-mode", night);
  els.theme?.classList.toggle("active", night);
  els.theme?.setAttribute("aria-pressed", String(night));
  if (els.theme) els.theme.textContent = night ? "Light mode" : "Night mode";

  try {
    localStorage.setItem("mappingTheme", night ? "night" : "light");
  } catch {}
}

function initialiseTheme() {
  let stored = null;
  try { stored = localStorage.getItem("mappingTheme"); } catch {}
  setTheme(stored === "night" ? "night" : "light");
}

els.theme?.addEventListener("click", () => {
  setTheme(document.body.classList.contains("night-mode") ? "light" : "night");
});

window.addEventListener("mapping:arcgis-sources", (event) => {
  setFeedStatus(event.detail);
});

if (els.generatedAt) els.generatedAt.textContent = "—";
if (els.warningCount) els.warningCount.textContent = "—";
if (els.mode) els.mode.textContent = "Browser";
if (els.generate) {
  els.generate.disabled = true;
  els.generate.title = "Waiting for the authenticated browser renderer.";
}

initialiseTheme();
renderSources();
