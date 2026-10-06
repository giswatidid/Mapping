/* Production Camera Situation Report. Explicitly invoked, never part of JPEG generation.
 * Uses only the last completed, Queensland-clipped warning/camera analysis.
 * All source bytes remain in this authenticated browser session.
 */
(() => {
  "use strict";
  const core = window.MAPPING_CAMERA_PDF_CORE;
  if (!core) throw new Error("Camera PDF shared library was not loaded");
  const button = document.getElementById("generateCameraPdf");
  const cancelButton = document.getElementById("cancelCameraPdf");
  const status = document.getElementById("cameraPdfStatus");
  const progress = document.getElementById("cameraPdfProgress");
  if (!button || !cancelButton || !status || !progress) return;

  let context = null, work = null, serial = 0;
  const limits = { images: 3, imageTimeout: 12000, attachmentTimeout: 18000 };

  function message(value) {
    status.textContent = value;
    // Mirror exactly the same production pipeline into the opt-in diagnostic
    // lab, without exposing a simulated warning in the ordinary camera panel.
    work?.onStatus?.(value, progress.value, progress.max, !progress.hidden);
  }
  function isCurrent(run) {
    return work === run && (run.diagnostic || context === run.context) &&
      !run.controller.signal.aborted;
  }
  function assertCurrent(run) {
    if (!isCurrent(run)) throw new DOMException("Report cancelled", "AbortError");
  }
  function setBusy(busy) {
    button.disabled = busy || !context?.warning?.active;
    button.textContent = busy ? "Generating Camera PDF…" : "Generate Camera PDF";
    cancelButton.hidden = !busy;
    cancelButton.disabled = !busy;
  }

  // Changing warning tabs, requesting a new map or logging out immediately
  // invalidates the old camera list. Late ArcGIS/image responses are discarded.
  function invalidate() {
    ++serial;
    if (work) {
      work.controller.abort();
      work.onStatus?.("Camera PDF cancelled because the warning context changed.", 0, 1, false);
    }
    work = null;
    context = null;
    progress.hidden = true;
    progress.value = 0;
    setBusy(false);
    message("Generate warning maps to prepare a camera situation report.");
  }

  function setContext(input) {
    invalidate();
    if (!input?.warning?.active || input.profile?.key === "flooding") {
      message("No active Queensland warning area is available for this report.");
      return;
    }
    context = input;
    setBusy(false);
    const counts = Object.values(input.sources || {}).reduce(
      (sum, result) => sum + (result.cameras?.length || 0), 0);
    const unavailable = Object.values(input.sources || {})
      .filter(item => item.status === "unavailable").length;
    message(counts + " camera locations analysed against the Queensland warning mask" +
      (unavailable ? "; " + unavailable + " source(s) unavailable" : "") +
      ". Photographs are only downloaded if you generate the report.");
  }

  function withDeadline(promise, ms, signal, label) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      let finished = false;
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        fn(value);
      };
      const onAbort = () => finish(reject, new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(() =>
        finish(reject, new Error(label + " timed out")), ms);
      signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(promise).then(value => finish(resolve, value),
        error => finish(reject, error));
    });
  }

  function candidatesFromAnalysis(snapshot) {
    const sources = snapshot.sources || {};
    const tmr = (sources.tmr?.cameras || []).map(c => ({
      source: "tmr", sourceName: core.sourceLabels.tmr,
      name: c.description, coord: [...c.coordinates],
      id: c.id, urls: [c.imageUrl].filter(Boolean),
      verifiedImageTimestamp: c.verifiedImageTimestamp || null
    }));
    const live = (sources.floodCameras?.cameras || []).map(c => ({
      name: c.description, coord: [...c.coordinates],
      objectId: c.objectId, urls: (c.links || []).map(link => link.url)
        .filter(Boolean), verifiedImageTimestamp: c.verifiedImageTimestamp || null
    }));
    const paired = core.matchLiveTrafficCameras(tmr, live);
    const usedLiveIds = new Set(paired.filter(c => c.liveMatched &&
      c.liveObjectId != null).map(c => String(c.liveObjectId)));
    const matched = paired.map((c, index) => ({
      ...c, urls: c.liveMatched
        ? [...new Set([...c.urls, ...tmr[index].urls])] : c.urls
    }));
    const flood = (sources.floodCameras?.cameras || [])
      .filter(c => c.objectId == null || !usedLiveIds.has(String(c.objectId)))
      .map(c => ({
        source: "floodCameras", sourceName: core.sourceLabels.floodCameras,
        name: c.description, coord: [...c.coordinates], objectId: c.objectId,
        urls: (c.links || []).map(link => link.url).filter(Boolean),
        verifiedImageTimestamp: c.verifiedImageTimestamp || null
      }));
    const bcc = (sources.bccResilience?.cameras || []).map(c => ({
      source: "bccResilience", sourceName: core.sourceLabels.bccResilience,
      name: c.description, coord: [...c.coordinates], objectId: c.objectId,
      hasAttachments: c.hasAttachments,
      verifiedImageTimestamp: c.verifiedImageTimestamp || null,
      urls: []
    }));
    // The same physical camera must not produce two report tiles.
    const seen = new Set();
    return [...matched, ...flood, ...bcc].filter(camera => {
      const key = camera.source + ":" +
        (camera.objectId ?? camera.id ??
          camera.name + ":" + camera.coord.join(","));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function fetchUrlAsJpeg(url, run) {
    if (!core.safeImageUrl(url)) throw new Error("Invalid image URL");
    if (location.protocol === "https:" && new URL(url).protocol !== "https:")
      throw new Error("Mixed-content image cannot be fetched");
    const controller = new AbortController();
    const signal = run.controller.signal;
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), limits.imageTimeout);
    try {
      const response = await fetch(url, {
        method: "GET", mode: "cors", credentials: "omit",
        cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("Image HTTP " + response.status);
      const blob = await response.blob();
      assertCurrent(run);
      const pdfImage = await core.jpegFromBlob(blob,
        { maxWidth: 960, maxHeight: 540, quality: 0.73 });
      assertCurrent(run);
      return { pdfImage, retrievedAt: new Date() };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  async function retrieveOne(camera, run) {
    assertCurrent(run);
    const timestamp = core.parseVerifiedImageTimestamp(camera.verifiedImageTimestamp);
    if (timestamp && timestamp.getTime() <= Date.now() + 5 * 60000 &&
        timestamp.getTime() < Date.now() - 3600000) {
      return { reason: "stale", camera };
    }
    if (camera.source === "bccResilience") {
      if (!camera.hasAttachments || camera.objectId == null)
        return { reason: "failed", camera };
      try {
        const blob = await withDeadline(
          window.MAPPING_ARCGIS.fetchCameraAttachment("bccResilience", camera.objectId),
          limits.attachmentTimeout, run.controller.signal, "BCC attachment");
        assertCurrent(run);
        const pdfImage = await core.jpegFromBlob(blob,
          { maxWidth: 960, maxHeight: 540, quality: 0.73 });
        assertCurrent(run);
        return { camera, image: { pdfImage, retrievedAt: new Date() } };
      } catch (error) {
        if (run.controller.signal.aborted) throw error;
        return { reason: error.code === "PHOTO_UNAVAILABLE" ? "placeholder" : "failed", camera };
      }
    }
    let placeholder = false;
    for (const url of camera.urls) {
      try {
        const image = await fetchUrlAsJpeg(url, run);
        return { camera, image };
      } catch (error) {
        if (run.controller.signal.aborted) throw error;
        if (error.code === "PHOTO_UNAVAILABLE") placeholder = true;
        // CORS, HTTP 403, mixed-content and decode errors all exclude this
        // URL; only URLs already associated with this very camera are tried.
      }
    }
    return { reason: placeholder ? "placeholder" : "failed", camera };
  }

  async function concurrentMap(items, limit, mapper, settled) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) },
      async () => {
        while (next < items.length) {
          const i = next++;
          try { results[i] = await mapper(items[i], i); }
          catch (error) {
            if (error?.name === "AbortError") throw error;
            results[i] = { reason: "failed", camera: items[i] };
          }
          settled(results[i]);
        }
      }));
    return results;
  }

  // Raster cells come from the *stored* Queensland-clipped warning mask, not
  // a new WMS detection. Project each cell into the basemap's actual extent.
  function drawWarningMask(canvas, mask, extent) {
    if (!mask?.visible) return;
    const ctx = canvas.getContext("2d");
    const [minLon, minLat, maxLon, maxLat] = mask.extent;
    const step = mask.step, width = canvas.width, height = canvas.height;
    ctx.save();
    ctx.fillStyle = "rgba(242,119,34,0.46)";
    for (let gy = 0; gy < mask.gridHeight; gy++) {
      const north = maxLat - (gy * step / mask.height) * (maxLat - minLat);
      const south = maxLat - (Math.min(mask.height, (gy + 1) * step) /
        mask.height) * (maxLat - minLat);
      // Paint contiguous runs, retaining exact refined cells while avoiding
      // hundreds of thousands of individual fillRect calls and tiny seams.
      for (let gx = 0; gx < mask.gridWidth;) {
        if (!mask.visible[gy * mask.gridWidth + gx]) { gx++; continue; }
        const start = gx;
        while (gx < mask.gridWidth && mask.visible[gy * mask.gridWidth + gx]) gx++;
        const west = minLon + (start * step / mask.width) * (maxLon-minLon);
        const east = minLon + (Math.min(mask.width,gx*step)/mask.width) * (maxLon-minLon);
        const nw=core.positionOnMap([west,north],extent,0,0,width,height);
        const se=core.positionOnMap([east,south],extent,0,0,width,height);
        if(se[0]<0 || nw[0]>width || se[1]<0 || nw[1]>height)continue;
        ctx.fillRect(nw[0],nw[1],se[0]-nw[0],se[1]-nw[1]);
      }
    }
    ctx.restore();
  }

  async function overview(snapshot, cameras, run) {
    const bounds = core.reportBounds(snapshot.warning.extent, cameras);
    let extent = core.asWebMercatorExtent(bounds);
    const width = 1100, height = 755;
    let basemap = null;
    if (window.MAPPING_ARCGIS?.renderBasemapImage) {
      try {
        basemap = await withDeadline(
          window.MAPPING_ARCGIS.renderBasemapImage(extent, width, height,
            { spatialReference: 3857 }), 22000, run.controller.signal,
          "Report basemap");
        if (Array.isArray(basemap?.extent) &&
            basemap.extent.length === 4 &&
            basemap.extent.every(Number.isFinite)) extent = basemap.extent;
      } catch (error) {
        if (run.controller.signal.aborted) throw error;
      }
    }
    assertCurrent(run);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#edf2f2"; ctx.fillRect(0, 0, width, height);
    let hasBasemap = false;
    if (basemap?.blob?.size) {
      try {
        const bitmap = await createImageBitmap(basemap.blob);
        try { ctx.drawImage(bitmap, 0, 0, width, height); hasBasemap = true; }
        finally { bitmap.close(); }
      } catch {}
    }
    assertCurrent(run);
    if (!hasBasemap) {
      ctx.strokeStyle = "#c8d5db"; ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();ctx.moveTo(width * i / 8, 0);
        ctx.lineTo(width * i / 8, height);ctx.stroke();
        ctx.beginPath();ctx.moveTo(0, height * i / 8);
        ctx.lineTo(width, height * i / 8);ctx.stroke();
      }
    }
    drawWarningMask(canvas, snapshot.warning.mask, extent);
    core.drawMapAnnotations(ctx,extent,width,height,snapshot.warning.queenslandBoundary);
    return {
      extent, hasBasemap,
      image: { data: canvas.toDataURL("image/jpeg", 0.78), width, height }
    };
  }

  function drawHeader(doc, title, generatedAt) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.setTextColor(28, 42, 50);
    doc.text(doc.splitTextToSize(title, 272)[0], 10, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.7);
    doc.setTextColor(75);
    doc.text("Generated: " + core.aest(generatedAt) +
      " | Snapshot report - NOT a live camera feed", 11, 22);
  }

  function drawIndex(doc, cameras) {
    const x = 239, y = 33, maxY = 183;
    doc.setTextColor(42); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Camera index", x, y);
    doc.setFont("helvetica", "normal");
    if (cameras.length <= 22) {
      const line = cameras.length <= 16 ? 9 : 6.5;
      cameras.forEach((camera, i) => {
        const yy = y + 9 + i * line;
        doc.setFontSize(cameras.length <= 16 ? 7.1 : 6.2); doc.setTextColor(50);
        const label = doc.splitTextToSize((i + 1) + ". " + camera.name, 47);
        doc.text(label, x, yy);
        doc.link(x - 1, yy - 4.3, 51, line, { pageNumber: 2 + Math.floor(i / 6) });
      });
    } else if (cameras.length <= 62) {
      const rows = Math.ceil(cameras.length / 2);
      cameras.forEach((camera, i) => {
        const col = Math.floor(i / rows), row = i % rows;
        const xx = x + col * 25.5, yy = y + 7 + row * 4.65;
        doc.setFontSize(6); doc.setTextColor(50);
        const label = doc.splitTextToSize((i + 1) + ". " + camera.name, 23.5)[0];
        doc.text(label, xx, yy);
        doc.link(xx - .5, yy - 3.2, 25, 4.3,
          { pageNumber: 2 + Math.floor(i / 6) });
      });
    } else {
      // For extremely large reports, index every snapshot page by its
      // inclusive camera-number range, without clipping or dropping links.
      const pages = Math.ceil(cameras.length / 6);
      const stride = Math.max(1, Math.ceil(pages / 62));
      const ranges = [];
      for (let p = 0; p < pages; p += stride) {
        ranges.push({ first: p * 6 + 1,
          last: Math.min(cameras.length, (p + stride) * 6), page: 2 + p });
      }
      const rows = Math.ceil(ranges.length / 2);
      ranges.forEach((range, i) => {
        const col = Math.floor(i / rows), row = i % rows;
        const xx = x + col * 25.5, yy = y + 7 + row * 4.65;
        doc.setFontSize(6.4); doc.setTextColor(50);
        doc.text(range.first + "-" + range.last + "  p." + range.page, xx, yy);
        doc.link(xx - .5, yy - 3.2, 25, 4.3, { pageNumber: range.page });
      });
    }
    doc.setDrawColor(205, 211, 215);
    doc.line(237, maxY + 1, 290, maxY + 1);
  }

  function drawOverviewPage(doc, snapshot, cameras, map, generatedAt, total, excluded) {
    const title = "Queensland " + (snapshot.profile.outputTitle ||
      snapshot.profile.label + " Warning") + " - Camera Situation Report";
    drawHeader(doc, title, generatedAt);
    if (snapshot.diagnostic) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.setTextColor(177, 27, 35);
      doc.text("SIMULATED TEST AREA - NOT AN ACTIVE WARNING", 12, 28);
    }
    const frame = { x: 12, y: 32, w: 220, h: 151 };
    doc.setDrawColor(160, 173, 180);
    doc.setFillColor(236, 240, 237);
    doc.roundedRect(frame.x, frame.y, frame.w, frame.h, 2, 2, "FD");
    doc.addImage(map.image.data, "JPEG", frame.x, frame.y, frame.w, frame.h);
    const pins = core.layoutCameraMarkers(cameras, map.extent, frame);
    pins.forEach(pin => {
      if (Math.hypot(pin.x - pin.rawX, pin.y - pin.rawY) > 6) {
        doc.setDrawColor(113, 62, 49); doc.setLineWidth(.35);
        doc.line(pin.rawX, pin.rawY, pin.x, pin.y);
      }
    });
    pins.forEach(({ x, y, index }) => {
      doc.setFillColor(192, 38, 45);
      doc.setDrawColor(255, 255, 255);
      doc.circle(x, y, 4.5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(index >= 99 ? 6 : index >= 9 ? 7 : 8);
      doc.setTextColor(255);
      doc.text(String(index + 1), x, y + 2.35, { align: "center" });
      doc.link(x - 5, y - 5, 10, 10,
        { pageNumber: 2 + Math.floor(index / 6) });
    });
    drawIndex(doc, cameras);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.setTextColor(56);
    doc.setFillColor(242, 119, 34); doc.rect(12, 189, 5, 4, "F");
    doc.text(snapshot.diagnostic
      ? "Synthetic test selection - NOT a BoM warning"
      : "Warning area (refined raster approximation)", 19, 192.4);
    doc.setFillColor(192, 38, 45); doc.circle(110, 191, 2.6, "F");
    doc.text("Included camera photographs (click number)", 115, 192.4);
    doc.setTextColor(95); doc.setFontSize(7);
    doc.text(map.hasBasemap ? "ArcGIS topographic basemap" :
      "Basemap unavailable - geographic reference grid", 239, 191);
    doc.text("Only usable photographs are mapped; unknown image age is labelled. " +
      excluded + " camera(s) excluded (unavailable, placeholder or stale).", 12, 200);
    doc.text(cameras.length + " photographs | " + total + " pages | Not a live feed",
      285, 205, { align: "right" });
  }

  function drawSnapshotPage(doc, cameras, offset, generatedAt, total, title, diagnostic=false) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.setTextColor(30); doc.text(title + " - Camera snapshots", 10, 13);
    if (diagnostic) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
      doc.setTextColor(177, 27, 35);
      doc.text("TEST ONLY - NO ACTIVE WARNING", 286, 13, { align: "right" });
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text("Photographs retrieved at report creation, not a live feed. " +
      "Generated: " + core.aest(generatedAt), 10, 20);
    const count = Math.min(6, cameras.length - offset);
    const { columns, cellW, cellH } = core.snapshotLayout(count);
    const x0 = 9, y0 = 27, gapX = 4, gapY = 3;
    for (let local = 0; local < count; local++) {
      const i = offset + local, camera = cameras[i];
      const col = local % columns, row = Math.floor(local / columns);
      const x = x0 + col * (cellW + gapX), y = y0 + row * (cellH + gapY);
      doc.setDrawColor(209, 214, 218);
      doc.setFillColor(251, 252, 252);
      doc.roundedRect(x, y, cellW, cellH, 2, 2, "FD");
      doc.setTextColor(34); doc.setFont("helvetica", "bold"); doc.setFontSize(8.3);
      const heading = doc.splitTextToSize((i + 1) + ". " + camera.name,
        cellW - 6);
      doc.text(heading, x + 3, y + 6);
      const headingHeight = Math.max(0, heading.length-1)*3.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.3);
      doc.setTextColor(74);
      doc.text(doc.splitTextToSize(camera.sourceName, cellW - 6)[0],
        x + 3, y + 12 + headingHeight);
      const capture = camera.imageCapturedAt
        ? "Image captured: " + core.aest(camera.imageCapturedAt)
        : "Image time unknown";
      doc.text(capture, x + 3, y + 17.5 + headingHeight);
      doc.text("Retrieved: " + core.aest(camera.retrievedAt), x + 3, y + 23 + headingHeight);
      const frame = { x: x + 3, y: y + 26 + headingHeight, w: cellW - 6, h: cellH - 29 - headingHeight };
      const img = camera.pdfImage;
      const ratio = Math.min(frame.w / img.width, frame.h / img.height);
      const iw = img.width * ratio, ih = img.height * ratio;
      doc.addImage(img.data, "JPEG", frame.x + (frame.w - iw) / 2,
        frame.y, iw, ih);
      // Release duplicate base64 strings as soon as jsPDF owns each image.
      camera.pdfImage = null;
    }
    doc.setTextColor(80); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("Back to numbered map / camera index", 10, 207);
    doc.link(9, 200.7, 65, 8, { pageNumber: 1 });
    doc.setFontSize(7); doc.setTextColor(100);
    doc.text("An image's retrieval time does not prove its capture time.",
      151, 207, { align: "center" });
    doc.text("Page " + (2 + Math.floor(offset / 6)) + " of " + total,
      286, 207, { align: "right" });
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a);
    a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function createReport(options={}) {
    const snapshot = options.snapshot || context;
    if (work || !snapshot?.warning?.active) return;
    const run = {
      id: ++serial, context: snapshot, controller: new AbortController(),
      diagnostic: options.diagnostic === true, onStatus: options.onStatus || null
    };
    work = run;
    setBusy(true);
    const candidates = candidatesFromAnalysis(run.context);
    const failedSources = Object.values(run.context.sources || {})
      .filter(item => item.status === "unavailable").length;
    let processed = 0, success = 0, failed = 0, stale = 0, placeholders = 0;
    progress.hidden = false; progress.max = Math.max(1, candidates.length);
    progress.value = 0;
    const showProgress = () => {
      if (!isCurrent(run)) return;
      progress.value = processed;
      message("Retrieving camera photographs " + processed + "/" + candidates.length +
        " | retrieved " + success + " | too old " + stale +
        " | unavailable " + failed + " | placeholders " + placeholders +
        (failedSources ? " | source failures " + failedSources : ""));
    };
    showProgress();
    try {
      if (!candidates.length) {
        message("No cameras were found in the current Queensland warning mask. " +
          "No PDF created." + (failedSources ?
          " " + failedSources + " camera source(s) unavailable." : ""));
        return;
      }
      const results = await concurrentMap(candidates, limits.images,
        camera => retrieveOne(camera, run),
        result => {
          processed++;
          if (result.reason === "stale") stale++;
          else if (result.image) success++;
          else if (result.reason === "placeholder") placeholders++;
          else failed++;
          showProgress();
        });
      assertCurrent(run);
      // Re-evaluate age when collection ends. No missing images, stale images
      // or placeholders proceed to map or page-number assignment.
      const ready = results.filter(r => r.image)
        .map(r => {
          const decision = core.decideEligibility(r.camera, r.image, Date.now());
          if (!decision.included) { stale++; success--; return null; }
          return { ...r.camera, ...decision, pdfImage: r.image.pdfImage };
        }).filter(Boolean);
      if (!ready.length) {
        message("No retrievable, sufficiently fresh camera photographs remain. " +
          failed + " image failures, " + placeholders + " placeholders, " + stale + " stale; no PDF created.");
        return;
      }
      message("Preparing " + (run.diagnostic ? "simulated TEST" : "Queensland warning") +
        " overview and " + ready.length + " embedded photographs…");
      const [Ctor, map] = await Promise.all([
        core.ensurePdf(), overview(run.context, ready, run)
      ]);
      assertCurrent(run);
      // A verified image can cross the 60-minute threshold during map render.
      const now = Date.now();
      const eligible = ready.filter(camera => {
        if (camera.imageCapturedAt &&
            camera.imageCapturedAt.getTime() < now - 3600000) {
          stale++; return false;
        }
        return true;
      });
      if (!eligible.length) {
        message("All retrieved photographs are older than 60 minutes; no PDF created.");
        return;
      }
      const generatedAt = new Date();
      const title = run.context.profile.label + " Warning";
      const total = 1 + Math.ceil(eligible.length / 6);
      progress.max = candidates.length + total - 1;
      progress.value = candidates.length;
      const doc = new Ctor({ orientation: "landscape", unit: "mm",
        format: "a4", compress: true });
      doc.setProperties({
        title: "Queensland " + title + " - Camera Situation Report",
        subject: run.diagnostic
          ? "SIMULATED TEST AREA - NOT AN ACTIVE WARNING; camera PDF diagnostic"
          : "Warning-area photograph snapshots; not a live camera feed"
      });
      drawOverviewPage(doc, run.context, eligible, map, generatedAt, total,
        candidates.length-eligible.length);
      for (let offset = 0; offset < eligible.length; offset += 6) {
        assertCurrent(run);
        doc.addPage("a4", "landscape");
        drawSnapshotPage(doc, eligible, offset, generatedAt, total, title,
          run.diagnostic);
        progress.value = candidates.length + 1 + Math.floor(offset / 6);
        message("Constructing PDF page " + (2 + offset / 6) +
          " of " + total + "…");
        // Yield to allow cancellation on large reports.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      assertCurrent(run);
      const pdf = doc.output("blob");
      const formatted = generatedAt.toLocaleString("en-CA", {
        timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
      }).replace(/[^0-9]/g, "");
      const prefix = run.context.profile.key === "thunderstorm"
        ? "thunderstorm" : "severe-weather";
      download(pdf, (run.diagnostic ? "TEST-SIMULATED-" : "") +
        prefix + "-camera-situation-report-" + formatted + "-AEST.pdf");
      message((run.diagnostic ? "SIMULATED TEST - " : "") +
        "Camera PDF downloaded: " + eligible.length + " photographs in " +
        total + " pages. " + stale + " stale; " + failed +
        " image failures; " + placeholders + " placeholders" + (failedSources ? "; " + failedSources +
        " source failures" : "") + ". Image times are labelled individually.");
      progress.value = progress.max;
    } catch (error) {
      if (isCurrent(run)) message("Camera PDF failed: " +
        String(error?.message || error).slice(0, 200) +
        ". Ordinary camera links and JPEG products are unchanged.");
    } finally {
      if (work === run) {
        work = null;
        setBusy(false);
      }
    }
  }

  function cancelReport() {
    if (!work) return;
    const onStatus = work.onStatus;
    work.controller.abort();
    work = null;
    setBusy(false);
    progress.hidden = true;
    const notice = "Camera PDF cancelled. JPEG maps and the camera panel are unchanged.";
    message(notice);
    onStatus?.(notice, 0, 1, false);
  }

  async function runDiagnostic(snapshot, onStatus) {
    // The lab is opt-in and only becomes visible through the explicit test
    // URL. This cannot create a fake production context or alter the renderer.
    if (document.getElementById("cameraPdfLab")?.hidden !== false)
      throw new Error("Open the opt-in camera PDF lab first.");
    if (!snapshot?.diagnostic || !snapshot.warning?.active ||
        snapshot.profile?.key === "flooding")
      throw new Error("A labelled synthetic test context is required.");
    if (work) throw new Error("Another camera PDF is already running.");
    await createReport({ snapshot, diagnostic: true, onStatus });
  }

  button.addEventListener("click", () => void createReport());
  cancelButton.addEventListener("click", cancelReport);
  window.MAPPING_CAMERA_REPORT = Object.freeze({
    invalidate, setContext, runDiagnostic, cancel: cancelReport
  });
  invalidate();
})();

