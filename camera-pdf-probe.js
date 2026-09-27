/* Camera PDF proof of concept. Only active with ?cameraPdfTest=1.
 * Browser-only, independent of normal warning/JPEG generation.
 * Never records credentials, service URLs or image content in the repository.
 */
(() => {
  // Preserve the opt-in flag through an organisation OAuth redirect, which
  // can drop query parameters. Expire it within an hour in the same tab.
  const testKey = "mapping.cameraPdfTest.until";
  const param = new URLSearchParams(location.search).get("cameraPdfTest");
  let testEnabled = param === "1";
  try {
    if (param === "0") sessionStorage.removeItem(testKey);
    if (param === "1") sessionStorage.setItem(testKey,String(Date.now()+3600000));
    if (param !== "0" && Number(sessionStorage.getItem(testKey)||0)>Date.now()) {
      testEnabled = true;
    }
  } catch {}
  if (!testEnabled) return;
  const panel = document.getElementById("cameraPdfLab");
  if (!panel) return;
  panel.hidden = false;

  const bounds = [152.3,-28.4,153.8,-26.3]; // Sample South East QLD area, not a live warning.
  const QLD = [137.7,-29.3,154.2,-9.0];
  const sources = [
    { key:"tmr", label:"TMR traffic cameras" },
    { key:"floodCameras", label:"TMR flood cameras" },
    { key:"bccResilience", label:"BCC resilience cameras" }
  ];
  const sourceResults = new Map();
  const runButton = document.getElementById("cameraPdfProbeRun");
  const pdfButton = document.getElementById("cameraPdfProbePdf");
  const countSelect = document.getElementById("cameraPdfProbeCount");
  const summary = document.getElementById("cameraPdfProbeSummary");
  const resultsEl = document.getElementById("cameraPdfProbeResults");
  let selected = [];
  let busy = false;

  const safe = (value) => String(value ?? "").replace(/https?:\/\/\S+/gi,"[service]")
    .replace(/([?&](?:key|token|apikey|api_key)=)[^\s&]+/gi,"$1[redacted]")
    .slice(0,180);
  const nowAest = (date=new Date()) => date.toLocaleString("en-AU",{
    timeZone:"Australia/Brisbane",hour:"2-digit",minute:"2-digit",
    day:"2-digit",month:"short",year:"numeric"
  })+" AEST";
  const isPoint = (feature) => feature?.geometry?.type==="Point" &&
    Array.isArray(feature.geometry.coordinates) &&
    feature.geometry.coordinates.length >= 2;
  const within = (xy,rect) => Number.isFinite(Number(xy[0])) &&
    Number.isFinite(Number(xy[1])) && xy[0]>=rect[0] &&
    xy[0]<=rect[2] && xy[1]>=rect[1] && xy[1]<=rect[3];
  const directUrl = (input) => {
    try {
      const url=new URL(String(input||""));
      return ["https:","http:"].includes(url.protocol)?url.href:"";
    } catch {return "";}
  };
  const timeout = (promise,ms,label) => {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(()=>clearTimeout(timer)),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(label+" timed out")),ms);
      })
    ]);
  };

  function updateResult(key,content) {
    const previous=sourceResults.get(key)||{};
    sourceResults.set(key,{...previous,...content});
    drawResults();
  }
  function drawResults() {
    resultsEl.innerHTML="";
    for(const source of sources) {
      const result=sourceResults.get(source.key)||{status:"Not tested"};
      const row=document.createElement("tr");
      const cells=[
        source.label,
        result.status||"Not tested",
        result.candidates==null?"—":String(result.candidates),
        result.images==null?"—":String(result.images),
        result.elapsed==null?"—":result.elapsed+"s",
        result.note||""
      ];
      for(const value of cells) {
        const td=document.createElement("td");
        td.textContent=value;
        row.appendChild(td);
      }
      resultsEl.appendChild(row);
    }
  }
  function updateBusy(value) {
    busy=value;
    runButton.disabled=value;
    pdfButton.disabled=value||!selected.length;
    countSelect.disabled=value;
  }

  async function candidatesFor(source) {
    const sdk=window.MAPPING_ARCGIS;
    if(source.key==="tmr") {
      const url=window.MAPPING_CONFIG?.publicSources?.trafficCameras;
      if(!url)throw new Error("Public TMR camera feed is not configured");
      const res=await timeout(fetch(url,{cache:"no-store"}),12000,"TMR feed");
      if(!res.ok)throw new Error("TMR feed returned HTTP "+res.status);
      const geojson=await res.json();
      if(!Array.isArray(geojson?.features))throw new Error("TMR did not return GeoJSON");
      return geojson.features.filter(isPoint)
        .filter(f=>within(f.geometry.coordinates,bounds))
        .map(f=>({
          source:source.key,sourceName:source.label,
          name:String(f.properties?.description||f.properties?.locality||"TMR camera"),
          coord:f.geometry.coordinates,
          timestamp:"",
          urls:[directUrl(f.properties?.image_url)].filter(Boolean)
        }))
        .filter(f=>f.urls.length).slice(0,2);
    }
    if(!sdk?.queryCameraLayer)throw new Error("ArcGIS session is not ready");
    const convert=(feature,meta)=>{
      const p=feature.properties||{};
      const flood=source.key==="floodCameras";
      const urls=flood?Object.entries(p)
        .filter(([field])=>/^image_?url[0-9]*$/i.test(field))
        .sort(([a],[b])=>Number(a.match(/[0-9]+$/)?.[0]||0)-
          Number(b.match(/[0-9]+$/)?.[0]||0))
        .map(([,v])=>directUrl(v)).filter(Boolean):[];
      return {
        source:source.key,sourceName:source.label,
        name:String(p.Location_Name||p.location_name||"ArcGIS camera"),
        coord:feature.geometry.coordinates,
        objectId:p[meta?.objectIdField||"OBJECTID"]??p.OBJECTID,
        hasAttachments:!!meta?.hasAttachments,
        timestamp:p.image_last_updated||"",
        urls
      };
    };
    // A wider fallback is used only when SE Queensland has no available
    // cameras, keeping the test independent of an active weather warning.
    let response=await timeout(sdk.queryCameraLayer(source.key,bounds),
      14000,source.label+" local query");
    let features=(response.features||[]).filter(isPoint).map(f=>convert(f,response.source));
    if(!features.length&&source.key==="floodCameras") {
      response=await timeout(sdk.queryCameraLayer(source.key,QLD),
        14000,"Statewide flood camera query");
      features=(response.features||[]).filter(isPoint).map(f=>convert(f,response.source));
    }
    if(source.key==="floodCameras")
      features.sort((a,b)=>b.urls.length-a.urls.length);
    if(source.key==="bccResilience")
      features.sort((a,b)=>(Number(b.hasAttachments)-Number(a.hasAttachments))||
        (Number(Boolean(b.timestamp))-Number(Boolean(a.timestamp))));
    return features.slice(0,2);
  }

  async function verifyImageBlob(blob) {
    if(!blob?.size)throw new Error("Image response was empty");
    // ArcGIS image attachments sometimes have generic MIME types; validate
    // actual decodability instead of trusting Content-Type alone.
    const image=await createImageBitmap(blob);
    try {
      if(!image.width||!image.height)throw new Error("Image has invalid dimensions");
    } finally {image.close();}
    return blob;
  }

  async function readImage(camera) {
    const started=performance.now();
    if(camera.source==="bccResilience") {
      if(!camera.hasAttachments||camera.objectId==null)
        throw new Error("No accessible image attachment was advertised");
      const blob=await timeout(
        window.MAPPING_ARCGIS.fetchCameraAttachment("bccResilience",camera.objectId),
        14000,"BCC attachment"
      );
      await verifyImageBlob(blob);
      return {blob,ms:Math.round(performance.now()-started)};
    }
    if(!camera.urls.length)throw new Error("No direct image URL");
    let failure;
    for(const url of camera.urls) {
      try {
        const res=await timeout(fetch(url,{mode:"cors",cache:"no-store"}),
          9000,"Image fetch");
        if(!res.ok)throw new Error("Image returned HTTP "+res.status);
        const blob=await res.blob();
        await verifyImageBlob(blob);
        return {blob,ms:Math.round(performance.now()-started)};
      } catch(err){failure=err;}
    }
    throw new Error("Image retrieval failed (possibly CORS or access): "+
      safe(failure?.message||"unknown"));
  }

  async function runProbe() {
    if(busy)return;
    selected=[];sourceResults.clear();drawResults();
    pdfButton.disabled=true;
    updateBusy(true);
    summary.textContent="Testing up to two cameras from each source. No warning or JPEG generation is required.";
    const allStart=performance.now();
    await Promise.allSettled(sources.map(async(source)=>{
      const started=performance.now();
      updateResult(source.key,{status:"Querying",candidates:null,images:null,
        elapsed:null,note:""});
      try {
        const cameras=await candidatesFor(source);
        updateResult(source.key,{status:"Testing images",candidates:cameras.length,
          note:cameras.length?"":"No matching test cameras"});
        const checked=await Promise.all(cameras.map(async(camera)=>{
          try {
            const image=await readImage(camera);
            return {...camera,blob:image.blob,imageOk:true,
              retrievalMs:image.ms,retrievedAt:new Date(),error:""};
          } catch(e) {
            return {...camera,blob:null,imageOk:false,
              retrievedAt:new Date(),error:safe(e.message)};
          }
        }));
        selected.push(...checked);
        const good=checked.filter(c=>c.imageOk).length;
        const fail=checked.filter(c=>!c.imageOk);
        updateResult(source.key,{
          status:good===checked.length?(checked.length?"Passed":"No samples"):
            good?"Partial":"Image unavailable",
          candidates:cameras.length,images:good,
          elapsed:((performance.now()-started)/1000).toFixed(1),
          note:fail.map(c=>c.name+": "+c.error).join("; ").slice(0,200)
        });
      }catch(err){
        updateResult(source.key,{status:"Unavailable",candidates:0,images:0,
          elapsed:((performance.now()-started)/1000).toFixed(1),
          note:safe(err?.message||err)});
      }
    }));
    // Keep source ordering stable even when async requests finish arbitrarily.
    selected=sources.flatMap(source=>selected.filter(c=>c.source===source.key));
    const total=selected.length;
    const embedded=selected.filter(c=>c.imageOk).length;
    const sec=((performance.now()-allStart)/1000).toFixed(1);
    summary.textContent=total+" test cameras · "+embedded+
      " embedded-image candidates · "+sec+"s. "+
      (total?"Generate a sample PDF to test layout and internal map links.":
        "All sources were empty/unavailable. The sample PDF button stays disabled.");
    updateBusy(false);
  }

  async function jpegFromBlob(blob) {
    const image=await createImageBitmap(blob);
    try {
      const maxWidth=1080,maxHeight=600;
      const scale=Math.min(maxWidth/image.width,maxHeight/image.height,1);
      const w=Math.max(1,Math.round(image.width*scale));
      const h=Math.max(1,Math.round(image.height*scale));
      const canvas=document.createElement("canvas");
      canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);
      ctx.drawImage(image,0,0,w,h);
      return {data:canvas.toDataURL("image/jpeg",0.78),width:w,height:h};
    } finally {image.close();}
  }

  function geographicBounds(items) {
    const valid=items.filter(c=>Array.isArray(c.coord)&&c.coord.every(Number.isFinite));
    if(!valid.length)return bounds;
    const lon=valid.map(c=>c.coord[0]),lat=valid.map(c=>c.coord[1]);
    const minLon=Math.min(...lon),maxLon=Math.max(...lon),
      minLat=Math.min(...lat),maxLat=Math.max(...lat);
    const dx=Math.max(.25,(maxLon-minLon)*.17);
    const dy=Math.max(.2,(maxLat-minLat)*.17);
    return [Math.max(QLD[0],minLon-dx),Math.max(QLD[1],minLat-dy),
      Math.min(QLD[2],maxLon+dx),Math.min(QLD[3],maxLat+dy)];
  }
  const wm=(coord)=>{
    const lat=Math.max(-85,Math.min(85,coord[1]));
    const R=20037508.342789244;
    return [coord[0]*R/180,
      Math.log(Math.tan((90+lat)*Math.PI/360))*R/Math.PI];
  };
  function positionOnMap(point,extent,x,y,w,h) {
    const [px,py]=wm(point);
    return [
      x+(px-extent[0])/(extent[2]-extent[0])*w,
      y+(extent[3]-py)/(extent[3]-extent[1])*h
    ];
  }

  async function fetchTestBasemap(cameras) {
    const sdk=window.MAPPING_ARCGIS;
    const geographic=geographicBounds(cameras);
    const bl=wm([geographic[0],geographic[1]]),
      tr=wm([geographic[2],geographic[3]]);
    let extent=[bl[0],bl[1],tr[0],tr[1]];
    if(!sdk?.renderBasemapImage)return {image:null,extent};
    try {
      const data=await timeout(sdk.renderBasemapImage(extent,1200,850,
        {spatialReference:3857}),16000,"Test basemap");
      if(Array.isArray(data?.extent)&&data.extent.length===4)
        extent=data.extent;
      return {image:data?.blob?await jpegFromBlob(data.blob):null,extent};
    }catch{return {image:null,extent};}
  }

  let loadingPdf=null;
  async function ensurePdf() {
    if(window.jspdf?.jsPDF)return window.jspdf.jsPDF;
    if(!loadingPdf)loadingPdf=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      // Bundled, pinned copy. No third-party PDF CDN request on work networks.
      script.src="vendor/jspdf.umd.min.js";
      script.async=true;
      script.onload=()=>window.jspdf?.jsPDF?
        resolve(window.jspdf.jsPDF):reject(new Error("PDF library did not initialise"));
      script.onerror=()=>reject(new Error(
        "The bundled PDF library could not be loaded. Image retrieval test remains valid."
      ));
      document.head.appendChild(script);
    });
    return loadingPdf.catch((error) => {
      loadingPdf = null;
      throw error;
    });
  }

  function drawMiniMap(doc,cameras,extent,basemap) {
    const x=12,y=33,w=220,h=151;
    doc.setDrawColor(180,186,191);
    doc.setFillColor(236,240,237);doc.roundedRect(x,y,w,h,2,2,"FD");
    if(basemap?.data) {
      // Fit the screenshot inside the map panel; match position calculations
      // to the exact returned Web-Mercator extent, not a guessed bbox.
      doc.addImage(basemap.data,"JPEG",x,y,w,h);
    } else {
      doc.setDrawColor(211,219,213);
      for(let i=1;i<5;i++){
        doc.line(x+(w*i/5),y,x+(w*i/5),y+h);
        doc.line(x,y+(h*i/5),x+w,y+(h*i/5));
      }
      doc.setFontSize(10);doc.setTextColor(110);
      doc.text("Basemap unavailable - geographic test grid",x+6,y+8);
    }
    cameras.forEach((camera,index)=>{
      const [cx,cy]=positionOnMap(camera.coord,extent,x,y,w,h);
      if(cx<x||cx>x+w||cy<y||cy>y+h)return;
      doc.setFillColor(194,36,43);
      doc.setDrawColor(255,255,255);
      doc.circle(cx,cy,4.5,"FD");
      doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(255);
      doc.text(String(index+1),cx,cy+2.6,{align:"center"});
      const page=2+Math.floor(index/6);
      doc.link(cx-5,cy-5,10,10,{pageNumber:page});
    });
  }

  function drawCameraPage(doc,cameras,offset,total) {
    const x0=10, y0=28, cellW=136,cellH=57,gapX=5,gapY=2;
    doc.setTextColor(32);doc.setFont("helvetica","bold");doc.setFontSize(15);
    doc.text("Camera snapshots - TEST ONLY",10,13);
    doc.setFont("helvetica","normal");doc.setFontSize(9);
    doc.text("Six per page | Captured on request | Source timestamps shown if available",10,20);
    doc.setDrawColor(205,210,215);
    for(let local=0;local<6;local++){
      const index=offset+local,cam=cameras[index];
      const col=local%2,row=Math.floor(local/2);
      const x=x0+col*(cellW+gapX),y=y0+row*(cellH+gapY);
      doc.setFillColor(251,251,251);
      doc.roundedRect(x,y,cellW,cellH,2,2,"FD");
      if(!cam){doc.setTextColor(170);doc.setFontSize(10);
        doc.text("No camera selected",x+5,y+27);continue;}
      doc.setTextColor(42);
      doc.setFont("helvetica","bold");doc.setFontSize(8.8);
      const line=doc.splitTextToSize((index+1)+". "+cam.name,cellW-10).slice(0,2);
      doc.text(line,x+4,y+6);
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);
      const time=cam.timestamp?"Source update: "+String(cam.timestamp):
        "Retrieved: "+nowAest(cam.retrievedAt);
      doc.text(cam.sourceName+" | "+time.slice(0,62),x+4,y+14);
      const frame={x:x+4,y:y+18,w:cellW-8,h:cellH-24};
      if(cam.pdfImage) {
        const ratio=Math.min(frame.w/cam.pdfImage.width,frame.h/cam.pdfImage.height);
        const iw=cam.pdfImage.width*ratio,ih=cam.pdfImage.height*ratio;
        doc.addImage(cam.pdfImage.data,"JPEG",
          frame.x+(frame.w-iw)/2,frame.y+(frame.h-ih)/2,iw,ih);
      } else {
        doc.setFillColor(242,244,245);
        doc.rect(frame.x,frame.y,frame.w,frame.h,"F");
        doc.setTextColor(117);doc.setFontSize(9);
        doc.text("Image unavailable",x+cellW/2,frame.y+frame.h/2,{align:"center"});
      }
    }
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(90);
    doc.text("Back to numbered map",10,207);
    doc.link(10,201,50,8,{pageNumber:1});
    doc.text("Page "+doc.internal.getCurrentPageInfo().pageNumber+" of "+total,
      280,207,{align:"right"});
  }

  async function generateTestPdf() {
    if(busy||!selected.length)return;
    updateBusy(true);
    const started=performance.now();
    summary.textContent="Preparing embedded images and geographic test map…";
    try {
      const JsPDF=await ensurePdf();
      const requested=Number(countSelect.value)||6;
      // Layout stress-testing repeats samples intentionally. The PDF labels
      // repeats so they cannot be mistaken for separate cameras.
      const cameras=Array.from({length:requested},(_,i)=>({
        ...selected[i%selected.length],
        repeated:i>=selected.length
      }));
      const originals=new Map();
      await Promise.allSettled(selected.map(async(cam,index)=>{
        if(!cam.blob)return;
        try{originals.set(index,await jpegFromBlob(cam.blob));}catch{}
      }));
      cameras.forEach((cam,i)=>{
        cam.pdfImage=originals.get(i%selected.length)||null;
        if(cam.repeated)cam.name=cam.name+" (layout repeat)";
      });
      const [baseMap,doc]=await Promise.all([
        fetchTestBasemap(cameras),
        Promise.resolve(new JsPDF({orientation:"landscape",unit:"mm",format:"a4",
          compress:true}))
      ]);
      doc.setProperties({title:"Camera PDF proof of concept - TEST ONLY"});
      doc.setFont("helvetica","bold");doc.setFontSize(18);doc.setTextColor(30);
      doc.text("Queensland camera PDF - PROOF OF CONCEPT",12,14);
      doc.setFont("helvetica","normal");doc.setFontSize(10);
      doc.text("NOT AN ACTIVE WARNING | Retrieved: "+nowAest(),12,23);
      drawMiniMap(doc,cameras,baseMap.extent,baseMap.image);
      doc.setFontSize(11);doc.setTextColor(55);
      doc.text("Selected cameras",239,35);
      cameras.slice(0,Math.min(cameras.length,12)).forEach((camera,index)=>{
        const y=44+index*10;
        const text=doc.splitTextToSize((index+1)+". "+camera.name,45).slice(0,2);
        doc.setFontSize(7.8);doc.text(text,239,y);
        doc.link(237,y-4,48,9,{pageNumber:2+Math.floor(index/6)});
      });
      doc.setFontSize(8);doc.text(
        "Red map markers link to snapshot pages. No live image links are used.",
        12,195
      );
      const totalPages=1+Math.ceil(cameras.length/6);
      for(let offset=0;offset<cameras.length;offset+=6){
        doc.addPage("a4","landscape");
        drawCameraPage(doc,cameras,offset,totalPages);
      }
      const pdf=doc.output("blob");
      const url=URL.createObjectURL(pdf);
      const link=document.createElement("a");
      link.href=url;link.download="camera-pdf-TEST-"+
        new Date().toISOString().slice(0,10)+".pdf";
      document.body.appendChild(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),120000);
      summary.textContent="Sample PDF generated: "+cameras.length+" slots, "+
        totalPages+" pages, "+(pdf.size/1048576).toFixed(2)+" MiB, "+
        ((performance.now()-started)/1000).toFixed(1)+"s. "+
        "Test report only, not an active warning.";
    } catch(err){
      summary.textContent="Sample PDF could not be created: "+safe(err?.message||err);
    } finally{updateBusy(false);}
  }

  runButton.addEventListener("click",()=>void runProbe());
  pdfButton.addEventListener("click",()=>void generateTestPdf());
  drawResults();
  summary.textContent="Test mode: choose Probe sources. This does not require an active warning.";
})();
