(() => {
  const cfg = window.MAPPING_CONFIG || {};
  const publicSources = cfg.publicSources || {};
  const renderCfg = cfg.rendering || {};
  const QLD_EXTENT = renderCfg.qldExtent || [137.7, -29.3, 154.2, -9.0];
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

  let outputUrls = [];

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

  async function detectWarningExtent() {
    const arcgis = window.MAPPING_ARCGIS;
    if (!arcgis?.renderWmsImage) throw new Error("Authenticated ArcGIS rendering is not ready.");

    const detectionSize = renderCfg.warningDetectionSize || [720, 900];
    const result = await arcgis.renderWmsImage(
      "warning",
      QLD_EXTENT,
      detectionSize[0],
      detectionSize[1]
    );
    const image = await blobToBitmap(result.blob);

    const canvas = document.createElement("canvas");
    canvas.width = detectionSize[0];
    canvas.height = detectionSize[1];
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bg = backgroundSample(pixels, canvas.width, canvas.height);

    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = -1;
    let maxY = -1;
    let hits = 0;
    const step = 2;

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const i = (y * canvas.width + x) * 4;
        const a = pixels[i + 3];
        const alphaDelta = Math.abs(a - bg[3]);
        const colourDelta =
          Math.abs(pixels[i] - bg[0]) +
          Math.abs(pixels[i + 1] - bg[1]) +
          Math.abs(pixels[i + 2] - bg[2]);

        const visible = a > 12 && (alphaDelta > 18 || colourDelta > 55 || bg[3] < 25);
        if (!visible) continue;

        hits += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (hits < 35 || maxX < minX || maxY < minY) {
      return { active: false, extent: [...QLD_EXTENT], detectionBlob: result.blob };
    }

    const [xmin, ymin, xmax, ymax] = QLD_EXTENT;
    const lonAt = (x) => xmin + (x / canvas.width) * (xmax - xmin);
    const latAt = (y) => ymax - (y / canvas.height) * (ymax - ymin);

    let wxmin = lonAt(minX);
    let wxmax = lonAt(maxX + step);
    let wymax = latAt(minY);
    let wymin = latAt(maxY + step);

    const lonSpan = Math.max(0.4, wxmax - wxmin);
    const latSpan = Math.max(0.4, wymax - wymin);
    const lonPad = Math.max(0.25, lonSpan * 0.16);
    const latPad = Math.max(0.25, latSpan * 0.16);

    wxmin = clamp(wxmin - lonPad, xmin, xmax);
    wxmax = clamp(wxmax + lonPad, xmin, xmax);
    wymin = clamp(wymin - latPad, ymin, ymax);
    wymax = clamp(wymax + latPad, ymin, ymax);

    return {
      active: true,
      extent: [wxmin, wymin, wxmax, wymax],
      detectionBlob: result.blob
    };
  }

  function extentAspect(extent) {
    const [xmin, ymin, xmax, ymax] = extent;
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

  async function loadPublicData(extent, statewide) {
    const jobs = {
      mainland: queryArcgis(publicSources.mainland, extent, "1=1", "feature_type,name"),
      coastline: queryArcgis(publicSources.coastline, extent, "1=1", "feature_type"),
      border: queryArcgis(publicSources.stateBorder, extent, "1=1", "border_desc,state_desc"),
      lga: queryArcgis(publicSources.lga, extent, "1=1", "*"),
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

  function makeTransform(extent, width, height) {
    const [xmin, ymin, xmax, ymax] = extent;
    return ([lon, lat]) => [
      ((lon - xmin) / (xmax - xmin)) * width,
      ((ymax - lat) / (ymax - ymin)) * height
    ];
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
      "lga_name", "LGA_NAME", "lga", "LGA", "name", "NAME",
      "local_government_area", "locality", "road_name_full"
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
      const text = item.affected.toLocaleString("en-AU");
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

  function drawContext(ctx, width, height, extent, data, active) {
    const project = makeTransform(extent, width, height);
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

    drawFeatureSet(ctx, data.lga, project, {
      strokeStyle: "rgba(101,107,111,.42)",
      lineWidth: 1
    });

    drawLgaLabels(ctx, data.lga, project, active);
    drawPopulationCentres(ctx, data.centres, project, !active);

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
    const footerHeight = 74;
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

  function drawRadarLegend(ctx, product, active) {
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
      drawLegendBox(ctx, x, rowY, "rgba(255,212,59,.28)", "#b45309", "Severe thunderstorm warning");
      x += 242;
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
    ctx.fillText("Bureau of Meteorology radar rain-rate symbology", 16, y + 103);
  }

  function drawInfrastructureLegend(ctx, product, active, hasPointOutages=false) {
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
      drawLegendBox(ctx, x, row1, "rgba(255,212,59,.28)", "#b45309", "Severe thunderstorm warning");
      x += 242;
    }
    drawLegendLine(ctx, x, row1, "#3e4549", "Queensland coastline / state border");
    x += 280;
    drawLegendLine(ctx, x, row1, "rgba(101,107,111,.72)", "Local government area boundary", 36);

    x = 16;
    drawLegendBox(ctx, x, row2, "rgba(210,35,42,.22)", "#92141b", "Unplanned power outage area (number = customers affected)");
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
    ctx.fillText("Road event names are intentionally omitted from the operational map.", 16, y + 103);
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
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png");
    });
  }

  function revokeOutputs() {
    outputUrls.forEach((url) => URL.revokeObjectURL(url));
    outputUrls = [];
  }

  function addMapCard(blob, title, filename, meta) {
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
    download.download = filename;
    download.textContent = "Download PNG";

    info.append(copy, download);
    card.append(imageLink, info);
    mapsEl.appendChild(card);
  }

  async function buildProducts(extent, active, publicData, publicWarnings) {
    const [mapWidth, mapHeight] = mapSize(extent);
    const arcgis = window.MAPPING_ARCGIS;

    const [warningResult, radarResult] = await Promise.all([
      arcgis.renderWmsImage("warning", extent, mapWidth, mapHeight),
      arcgis.renderWmsImage("radar", extent, mapWidth, mapHeight)
    ]);
    const [warningImage, radarImage] = await Promise.all([
      blobToBitmap(warningResult.blob),
      blobToBitmap(radarResult.blob)
    ]);

    const scopeText = active ? "Current severe-thunderstorm warning extent" : "Queensland statewide · no active severe-thunderstorm warning detected";
    const generated = new Date();
    const stamp = generated.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) + " AEST";

    const radarProduct = makeProductCanvas(
      mapWidth,
      mapHeight,
      active ? "Queensland Severe Thunderstorm Warning + Radar" : "Queensland Statewide Radar",
      scopeText
    );
    const rctx = radarProduct.ctx;
    rctx.save();
    rctx.translate(radarProduct.mapX, radarProduct.mapY);
    drawContext(rctx, mapWidth, mapHeight, extent, publicData, active);
    rctx.drawImage(warningImage, 0, 0, mapWidth, mapHeight);
    rctx.globalAlpha = 0.84;
    rctx.drawImage(radarImage, 0, 0, mapWidth, mapHeight);
    rctx.globalAlpha = 0.55;
    rctx.drawImage(warningImage, 0, 0, mapWidth, mapHeight);
    rctx.globalAlpha = 1;
    rctx.strokeStyle = "#454b4f";
    rctx.lineWidth = 1;
    rctx.strokeRect(0.5, 0.5, mapWidth - 1, mapHeight - 1);
    rctx.restore();
    drawRadarLegend(rctx, radarProduct, active);
    drawFooter(rctx, radarProduct, [
      "Generated " + stamp + " · Warning and radar rendered through authenticated ArcGIS services.",
      "Context: Queensland Government coastline, state border, LGAs, major roads and population centres.",
      publicWarnings.length ? "Context warning: " + publicWarnings[0] : "Private weather data is not committed to GitHub."
    ]);

    const infraProduct = makeProductCanvas(
      mapWidth,
      mapHeight,
      active ? "Queensland Severe Thunderstorm Warning + Infrastructure Impacts" : "Queensland Statewide Infrastructure Impacts",
      scopeText
    );
    const ictx = infraProduct.ctx;
    ictx.save();
    ictx.translate(infraProduct.mapX, infraProduct.mapY);
    const project = drawContext(ictx, mapWidth, mapHeight, extent, publicData, active);
    ictx.drawImage(warningImage, 0, 0, mapWidth, mapHeight);
    drawOutages(ictx, publicData.outagesNorm || [], project, !active);
    drawRoadConditions(ictx, publicData.roadsNorm || [], project);
    ictx.strokeStyle = "#454b4f";
    ictx.lineWidth = 1;
    ictx.strokeRect(0.5, 0.5, mapWidth - 1, mapHeight - 1);
    ictx.restore();

    const knownCustomers = (publicData.outagesNorm || []).reduce((sum, outage) => sum + (outage.affected || 0), 0);
    const fullClosures = (publicData.roadsNorm || []).filter((road) => road.passability === "impassable").length;
    const restrictions = (publicData.roadsNorm || []).filter((road) => road.passability === "passable_with_conditions").length;

    const hasPointOutages = (publicData.outagesNorm || []).some((outage) =>
      outage.geometry?.type === "Point" || outage.geometry?.type === "MultiPoint"
    );
    drawInfrastructureLegend(ictx, infraProduct, active, hasPointOutages);
    drawFooter(ictx, infraProduct, [
      "Generated " + stamp + " · " + (publicData.outagesNorm || []).length + " unplanned outage area(s), " + knownCustomers.toLocaleString("en-AU") + " known customers affected.",
      "QLD Traffic: " + fullClosures + " full closure(s)" + (active ? " and " + restrictions + " restriction(s)." : "; conditional restrictions suppressed on statewide view."),
      publicWarnings.length ? "Context warning: " + publicWarnings[0] : "Road conditions: QLD Traffic · power outages: public Queensland outage feed."
    ]);

    return {
      radarBlob: await canvasBlob(radarProduct.canvas),
      infraBlob: await canvasBlob(infraProduct.canvas),
      generated
    };
  }

  async function generateMaps() {
    if (!window.MAPPING_ARCGIS?.renderWmsImage) {
      setStatus("error", "Authenticated renderer is not ready", "Reconnect the standard ArcGIS feeds and try again.", "Not ready");
      return;
    }

    generateButton.disabled = true;
    generateButton.textContent = "Generating…";
    mapsEl.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Detecting current warning extent from the authenticated warning WMS…";
    setStatus("warning", "Generating current maps…", "Checking the warning WMS, loading public Queensland context and rendering the two products.", "Generating");

    try {
      const warning = await detectWarningExtent();
      const extent = warning.extent;
      const statewide = !warning.active;

      if (warningCount) warningCount.textContent = warning.active ? "Active" : "0";
      if (modeEl) modeEl.textContent = statewide ? "Statewide" : "Warning extent";

      emptyEl.textContent = "Loading public Queensland context, outage and road-condition data…";
      const { data, warnings } = await loadPublicData(extent, statewide);

      emptyEl.textContent = "Rendering authenticated weather imagery and composing PNG products…";
      const products = await buildProducts(extent, warning.active, data, warnings);

      revokeOutputs();
      mapsEl.innerHTML = "";

      addMapCard(
        products.radarBlob,
        warning.active ? "Warning + Radar" : "Statewide Radar",
        warning.active ? "warning-radar-combined.png" : "warning-radar-statewide.png",
        warning.active ? "radar · combined warning extent" : "radar · statewide"
      );
      addMapCard(
        products.infraBlob,
        warning.active ? "Warning + Infrastructure Impacts" : "Statewide Infrastructure Impacts",
        warning.active ? "warning-infrastructure-combined.png" : "warning-infrastructure-statewide.png",
        warning.active ? "infrastructure · combined warning extent" : "infrastructure · statewide"
      );

      emptyEl.hidden = true;
      if (generatedAt) {
        generatedAt.textContent = products.generated.toLocaleTimeString("en-AU", {
          timeZone: "Australia/Brisbane",
          hour: "2-digit",
          minute: "2-digit"
        }) + " AEST";
      }

      setStatus(
        warnings.length ? "warning" : "ok",
        warning.active ? "Current warning maps generated" : "Statewide maps generated",
        warning.active
          ? "The two products use the combined detected extent of the current authenticated severe-thunderstorm warning WMS."
          : "No active severe-thunderstorm warning pixels were detected within Queensland, so the two products use the statewide extent.",
        warnings.length ? "Partial" : "Current"
      );
    } catch (error) {
      mapsEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = cleanMessage(error);
      setStatus("error", "Map generation failed", cleanMessage(error), "Error");
    } finally {
      generateButton.disabled = false;
      generateButton.textContent = "Generate maps";
    }
  }

  generateButton?.addEventListener("click", generateMaps);
})();
