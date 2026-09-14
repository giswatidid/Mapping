const els = {
  generate: document.querySelector("#generateButton"),
  refresh: document.querySelector("#refreshButton"),
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
    source_unconfigured: ["BOM warning source not configured", "warning"],
    source_error: ["BOM warning source failed", "error"],
    generation_error: ["Map generation failed", "error"],
    starting: ["Generation starting", "warning"]
  };
  return map[status] || [status || "Unknown", "warning"];
}

function sourceText(source) {
  if (!source) return "Not checked";
  const parts = [source.status || "unknown"];
  if (source.count !== null && source.count !== undefined) {
    parts.push(String(source.count) + " feature" + (source.count === 1 ? "" : "s"));
  }
  if (source.message) parts.push(source.message);
  return parts.join(" · ");
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
  els.badge.textContent = manifest.status || "unknown";
  els.badge.className = "badge " + result[1];
  els.title.textContent = result[0];

  const errors = manifest.errors || [];
  if (manifest.status === "source_unconfigured") {
    els.message.textContent = "The site is ready, but the exact BOM spatial warning feed still needs to be connected.";
  } else if (manifest.status === "no_active_warnings") {
    els.message.textContent = "The configured source returned no current Queensland severe thunderstorm warning polygons.";
  } else if (errors.length) {
    els.message.textContent = errors.join(" · ");
  } else {
    els.message.textContent = "Latest published generation loaded.";
  }

  els.generatedAt.textContent = manifest.generated_at || "—";
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
    const item = document.createElement("div");
    item.className = "source-item";
    const strong = document.createElement("strong");
    strong.textContent = entry[0];
    const span = document.createElement("span");
    span.textContent = sourceText(entry[1]);
    item.appendChild(strong);
    item.appendChild(span);
    els.sources.appendChild(item);
  });
}

async function loadManifest() {
  els.refresh.disabled = true;
  try {
    const response = await fetch("generated/manifest.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Manifest request returned HTTP " + response.status);
    render(await response.json());
  } catch (error) {
    els.badge.textContent = "unavailable";
    els.badge.className = "badge error";
    els.title.textContent = "No generation manifest available";
    els.message.textContent = String(error);
    els.maps.innerHTML = "";
    els.empty.hidden = false;
    els.empty.textContent = "Run the map-generation workflow to publish the first manifest.";
  } finally {
    els.refresh.disabled = false;
  }
}

async function generateMaps() {
  const dispatchUrl = (window.MAPPING_CONFIG && window.MAPPING_CONFIG.dispatchUrl) || "";
  if (!dispatchUrl) {
    els.badge.textContent = "setup required";
    els.badge.className = "badge warning";
    els.title.textContent = "One-click generation relay not connected yet";
    els.message.textContent = "The GitHub workflow is ready. The button will be enabled after a Cloudflare Worker dispatch endpoint is connected without exposing a GitHub token.";
    return;
  }

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
    els.badge.className = "badge error";
    els.message.textContent = String(error);
  } finally {
    els.generate.disabled = false;
    els.generate.textContent = "Generate Maps";
  }
}

els.refresh.addEventListener("click", loadManifest);
els.generate.addEventListener("click", generateMaps);
loadManifest();
