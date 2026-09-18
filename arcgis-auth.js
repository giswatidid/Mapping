const cfg = window.MAPPING_CONFIG?.arcgis || {};
const ORG_KEY = "mapping.arcgis.orgPrefix";
const LAYER_KEY = "mapping.arcgis.layers.";

const q = (s) => document.querySelector(s);
const ui = {
  gate:q("#loginGate"), shell:q("#appShell"), form:q("#arcgisLoginForm"), org:q("#orgPrefix"),
  login:q("#arcgisLoginButton"), status:q("#loginStatus"), user:q("#arcgisAccountName"), host:q("#arcgisAccountOrg"),
  signOut:q("#arcgisSignOut"), warning:q("#warningLayerSelection"), radar:q("#radarLayerSelection"),
  chooseWarning:q("#chooseWarningLayer"), chooseRadar:q("#chooseRadarLayer"), clearWarning:q("#clearWarningLayer"), clearRadar:q("#clearRadarLayer"),
  backdrop:q("#layerPickerBackdrop"), pickerTitle:q("#layerPickerTitle"), close:q("#layerPickerClose"),
  searchForm:q("#layerSearchForm"), search:q("#layerSearchQuery"), searchStatus:q("#layerSearchStatus"), results:q("#layerSearchResults")
};

let esriId, OAuthInfo, Portal, portal, portalUrl, target;
const getLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setLocal = (k,v) => { try { localStorage.setItem(k,v); } catch {} };
const prefix = (v) => String(v || "").trim().toLowerCase();
const validPrefix = (v) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(v);

function authStatus(message="", type="info") {
  ui.status.textContent = message;
  ui.status.className = "auth-status " + type;
  ui.status.hidden = !message;
}

function showLogin(message="", type="info") {
  ui.gate.hidden = false;
  ui.shell.hidden = true;
  const saved = prefix(getLocal(ORG_KEY));
  if (validPrefix(saved)) ui.org.value = saved;
  ui.login.disabled = false;
  ui.login.textContent = "Continue with ArcGIS";
  authStatus(message, type);
}

function layerKey() { return LAYER_KEY + prefix(getLocal(ORG_KEY)); }
function layers() { try { return JSON.parse(getLocal(layerKey()) || "{}") || {}; } catch { return {}; } }
function saveLayers(value) { setLocal(layerKey(), JSON.stringify(value)); }
function label(item) { return item ? item.title + (item.type ? " · " + item.type : "") : "Not selected"; }
function renderLayers() {
  const saved = layers();
  ui.warning.textContent = label(saved.warning);
  ui.radar.textContent = label(saved.radar);
  ui.warning.classList.toggle("configured", !!saved.warning);
  ui.radar.classList.toggle("configured", !!saved.radar);
  ui.clearWarning.disabled = !saved.warning;
  ui.clearRadar.disabled = !saved.radar;
}

function clearLayer(name) {
  const saved = layers(); delete saved[name]; saveLayers(saved); renderLayers();
}

function openPicker(name) {
  target = name;
  ui.pickerTitle.textContent = name === "warning" ? "Choose warning layer" : "Choose radar layer";
  ui.search.value = ""; ui.results.innerHTML = "";
  ui.searchStatus.textContent = "Search layer/service items available to your signed-in account.";
  ui.backdrop.hidden = false; document.body.classList.add("modal-open"); ui.search.focus();
}
function closePicker() { target = null; ui.backdrop.hidden = true; document.body.classList.remove("modal-open"); }

function selectItem(item) {
  const saved = layers();
  saved[target] = { itemId:item.id, title:item.title || item.id, type:item.type || null, serviceUrl:item.url || null, selectedAt:new Date().toISOString() };
  saveLayers(saved); renderLayers(); closePicker();
}

function showResults(items) {
  ui.results.innerHTML = "";
  ui.searchStatus.textContent = items.length ? items.length + " accessible item" + (items.length===1 ? "" : "s") + " found." : "No matching accessible layer/service items found.";
  items.forEach((item) => {
    const b = document.createElement("button"); b.type="button"; b.className="layer-result";
    const strong=document.createElement("strong"); strong.textContent=item.title || item.id;
    const meta=document.createElement("span"); meta.textContent=[item.type,item.owner ? "owner: " + item.owner : null,item.access].filter(Boolean).join(" · ");
    b.append(strong,meta); b.addEventListener("click",()=>selectItem(item)); ui.results.appendChild(b);
  });
}

async function searchLayers(text) {
  const types='(type:"Feature Service" OR type:"Map Service" OR type:"Image Service" OR type:"WMS" OR type:"WMTS")';
  const query=text.trim() ? "(" + text.trim() + ") AND " + types : types;
  const result=await portal.queryItems({query,num:100,sortField:"modified",sortOrder:"desc"});
  return result.results || [];
}

function configure(prefixValue) {
  portalUrl="https://" + prefixValue + ".maps.arcgis.com";
  esriId.registerOAuthInfos([new OAuthInfo({appId:cfg.clientId,portalUrl,flowType:"authorization-code",popup:false,preserveUrlHash:true})]);
}

async function showApp() {
  portal=new Portal({url:portalUrl,authMode:"immediate"}); await portal.load();
  ui.gate.hidden=true; ui.shell.hidden=false;
  ui.user.textContent=portal.user?.fullName || portal.user?.username || "ArcGIS user";
  ui.host.textContent=prefix(getLocal(ORG_KEY))+".maps.arcgis.com"; renderLayers();
}

async function startLogin(value) {
  const org=prefix(value);
  if (!validPrefix(org)) return authStatus("Enter only the organisation prefix, without https://, dots, slashes or a path.","error");
  if (!cfg.clientId) return authStatus("ArcGIS OAuth is not configured for this site.","error");
  setLocal(ORG_KEY,org); ui.login.disabled=true; ui.login.textContent="Opening ArcGIS…";
  configure(org); await esriId.getCredential(portalUrl+"/sharing"); await showApp();
}

async function init() {
  [OAuthInfo,esriId,Portal]=await $arcgis.import(["@arcgis/core/identity/OAuthInfo.js","@arcgis/core/identity/IdentityManager.js","@arcgis/core/portal/Portal.js"]);
  ui.form.addEventListener("submit",e=>{e.preventDefault();startLogin(ui.org.value).catch(err=>showLogin("ArcGIS sign-in failed: " + (err.message || err),"error"));});
  ui.signOut.addEventListener("click",()=>{esriId.destroyCredentials();portal=null;showLogin("Signed out of this application. Your organisation SSO session may remain active in the browser.");});
  ui.chooseWarning.addEventListener("click",()=>openPicker("warning")); ui.chooseRadar.addEventListener("click",()=>openPicker("radar"));
  ui.clearWarning.addEventListener("click",()=>clearLayer("warning")); ui.clearRadar.addEventListener("click",()=>clearLayer("radar"));
  ui.close.addEventListener("click",closePicker); ui.backdrop.addEventListener("click",e=>{if(e.target===ui.backdrop)closePicker();});
  ui.searchForm.addEventListener("submit",async e=>{e.preventDefault();ui.searchStatus.textContent="Searching accessible ArcGIS content…";ui.results.innerHTML="";try{showResults(await searchLayers(ui.search.value));}catch(err){ui.searchStatus.textContent="ArcGIS search failed: " + (err.message || err);}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!ui.backdrop.hidden)closePicker();});

  const org=prefix(getLocal(ORG_KEY));
  if (!validPrefix(org)) return showLogin();
  try { configure(org); await esriId.checkSignInStatus(portalUrl+"/sharing"); await showApp(); }
  catch { showLogin(); }
}

init().catch(err=>showLogin("ArcGIS authentication could not initialise: " + (err.message || err),"error"));
