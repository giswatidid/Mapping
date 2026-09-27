/* Shared, browser-local camera PDF primitives.
 * Extracted from the proven camera PDF lab; also usable by the production report.
 * No network request occurs until an explicit user action calls these helpers.
 */
(function (root) {
  "use strict";
  const AEST = "Australia/Brisbane";
  const ONE_HOUR = 60 * 60 * 1000;
  const QLD = [137.7, -29.3, 154.2, -9.0];
  const sourceLabels = Object.freeze({
    tmr: "TMR traffic cameras",
    floodCameras: "TMR flood cameras",
    bccResilience: "BCC City Resilience cameras"
  });

  function aest(date = new Date()) {
    return new Date(date).toLocaleString("en-AU", {
      timeZone: AEST, day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false
    }) + " AEST";
  }

  // The field MUST describe photograph capture, not a layer edit, record
  // update, attachment lastEditDate or HTTP Last-Modified time. A date without
  // a timezone is ambiguous and must not be used to exclude a photograph.
  function parseVerifiedImageTimestamp(value) {
    if (value == null || value === "") return null;
    let ms;
    if (typeof value === "number" && Number.isFinite(value)) {
      ms = value < 1e11 ? value * 1000 : value;
    } else if (typeof value === "string") {
      const raw = value.trim();
      if (/^\d{10}$/.test(raw)) ms = Number(raw) * 1000;
      else if (/^\d{13}$/.test(raw)) ms = Number(raw);
      else if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:?\d\d)$/i.test(raw))
        ms = Date.parse(raw);
      else return null;
    } else return null;
    const date = new Date(ms);
    return Number.isFinite(ms) && date.getUTCFullYear() >= 2000 &&
      date.getUTCFullYear() <= 2100 ? date : null;
  }

  function explicitCaptureTimestamp(properties) {
    const allowed = new Set([
      "imagecapturedat", "imagecapturetime", "photocapturedat",
      "photocapturetime", "phototakenat", "imageexifdatetimeoriginal"
    ]);
    for (const [key, value] of Object.entries(properties || {})) {
      if (allowed.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
          value != null && String(value).trim()) return value;
    }
    return null;
  }

  function decideEligibility(camera, image, now = Date.now()) {
    if (!image || !image.pdfImage || typeof image.pdfImage.data !== "string" ||
        !image.pdfImage.data.startsWith("data:image/jpeg;base64,") ||
        !image.pdfImage.width || !image.pdfImage.height) {
      return { included: false, reason: "image_unavailable" };
    }
    const parsed = parseVerifiedImageTimestamp(camera?.verifiedImageTimestamp);
    // A capture date implausibly in the future is not a verified time.
    const captured = parsed && parsed.getTime() <= now + 5 * 60000 ? parsed : null;
    if (captured && captured.getTime() < now - ONE_HOUR) {
      return { included: false, reason: "stale" };
    }
    return {
      included: true,
      reason: captured ? "verified" : "unknown",
      imageCapturedAt: captured,
      retrievedAt: image.retrievedAt || new Date(now)
    };
  }

  const cameraNameTokens = (value) => new Set(String(value || "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter(token => token.length >= 3 && ![
      "camera", "traffic", "flood", "road", "street", "the",
      "and", "near", "view", "north", "south", "east", "west", "highway"
    ].includes(token)));

  function cameraDistanceMeters(a, b) {
    const rad = Math.PI / 180, lat1 = Number(a[1]) * rad, lat2 = Number(b[1]) * rad;
    const dLat = (Number(b[1]) - Number(a[1])) * rad;
    const dLon = (Number(b[0]) - Number(a[0])) * rad;
    const v = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
  }

  function safeImageUrl(input) {
    try {
      const url = new URL(String(input || ""));
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }
  function hostedImageUrls(properties) {
    return Object.entries(properties || {})
      .filter(([field]) => /^image_?url[0-9]*$/i.test(field))
      .sort(([a], [b]) => Number(a.match(/[0-9]+$/)?.[0] || 0) -
        Number(b.match(/[0-9]+$/)?.[0] || 0))
      .map(([, value]) => safeImageUrl(value))
      .filter((url, index, all) => url && all.indexOf(url) === index);
  }

  // Original PDF lab's strict geospatial + meaningful-name correlation.
  // Rejects close-but-unrelated and ambiguous pairings. Never invents URLs.
  function matchLiveTrafficCameras(publicCameras, liveFeatures) {
    const live = (liveFeatures || []).map(feature => {
      if (feature?.geometry?.type === "Point") {
        return {
          coord: feature.geometry.coordinates,
          name: String(feature.properties?.Location_Name ||
            feature.properties?.location_name || ""),
          urls: hostedImageUrls(feature.properties),
          objectId: feature.properties?.OBJECTID ?? feature.properties?.objectid,
          verifiedImageTimestamp: explicitCaptureTimestamp(feature.properties)
        };
      }
      return feature;
    }).filter(feature => Array.isArray(feature?.coord) &&
      feature.coord.length >= 2 && feature.urls?.length);
    const used = new Set(), result = [];
    for (const camera of publicCameras) {
      const words = cameraNameTokens(camera.name);
      const matches = live.map((feature, index) => {
        if (used.has(index)) return null;
        const metres = cameraDistanceMeters(camera.coord, feature.coord);
        if (!Number.isFinite(metres) || metres > 500) return null;
        const shared = [...cameraNameTokens(feature.name)]
          .filter(word => words.has(word)).length;
        const confident = (metres <= 15 && shared >= 1) ||
          (metres <= 150 && shared >= 2) || (metres <= 500 && shared >= 3);
        return confident ? {
          feature, index, metres, shared,
          score: shared * 100 - Math.min(metres, 500)
        } : null;
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      const best = matches[0];
      if (best && (!matches[1] || best.score - matches[1].score >= 15)) {
        used.add(best.index);
        result.push({
          ...camera, urls: [...best.feature.urls],
          verifiedImageTimestamp: best.feature.verifiedImageTimestamp ?? null,
          liveMatched: true, liveObjectId: best.feature.objectId,
          matchMetres: Math.round(best.metres)
        });
      } else result.push({ ...camera, liveMatched: false });
    }
    return result;
  }

  async function jpegFromBlob(blob, options = {}) {
    if (!blob?.size) throw new Error("Image response was empty");
    const maxWidth = options.maxWidth || 1080, maxHeight = options.maxHeight || 600;
    const quality = options.quality ?? 0.78;
    let image, objectUrl;
    try {
      if (typeof root.createImageBitmap === "function") {
        image = await root.createImageBitmap(blob);
      } else {
        objectUrl = URL.createObjectURL(blob);
        image = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Image could not be decoded"));
          img.src = objectUrl;
        });
      }
      if (!image.width || !image.height) throw new Error("Image has invalid dimensions");
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image conversion canvas unavailable");
      context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return { data: canvas.toDataURL("image/jpeg", quality), width, height };
    } finally {
      image?.close?.();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  function wm(coord) {
    const lat = Math.max(-85, Math.min(85, coord[1]));
    const R = 20037508.342789244;
    return [coord[0] * R / 180,
      Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R / Math.PI];
  }

  function positionOnMap(point, extent, x, y, w, h) {
    const [px, py] = wm(point);
    return [
      x + (px - extent[0]) / (extent[2] - extent[0]) * w,
      y + (extent[3] - py) / (extent[3] - extent[1]) * h
    ];
  }

  // Ring/grid pin deconfliction and leader-line endpoints proven in the lab.
  function layoutCameraMarkers(cameras, extent, frame) {
    const margin = 6, minGap = 10.5, placed = [];
    const available = cameras.map((camera, index) => ({ camera, index }))
      .filter(({ camera }) => !camera.repeated && Array.isArray(camera.coord) &&
        camera.coord.length >= 2);
    for (const entry of available) {
      const [rawX, rawY] = positionOnMap(entry.camera.coord, extent,
        frame.x, frame.y, frame.w, frame.h);
      if (!Number.isFinite(rawX) || !Number.isFinite(rawY) ||
          rawX < frame.x || rawX > frame.x + frame.w ||
          rawY < frame.y || rawY > frame.y + frame.h) continue;
      let chosen = null;
      const valid = (px, py) =>
        px >= frame.x + margin && px <= frame.x + frame.w - margin &&
        py >= frame.y + margin && py <= frame.y + frame.h - margin &&
        placed.every(({ x, y }) => Math.hypot(px - x, py - y) >= minGap);
      for (let ring = 0; ring <= 14 && !chosen; ring++) {
        const positions = ring === 0 ? 1 : 8 * ring;
        for (let slot = 0; slot < positions; slot++) {
          const angle = 2 * Math.PI * slot / positions + ring * 0.19;
          const radius = ring * 12;
          const px = rawX + Math.cos(angle) * radius;
          const py = rawY + Math.sin(angle) * radius;
          if (valid(px, py)) { chosen = { x: px, y: py }; break; }
        }
      }
      if (!chosen) {
        const candidates = [];
        for (let py = frame.y + margin; py <= frame.y + frame.h - margin; py += minGap) {
          for (let px = frame.x + margin; px <= frame.x + frame.w - margin; px += minGap) {
            if (valid(px, py)) candidates.push({
              x: px, y: py, distance: Math.hypot(px - rawX, py - rawY)
            });
          }
        }
        candidates.sort((a, b) => a.distance - b.distance);
        chosen = candidates[0] || null;
      }
      if (chosen) placed.push({ ...entry, rawX, rawY, ...chosen });
    }
    return placed;
  }

  function reportBounds(warningExtent, cameras) {
    const valid = cameras.filter(c => c.coord?.length >= 2 &&
      c.coord.every(Number.isFinite));
    const longitudes = [warningExtent[0], warningExtent[2],
      ...valid.map(c => c.coord[0])];
    const latitudes = [warningExtent[1], warningExtent[3],
      ...valid.map(c => c.coord[1])];
    const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
    const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
    const dx = Math.max(0.15, (maxLon - minLon) * 0.11);
    const dy = Math.max(0.12, (maxLat - minLat) * 0.11);
    return [Math.max(QLD[0], minLon - dx), Math.max(QLD[1], minLat - dy),
      Math.min(QLD[2], maxLon + dx), Math.min(QLD[3], maxLat + dy)];
  }
  function asWebMercatorExtent(bounds) {
    const lo = wm([bounds[0], bounds[1]]), hi = wm([bounds[2], bounds[3]]);
    return [lo[0], lo[1], hi[0], hi[1]];
  }

  let loadingPdf = null;
  function checkPdfLibrary(Ctor) {
    if (typeof Ctor !== "function") throw new Error("PDF constructor not exported");
    const test = new Ctor({ orientation: "landscape", unit: "mm", format: "a4" });
    test.text("Camera PDF library check", 12, 14);
    const bytes = test.output();
    if (typeof bytes !== "string" || !bytes.startsWith("%PDF")) {
      throw new Error("PDF library failed document self-check");
    }
    return Ctor;
  }
  function ensurePdf() {
    if (typeof root.jspdf?.jsPDF === "function")
      return Promise.resolve(checkPdfLibrary(root.jspdf.jsPDF));
    if (!loadingPdf) {
      loadingPdf = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        // Preserve the bundled AMD-safe jsPDF 2.5.2 browser export.
        script.src = "vendor/jspdf.umd.min.js?v=20260928-camera-production1";
        script.async = true;
        let executionError = "";
        const onError = event => {
          if (String(event.filename || "").includes("jspdf.umd.min.js"))
            executionError = String(event.message || "").slice(0, 160);
        };
        root.addEventListener("error", onError);
        const cleanup = () => root.removeEventListener("error", onError);
        script.onload = () => {
          cleanup();
          try {
            if (typeof root.jspdf?.jsPDF !== "function")
              throw new Error("PDF script loaded without browser export" +
                (executionError ? ": " + executionError : ""));
            resolve(checkPdfLibrary(root.jspdf.jsPDF));
          } catch (error) { reject(error); }
        };
        script.onerror = () => {
          cleanup();
          reject(new Error("Bundled camera PDF script failed to load"));
        };
        document.head.appendChild(script);
      });
    }
    return loadingPdf.catch(error => { loadingPdf = null; throw error; });
  }

  const api = Object.freeze({
    aest, sourceLabels, parseVerifiedImageTimestamp, explicitCaptureTimestamp,
    decideEligibility, matchLiveTrafficCameras, hostedImageUrls, safeImageUrl,
    cameraDistanceMeters, jpegFromBlob, wm, positionOnMap, layoutCameraMarkers,
    reportBounds, asWebMercatorExtent, ensurePdf, checkPdfLibrary
  });
  root.MAPPING_CAMERA_PDF_CORE = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
