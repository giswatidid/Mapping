"use strict";
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const core=require('../camera-pdf-core.js');
function harness({radarTime=null,warningTime=null}={}){
  const canvases=[],requests=[];
  const toggle={checked:true};
  class Canvas {
    constructor(){this.width=1;this.height=1;this.ops=[];this.image=null;this.path=[];
      const op=(name)=>(...args)=>this.ops.push([name,...args]);
      this.ctx={save:op('save'),restore:op('restore'),translate:op('translate'),
        beginPath:()=>{this.path=[];this.ops.push(['beginPath']);},
        moveTo:(...v)=>{this.path.push(v);this.ops.push(['moveTo',...v]);},
        lineTo:(...v)=>{this.path.push(v);this.ops.push(['lineTo',...v]);},
        closePath:op('closePath'),stroke:op('stroke'),rect:op('rect'),clip:op('clip'),
        fill:()=>{this.ops.push(['fill']);this.mask=true;},fillRect:op('fillRect'),
        strokeRect:op('strokeRect'),arc:op('arc'),fillText:op('fillText'),strokeText:op('strokeText'),
        measureText:t=>({width:t.length*7}),clearRect:op('clearRect'),
        drawImage:(im,...args)=>{this.image=im;this.tag ||= im.tag || im.image?.tag;const entry=['drawImage',im.tag || im.image?.tag,...args];entry.image=im;this.ops.push(entry);},
        getImageData:()=>({data:this.image?.rgba || new Uint8ClampedArray(this.width*this.height*4).fill(this.mask?255:0)}),
        createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:op('putImageData')};
      canvases.push(this);
    }
    getContext(){return this.ctx;}toBlob(cb){cb(new Blob(['jpeg']));}
  }
  const root={MAPPING_CAMERA_PDF_CORE:core,MAPPING_CONFIG:{rendering:{minimumRegionalKm:180}},
    MAPPING_ARCGIS:{renderWmsImage:async(role,extent,width,height,options)=>{
      requests.push({role,extent,width,height,options});
      const rgba=new Uint8ClampedArray(width*height*4);
      for(let y=Math.floor(height*.3);y<height*.7;y++)for(let x=Math.floor(width*.3);x<width*.7;x++) {
        const i=(y*width+x)*4;rgba[i]=250;rgba[i+1]=210;rgba[i+3]=220;
      }
      return {sourceTime:role==='radar'?radarTime:warningTime,blob:{rgba,tag:role==='radar'?'radar':options.sublayerTitles?.[0]==='tracking'?'tracking':'warning'}};
    }},addEventListener(){}};
  const ctx={window:root,document:{querySelector:s=>s==='#cellTrackingToggle'?toggle:null,
    querySelectorAll:()=>[],createElement:()=>new Canvas()},
    localStorage:{getItem:()=>null},createImageBitmap:async blob=>blob,
    Blob,URL,Date,Math,Uint8Array,Uint8ClampedArray,console,setTimeout,clearTimeout};
  let source=fs.readFileSync(path.join(__dirname,'../renderer.js'),'utf8');
  source=source.slice(0,source.lastIndexOf('  if (cellTrackingToggle) {'))+
    'window.review={analyseDetectionBlob,renderDetectionLayer,clipDetectionToQueensland,warningMaskContainsPoint,buildProducts,drawLgaLabels,makeTransform,sourceTimeText};})();';
  vm.runInNewContext(source,ctx);
  return {api:root.review,root,canvases,requests,toggle};
}
const boundary={type:'FeatureCollection',features:[{type:'Feature',properties:{lga:'Test Region'},
  geometry:{type:'Polygon',coordinates:[[[149,-29],[154,-29],[154,-24],[149,-24],[149,-29]]]}}]};

test('refined raster uses its local extent and rejects cameras outside the actual mask',async()=>{
  const {api}=harness();const width=20,height=20,rgba=new Uint8ClampedArray(width*height*4);
  for(let y=6;y<14;y++)for(let x=6;x<14;x++){const i=(y*width+x)*4;rgba[i]=255;rgba[i+1]=200;rgba[i+3]=200;}
  const scan=await api.analyseDetectionBlob({rgba},[width,height],{extent:[150,-28,152,-26],sampleStep:1});
  assert.equal(scan.active,true);assert.equal(scan.mask.step,1);
  assert.deepEqual(Array.from(scan.mask.extent),[150,-28,152,-26]);
  assert.equal(api.warningMaskContainsPoint(scan.mask,[151,-27]),true);
  assert.equal(api.warningMaskContainsPoint(scan.mask,[150.1,-27]),false);
  assert.equal(api.warningMaskContainsPoint(scan.mask,[153,-27]),false);
  const clipped=api.clipDetectionToQueensland(scan,boundary);
  assert.equal(clipped.active,true);
  assert.equal(api.warningMaskContainsPoint(clipped.mask,[151,-27]),true);
});

test('local WMS refinement preserves geographic image aspect and uses single pixel samples',async()=>{
  const {api,requests}=harness();
  const result=await api.renderDetectionLayer(['warning'],{extent:[150,-28,152,-27],size:[160,160],sampleStep:1});
  const r=requests[0];assert.equal(r.width,160);assert.equal(r.height,80);
  assert.ok(Math.abs((r.extent[2]-r.extent[0])/(r.extent[3]-r.extent[1])-r.width/r.height)<1e-9);
  assert.equal(result.mask.step,1);
  assert.deepEqual(Array.from(result.mask.extent),Array.from(r.extent));
});

test('both JPEGs clip map layers before drawing and radar omits opaque tracking',async()=>{
  const {api,canvases}=harness();
  const profile={key:'thunderstorm',supportsTracking:true,renderSublayerTitles:['warning'],trackingSublayerTitles:['tracking'],
    label:'Severe Thunderstorm',outputTitle:'Severe Thunderstorm Warning',legendLabel:'Severe thunderstorm warning'};
  const data={lga:boundary,outagesNorm:[],roadsNorm:[],affectedLgas:['Test Region']};
  const products=await api.buildProducts([150,-28,152,-26],true,data,[],profile,null,boundary);
  assert.ok(products.radarBlob.size && products.infraBlob.size);
  const maps=canvases.filter(c=>c.ops.some(op=>op[0]==='translate'));
  assert.equal(maps.length,2);
  for(const c of maps){
    const translated=c.ops.findIndex(op=>op[0]==='translate');
    assert.deepEqual(c.ops[translated+1],['beginPath']);
    assert.equal(c.ops[translated+2][0],'rect');
    assert.equal(c.ops[translated+3][0],'clip');
    assert.ok(c.ops.some(op=>op[0]==='fillText' && String(op[1]).includes('Test Region')));
    assert.ok(!c.ops.some(op=>op[0]==='fillText' && /not supplied|Radar observation:|Warning issued:/.test(String(op[1]))));
  }
  const outline=canvases.find(c=>c.ops.some(op=>op[0]==='putImageData'));
  assert.ok(outline);
  for(const c of maps)assert.equal(c.ops.filter(op=>op[0]==='drawImage' && op.image===outline).length,1);
  assert.equal(maps[0].height,maps[1].height);
  // Tracking is first composed into its own clipped canvas, which is then
  // drawn only on infrastructure. Track identities rather than helper calls.
  const trackingCanvas=canvases.find(c=>c.ops.some(op=>op[0]==='drawImage' && op[1]==='tracking'));
  assert.ok(trackingCanvas);
  assert.ok(!maps[0].ops.some(op=>op[0]==='drawImage' && op[1]==='tracking'));
  assert.ok(maps[1].ops.some(op=>op[0]==='drawImage' && op[1]==='tracking'));
  assert.ok(maps[0].ops.some(op=>op[0]==='drawImage' && op[1]==='radar'));
});

test('map timestamps only accept explicit timezone-qualified source times',()=>{
  const {api}=harness();assert.equal(api.sourceTimeText('latest'),'');
  assert.equal(api.sourceTimeText('2026-10-06T18:32:00'),'');
  assert.match(api.sourceTimeText('2026-10-06T08:32:00Z'),/18:32.*AEST/);
});



test('real source times appear only on products containing that source',async()=>{
  const {api,canvases}=harness({radarTime:'2026-10-06T08:32:00Z',warningTime:'2026-10-06T08:25:00Z'});
  const profile={key:'thunderstorm',supportsTracking:false,renderSublayerTitles:['warning'],label:'Severe Thunderstorm',outputTitle:'Severe Thunderstorm Warning'};
  await api.buildProducts([150,-28,152,-26],true,{lga:boundary,outagesNorm:[],roadsNorm:[]},[],profile,null,boundary);
  const maps=canvases.filter(c=>c.ops.some(op=>op[0]==='translate'));
  const text=maps.map(c=>c.ops.filter(op=>op[0]==='fillText').map(op=>op[1]).join('\n'));
  assert.match(text[0],/Radar observation:.*18:32/);
  assert.match(text[0],/Warning issued:.*18:25/);
  assert.match(text[1],/Warning issued:.*18:25/);
  assert.doesNotMatch(text[1],/Radar observation:/);
  assert.doesNotMatch(text.join('\n'),/not supplied/);
});
