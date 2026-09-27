"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const core = require("../camera-pdf-core.js");

const jpg = { data: "data:image/jpeg;base64,YQ==", width: 120, height: 80 };
const embedded = (retrievedAt = new Date("2026-09-28T00:00:00Z")) =>
  ({ pdfImage: jpg, retrievedAt });
const at = Date.parse("2026-09-28T00:00:00Z");

test("recent verified photograph included, timestamps displayed separately", () => {
  const choice = core.decideEligibility(
    { verifiedImageTimestamp: "2026-09-27T23:30:00Z" }, embedded(), at);
  assert.equal(choice.included, true);
  assert.equal(choice.reason, "verified");
  assert.equal(choice.imageCapturedAt.toISOString(), "2026-09-27T23:30:00.000Z");
  assert.notEqual(choice.imageCapturedAt, choice.retrievedAt);
});

test("verified photograph older than 60 minutes excluded; exact boundary allowed", () => {
  assert.equal(core.decideEligibility(
    { verifiedImageTimestamp: "2026-09-27T22:59:59Z" },
    embedded(), at).reason, "stale");
  assert.equal(core.decideEligibility(
    { verifiedImageTimestamp: "2026-09-27T23:00:00Z" },
    embedded(), at).included, true);
});

test("unknown timestamp included and failed image excluded", () => {
  assert.equal(core.decideEligibility({}, embedded(), at).reason, "unknown");
  assert.equal(core.decideEligibility({ verifiedImageTimestamp: null },
    null, at).reason, "image_unavailable");
});

test("malformed/timezone-free dates, out-of-range and future times are unknown", () => {
  for (const raw of ["bad", "2026-09-27T23:10:00", "31/12/2025",
    "1990-01-01T00:00:00Z", "2026-19-80T23:10:00Z"]) {
    assert.equal(core.parseVerifiedImageTimestamp(raw), null);
    assert.equal(core.decideEligibility(
      { verifiedImageTimestamp: raw }, embedded(), at).reason, "unknown");
  }
  assert.equal(core.decideEligibility({
    verifiedImageTimestamp: "2026-10-01T00:00:00Z"
  }, embedded(), at).reason, "unknown");
});

test("record and attachment update metadata never becomes a capture timestamp", () => {
  const record = {
    image_last_updated: 1234567890123,
    lastEditDate: 1234567890123,
    EditDate: 1234567890123,
    updated_at: "2020-01-01T00:00:00Z"
  };
  assert.equal(core.explicitCaptureTimestamp(record), null);
  assert.equal(core.decideEligibility({
    verifiedImageTimestamp: core.explicitCaptureTimestamp(record)
  }, embedded(), at).reason, "unknown");
  assert.equal(core.explicitCaptureTimestamp(
    { Image_Capture_Time: "2026-09-27T23:15:00+00:00" }),
    "2026-09-27T23:15:00+00:00");
  assert.equal(core.aest(new Date("2026-09-28T00:00:00Z")).includes("AEST"), true);
});

test("public traffic/live matching requires close locations and meaningful names", () => {
  const publicCam = {
    name: "Pacific Motorway Logan Road", coord: [153.1, -27.5],
    urls: ["https://public.example/cam.jpg"]
  };
  const live = [{
    geometry: { type: "Point", coordinates: [153.10004, -27.5] },
    properties: {
      Location_Name: "Logan Road Pacific Motorway",
      OBJECTID: 12, Image_Url: "https://live.example/cam.jpg"
    }
  }];
  const matched = core.matchLiveTrafficCameras([publicCam], live)[0];
  assert.equal(matched.liveMatched, true);
  assert.equal(matched.liveObjectId, 12);
  assert.deepEqual(matched.urls, ["https://live.example/cam.jpg"]);
  const unrelated = core.matchLiveTrafficCameras([publicCam],
    [{ ...live[0], properties: { Location_Name: "A completely different place",
      Image_Url: "https://live.example/wrong.jpg" } }])[0];
  assert.equal(unrelated.liveMatched, false);
  const ambiguous = core.matchLiveTrafficCameras([publicCam],
    [live[0], { ...live[0], properties: {
      ...live[0].properties, OBJECTID: 13,
      Image_Url: "https://live.example/other.jpg"
    }}])[0];
  assert.equal(ambiguous.liveMatched, false);
});

test("36 collocated cameras all have distinct clickable marker positions", () => {
  const cameras = Array.from({ length: 36 }, (_, i) => ({
    name: "Camera " + i, coord: [153.0, -27.5]
  }));
  const extent = core.asWebMercatorExtent([152.5, -28, 153.5, -27]);
  const pins = core.layoutCameraMarkers(cameras, extent,
    { x: 12, y: 32, w: 220, h: 151 });
  assert.equal(pins.length, 36);
  assert.equal(new Set(pins.map(p =>
    p.x.toFixed(2) + ":" + p.y.toFixed(2))).size, 36);
  assert.ok(pins.some(p => Math.hypot(p.x - p.rawX, p.y - p.rawY) > 6));
});

test("real production code compiles and opt-in lab uses shared primitives", () => {
  for (const file of ["camera-pdf-production.js", "camera-pdf-probe.js",
    "renderer.js", "app.js"]) {
    assert.doesNotThrow(() =>
      new vm.Script(fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
        { filename: file }));
  }
  const probe = fs.readFileSync(path.join(__dirname,
    "../camera-pdf-probe.js"), "utf8");
  assert.match(probe, /MAPPING_CAMERA_PDF_CORE\.matchLiveTrafficCameras/);
  assert.match(probe, /MAPPING_CAMERA_PDF_CORE\.layoutCameraMarkers/);
  assert.match(probe, /MAPPING_CAMERA_PDF_CORE\.ensurePdf/);
});

function fakeBrowser({ count = 13, stale = false, allCors = false,
  noWarnings = false } = {}) {
  const els = Object.fromEntries(
    ["generateCameraPdf", "cancelCameraPdf", "cameraPdfStatus",
      "cameraPdfProgress"].map(id => [id, {
        id, hidden: id === "cancelCameraPdf" || id === "cameraPdfProgress",
        textContent: "", value: 0, max: 1, disabled: false, handlers: {},
        addEventListener(name, cb) { this.handlers[name] = cb; }
      }]));
  const written = [];
  const pdfs = [];
  class FakePDF {
    constructor() {
      this.pages = 1; this.links = []; this.images = []; this.texts = [];
      pdfs.push(this);
    }
    setProperties() { return this; }
    setFont() { return this; }
    setFontSize() { return this; }
    setTextColor() { return this; }
    setDrawColor() { return this; }
    setFillColor() { return this; }
    setLineWidth() { return this; }
    text(v) { this.texts.push(v); return this; }
    link(x, y, w, h, target) {
      this.links.push({ ...target, from: this.pages }); return this;
    }
    rect() { return this; }
    roundedRect() { return this; }
    circle() { return this; }
    line() { return this; }
    addImage(data) { this.images.push(data); return this; }
    splitTextToSize(value) { return [String(value).slice(0, 65)]; }
    addPage() { this.pages++; return this; }
    output() { return new Blob(["%PDF-1.4 synthetic test"], { type: "application/pdf" }); }
  }
  const baseCore = { ...core,
    jpegFromBlob: async () => jpg,
    ensurePdf: async () => FakePDF
  };
  const root = {
    MAPPING_CAMERA_PDF_CORE: baseCore,
    MAPPING_ARCGIS: {
      async renderBasemapImage(extent) {
        return { extent, blob: new Blob(["synthetic image"]) };
      },
      async fetchCameraAttachment() { return new Blob(["synthetic image"]); }
    },
    setTimeout
  };
  const fakeCtx = {
    fillRect() {}, drawImage() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, save() {}, restore() {}
  };
  const document = {
    getElementById(id) { return els[id]; },
    createElement(tag) {
      if (tag === "canvas") return {
        width: 1100, height: 755,
        getContext() { return fakeCtx; },
        toDataURL() { return jpg.data; }
      };
      return { click() { written.push("download"); }, remove() {},
        set href(value) {}, set download(value) { written.push(value); } };
    },
    body: { appendChild() {} }
  };
  const FakeURL = class extends URL {
    static createObjectURL() { return "blob:synthetic"; }
    static revokeObjectURL() {}
  };
  const context = {
    window: root, document, location: { protocol: "https:" },
    URL: FakeURL, Blob, Date, Math, DOMException,
    setTimeout, clearTimeout, console,
    createImageBitmap: async () => ({ width: 1100, height: 755, close() {} }),
    fetch: async url => {
      if (allCors || String(url).includes("blocked"))
        throw new TypeError("CORS blocked");
      return { ok: true, blob: async () => new Blob(["synthetic image"]) };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    "../camera-pdf-production.js"), "utf8"), context,
    { filename: "camera-pdf-production.js" });
  const source = Array.from({ length: count }, (_, i) => ({
    id: i + 1, description: "Pacific Motorway Camera " + i,
    coordinates: [153 + (i % 7) * .003, -27.5 + Math.floor(i / 7) * .003],
    imageUrl: "https://images.example/" + (i === count - 1 && !allCors
      ? "blocked" : i) + ".jpg",
    verifiedImageTimestamp: stale ? "2020-01-01T00:00:00Z" : null
  }));
  root.MAPPING_CAMERA_REPORT.setContext({
    warning: noWarnings ? { active: false } : {
      active: true, extent: [152.8, -27.7, 153.3, -27.3],
      mask: {
        visible: new Uint8Array([1,1,1,1]), extent: [152.8,-27.7,153.3,-27.3],
        width: 2, height: 2, gridWidth: 2, gridHeight: 2, step: 1
      }
    },
    profile: { key: "thunderstorm", label: "Severe Thunderstorm",
      outputTitle: "Severe Thunderstorm Warning" },
    sources: {
      tmr: { status: "ready", cameras: source },
      floodCameras: { status: "ready", cameras: [] },
      bccResilience: { status: "ready", cameras: [] }
    }
  });
  return { els, pdfs, written, root };
}

async function waitFor(fn, max = 2000) {
  const start = Date.now();
  while (!fn() && Date.now() - start < max)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(fn(), "Timed out waiting for report result");
}

test("production report omits CORS-blocked camera before marker numbering and navigation", async () => {
  const browser = fakeBrowser({ count: 13 });
  browser.els.generateCameraPdf.handlers.click();
  await waitFor(() => browser.els.cameraPdfStatus.textContent
    .startsWith("Camera PDF downloaded:"));
  assert.equal(browser.pdfs.length, 1);
  assert.equal(browser.pdfs[0].pages, 3); // 12 eligible = overview + 2 six-camera pages
  assert.equal(browser.pdfs[0].links.filter(link => link.from === 1).length, 24);
  assert.ok(browser.pdfs[0].links.every(link => link.pageNumber >= 1 &&
    link.pageNumber <= 3));
  assert.equal(browser.pdfs[0].images.length, 13); // 1 basemap + 12 actual photographs
  assert.ok(browser.pdfs[0].texts.every(t =>
    !String(t).includes("Image unavailable")));
  assert.match(browser.els.cameraPdfStatus.textContent, /1 image failures/);
  assert.match(browser.els.cameraPdfStatus.textContent, /12 photographs/);
});

test("36 eligible cameras yield seven pages and all marker/index links", async () => {
  const browser = fakeBrowser({ count: 36 });
  // The fake browser blocks the last image; replace that specific failure.
  browser.root.MAPPING_CAMERA_REPORT.setContext({
    warning: {
      active: true, extent: [152.8, -27.7, 153.3, -27.3],
      mask: { visible: new Uint8Array([1,1,1,1]), extent: [152.8,-27.7,153.3,-27.3],
        width: 2, height: 2, gridWidth: 2, gridHeight: 2, step: 1 }
    },
    profile: { key: "thunderstorm", label: "Severe Thunderstorm" },
    sources: { tmr: { status:"ready", cameras:
      Array.from({ length: 36 }, (_,i) => ({
        description: "Camera " + i, id:i, coordinates:[153,-27.5],
        imageUrl:"https://images.example/" + i + ".jpg"
      })) }, floodCameras: { status:"ready", cameras:[] },
      bccResilience: { status:"ready", cameras:[] } }
  });
  browser.els.generateCameraPdf.handlers.click();
  await waitFor(() => browser.els.cameraPdfStatus.textContent
    .startsWith("Camera PDF downloaded:"));
  assert.equal(browser.pdfs[0].pages, 7);
  assert.equal(browser.pdfs[0].links.filter(link => link.from === 1).length, 72);
  assert.ok(browser.pdfs[0].links.some(link => link.pageNumber === 7));
  assert.equal(browser.pdfs[0].links.filter(link =>
    link.from > 1 && link.pageNumber === 1).length, 6);
});

test("zero eligible images and explicit cancellation produce no PDF", async () => {
  const old = fakeBrowser({ count: 4, stale: true });
  old.els.generateCameraPdf.handlers.click();
  await waitFor(() => old.els.cameraPdfStatus.textContent.includes("no PDF created"));
  assert.equal(old.pdfs.length, 0);
  const cors = fakeBrowser({ count: 3, allCors: true });
  cors.els.generateCameraPdf.handlers.click();
  await waitFor(() => cors.els.cameraPdfStatus.textContent.includes("no PDF created"));
  assert.equal(cors.pdfs.length, 0);
  const cancelled = fakeBrowser({ count: 12 });
  cancelled.els.generateCameraPdf.handlers.click();
  cancelled.els.cancelCameraPdf.handlers.click();
  assert.match(cancelled.els.cameraPdfStatus.textContent, /cancelled/);
  assert.equal(cancelled.pdfs.length, 0);
});

test("Flooding/no warning disables production camera report", () => {
  const browser = fakeBrowser({ count: 3, noWarnings: true });
  assert.equal(browser.els.generateCameraPdf.disabled, true);
  assert.equal(browser.pdfs.length, 0);
});
