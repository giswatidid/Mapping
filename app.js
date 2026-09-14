const els = {
  generate: document.querySelector("#generateButton"),
  refresh: document.querySelector("#refreshButton"),
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

let currentManifest = null;

function humanStatus(status) {
  const map = {
    ok: ["Current maps available", "ok"],
    partial: ["Maps generated with a source warning", "warning"],
    no_active_warnings: ["No active severe thunderstorm warnings", "ok"],
    source_unconfigured: ["Warning source not configured", "warning"],
    source_error: ["Warning source failed", "error"],
    generation_error: ["Map generation failed", "error"],
    starting: ["Generation starting", "warning"]
  };
  return map[status] || [status || "Unknown", "warning"];
}

function sourceSeverity(source) {
  if (!source) return "warning";
  const status = String(source.status || "").toLowerCase();
  if (status === "ok" || status === "no_active_warnings") return "ok";
  if (status === "error" || status === "source_error") return "error";
  return "warning";
}

function sourceLabel(source) {
  if (!source) return "Not checked";
  const status = String(source.status || "unknown").replaceAll("_", " ");
  return status;
}

function sourceDetail(source) {
  if (!source) return "This source was not required for the current generation.";
  const parts = [];
  if (source.count !== null && source.count !== undefined) {
    parts.push(String(source.count) + " feature" + (source.count === 1 ? "" : "s"));
  }
  if (source.message) parts.push(source.message);
  if (!parts.length && source.timestamp) parts.push("Checked " + source.timestamp);
  return parts.join(" · ") || "Source checked.";
}

function formatGeneratedAt(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date) + " AEST";
}

function makeMapCard(map, manifest) {
  const card = document.createElement("article");
  card.className = "map-card";

  const cacheKey = encodeURIComponent(manifest.generated_at || Date.now());
  const url = "generated/" + map.filename + "?v=" + cacheKey;

  const imageLink = document.createElement("a");
  imageLink.href = url;
  imageLink.target = "_blank";
  imageLink.rel = "noopener";

  const img = document.createElement("img");
  img.src = url;
  img.alt = map.title || map.filename;
  imageLink.appendChild(img);

  const info = document.createElement("div");
  info.className = "map-info";

  const text = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = map.title || map.filename;
  const meta = document.createElement("p");
  meta.textContent = (map.kind || "map") + " · " + (map.scope || "");
  text.appendChild(heading);
  text.appendChild(meta);

  const download = document.createElement("a");
  download.className = "download";
  download.href = url;
  download.download = "";
  download.textContent = "Download PNG";

  info.appendChild(text);
  info.appendChild(download);
  card.appendChild(imageLink);
  card.appendChild(info);
  return card;
}

function render(manifest) {
  currentManifest = manifest;

  const result = humanStatus(manifest.status);
  const severity = result[1];

  els.badge.textContent = String(manifest.status || "unknown").replaceAll("_", " ");
  els.badge.className = "scope-badge " + severity;
  els.statusCard.className = "scope-banner " + severity;
  els.title.textContent = result[0];

  const errors = manifest.errors || [];
  if (manifest.status === "source_unconfigured") {
    els.message.textContent = "The warning source is not configured.";
  } else if (manifest.status === "no_active_warnings") {
    els.message.textContent = "The official warning feed was checked successfully and there are no current Queensland severe thunderstorm warnings.";
  } else if (errors.length) {
    els.message.textContent = errors.join(" · ");
  } else {
    els.message.textContent = "Latest published generation loaded.";
  }

  els.generatedAt.textContent = formatGeneratedAt(manifest.generated_at);
  els.warningCount.textContent = String((manifest.warnings || []).length);
  els.mode.textContent = manifest.mode || "—";

  els.maps.innerHTML = "";
  const maps = manifest.maps || [];
  els.empty.hidden = maps.length > 0;
  if (!maps.length) {
    els.empty.textContent = manifest.status === "no_active_warnings"
      ? "No maps are required because there are no active warnings."
      : "No generated maps are currently available.";
  }

  maps.forEach(function(map) {
    els.maps.appendChild(makeMapCard(map, manifest));
  });

  els.sources.innerHTML = "";
  Object.entries(manifest.sources || {}).forEach(function(entry) {
    const name = entry[0];
    const source = entry[1];
    const severityClass = sourceSeverity(source);

    const item = document.createElement("div");
    item.className = "source-item " + severityClass;

    const head = document.createElement("div");
    head.className = "source-head";

    const strong = document.createElement("strong");
    strong.textContent = name;

    const status = document.createElement("span");
    status.className = "source-status " + severityClass;
    status.textContent = sourceLabel(source);

    const detail = document.createElement("span");
    detail.className = "source-detail";
    detail.textContent = sourceDetail(source);

    head.appendChild(strong);
    head.appendChild(status);
    item.appendChild(head);
    item.appendChild(detail);
    els.sources.appendChild(item);
  });
}

async function loadManifest() {
  els.refresh.disabled = true;
  els.refresh.textContent = "Refreshing…";

  try {
    const response = await fetch("generated/manifest.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Manifest request returned HTTP " + response.status);
    render(await response.json());
  } catch (error) {
    els.badge.textContent = "unavailable";
    els.badge.className = "scope-badge error";
    els.statusCard.className = "scope-banner error";
    els.title.textContent = "No generation manifest available";
    els.message.textContent = String(error);
    els.maps.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "The generation workflow has not published a manifest yet.";
  } finally {
    els.refresh.disabled = false;
    els.refresh.textContent = "Refresh latest";
  }
}

async function generateMaps() {
  const dispatchUrl = (window.MAPPING_CONFIG && window.MAPPING_CONFIG.dispatchUrl) || "";
  if (!dispatchUrl) return;

  const previousGeneratedAt = currentManifest && currentManifest.generated_at;
  els.generate.disabled = true;
  els.generate.textContent = "Generating…";

  try {
    const response = await fetch(dispatchUrl, { method: "POST" });
    if (!response.ok) throw new Error("Generation request returned HTTP " + response.status);

    const started = Date.now();
    while (Date.now() - started < 180000) {
      await new Promise(function(resolve) { setTimeout(resolve, 5000); });
      const check = await fetch("generated/manifest.json?t=" + Date.now(), { cache: "no-store" });
      if (!check.ok) continue;
      const manifest = await check.json();
      if (manifest.generated_at && manifest.generated_at !== previousGeneratedAt) {
        render(manifest);
        return;
      }
    }
    throw new Error("Generation was requested, but a new published manifest was not detected.");
  } catch (error) {
    els.badge.textContent = "request failed";
    els.badge.className = "scope-badge error";
    els.statusCard.className = "scope-banner error";
    els.title.textContent = "Generation request failed";
    els.message.textContent = String(error);
  } finally {
    els.generate.disabled = false;
    els.generate.textContent = "Generate maps";
  }
}

function setTheme(mode) {
  const night = mode === "night";
  document.body.classList.toggle("night-mode", night);
  els.theme.classList.toggle("active", night);
  els.theme.setAttribute("aria-pressed", String(night));
  els.theme.textContent = night ? "Light mode" : "Night mode";

  try {
    localStorage.setItem("mappingTheme", night ? "night" : "light");
  } catch (_) {}
}

function initialiseTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem("mappingTheme");
  } catch (_) {}

  if (stored === "night" || stored === "light") {
    setTheme(stored);
    return;
  }

  setTheme("light");
}

function initialiseGenerateButton() {
  const dispatchUrl = (window.MAPPING_CONFIG && window.MAPPING_CONFIG.dispatchUrl) || "";
  if (dispatchUrl) return;

  els.generate.disabled = true;
  els.generate.title = "Manual generation will be enabled when the secure workflow trigger is connected.";
}

els.refresh.addEventListener("click", loadManifest);
els.generate.addEventListener("click", generateMaps);
els.theme.addEventListener("click", function() {
  setTheme(document.body.classList.contains("night-mode") ? "light" : "night");
});

initialiseTheme();
initialiseGenerateButton();
loadManifest();
