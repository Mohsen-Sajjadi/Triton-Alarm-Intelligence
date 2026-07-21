const state={sites:[],alarms:[],allAlarms:[],issues:[],selectedSite:"",priority:"",alarmMode:"active",editingSite:null,lastSync:null};
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const views={overview:["OPERATIONS","Command center"],alarms:["OPERATIONS","Alarm queue"],insights:["ANALYSIS","Alarm insights"],work:["SERVICE DELIVERY","Service work"],integrations:["CONFIGURATION","Integrations"]};

document.addEventListener("DOMContentLoaded",()=>{initializeHelp();bindEvents();loadEverything();});

const helpContent={
  "Command center":"A live summary of portfolio risk. Start here to see critical alarms, active service work, site connection health, and recent alarm activity.",
  "Good day":"A live summary of portfolio risk. Start here to see critical alarms, active service work, site connection health, and recent alarm activity.",
  "Needs attention now":"The highest-priority active alarms selected by each site’s attention policy. Select an alarm to review details and take action.",
  "Site health":"Shows whether each integration is enabled, polling automatically, or needs a connection check.",
  "Alarm activity":"Shows how many alarms occurred during each hour of the last 24 hours. Hover over a bar to see the count.",
  "Alarm queue":"Search, filter, and review alarm records. Select any row to analyze the alarm, create service work, or mark it returned to normal.",
  "Alarm insights":"Highlights repeat alarms, noisy assets, and equipment with the lowest calculated health score.",
  "Most frequent alarms":"Ranks the alarms that occurred most often during the selected reporting period.",
  "Chattering alarms":"Finds alarms that repeated at least three times and may need tuning or root-cause investigation.",
  "Lowest equipment health":"Ranks equipment using alarm frequency and severity. Lower scores indicate greater operational risk.",
  "Service work":"Tracks work created from alarms through Open, In Progress, Resolved, and Closed stages.",
  "Integrations":"Configure EBO and SmartConnector sites, test connectivity, manage polling, and run alarm synchronization."
};

function initializeHelp(){
  const popover=document.createElement("div");popover.id="helpPopover";popover.className="help-popover hidden";popover.setAttribute("role","tooltip");document.body.appendChild(popover);
  $$("h2, .card-head h3").forEach(heading=>{const text=heading.textContent.trim(),help=helpContent[text];if(!help)return;const wrapper=document.createElement("span");wrapper.className="heading-with-help";heading.parentNode.insertBefore(wrapper,heading);wrapper.appendChild(heading);const button=document.createElement("button");button.type="button";button.className="help-button";button.textContent="?";button.setAttribute("aria-label",`Help for ${text}`);button.dataset.help=help;wrapper.appendChild(button);});
  document.addEventListener("click",event=>{const button=event.target.closest(".help-button");if(button){event.stopPropagation();showHelp(button,popover);return;}popover.classList.add("hidden");});
  document.addEventListener("keydown",event=>{if(event.key==="Escape")popover.classList.add("hidden");});
  window.addEventListener("resize",()=>popover.classList.add("hidden"));
}

function showHelp(button,popover){
  if(popover.dataset.owner===button.getAttribute("aria-label")&&!popover.classList.contains("hidden")){popover.classList.add("hidden");return;}
  popover.textContent=button.dataset.help;popover.dataset.owner=button.getAttribute("aria-label");popover.classList.remove("hidden");const rect=button.getBoundingClientRect(),width=Math.min(310,window.innerWidth-24);popover.style.width=`${width}px`;let left=Math.min(rect.left,window.innerWidth-width-12);left=Math.max(12,left);popover.style.left=`${left}px`;popover.style.top=`${Math.min(rect.bottom+8,window.innerHeight-popover.offsetHeight-12)}px`;
}

function bindEvents(){
  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>openView(b.dataset.view)));
  $$("[data-jump]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.filter){state.priority=b.dataset.filter;syncPriorityChips();}openView(b.dataset.jump);}));
  $("#globalSite").addEventListener("change",e=>{state.selectedSite=e.target.value;renderAll();loadInsights();});
  $("#refreshButton").addEventListener("click",loadEverything);
  $("#syncButton").addEventListener("click",syncAlarms);
  $("#alarmSearch").addEventListener("input",renderAlarmTable);
  $("#alarmState").addEventListener("change",async e=>{state.alarmMode=e.target.value;await loadAlarms();renderAll();});
  $("#priorityChips").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;state.priority=b.dataset.priority;syncPriorityChips();renderAlarmTable();});
  $("#insightRange").addEventListener("change",loadInsights);
  $("#closeDrawer").addEventListener("click",closeDrawer);$("#drawerBackdrop").addEventListener("click",closeDrawer);
  $("#newSiteButton").addEventListener("click",()=>openSiteDialog());
  $$('[data-close-site-dialog]').forEach(button=>button.addEventListener("click",()=>$("#siteDialog").close()));
  $("#siteForm").addEventListener("submit",saveSite);
  $("#deleteSiteButton").addEventListener("click",deleteSite);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDrawer();});
}

async function request(path,options={}){const response=await fetch(path,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);return data;}

async function loadEverything(){
  setBusy($("#refreshButton"),true);clearNotice();
  const results=await Promise.allSettled([request("/api/health"),request("/api/sites"),request("/api/alarms/active?limit=1000"),request("/api/alarms?limit=500"),request("/api/service-issues")]);
  if(results[0].status==="fulfilled")setBridge(results[0].value);else setBridge(null);
  if(results[1].status==="fulfilled")state.sites=results[1].value;
  if(results[2].status==="fulfilled")state.alarms=results[2].value;
  if(results[3].status==="fulfilled")state.allAlarms=results[3].value;
  if(results[4].status==="fulfilled")state.issues=results[4].value;
  const failures=results.filter(r=>r.status==="rejected");if(failures.length)notify(`${failures.length} data source${failures.length>1?"s":""} could not be loaded. ${failures[0].reason.message}`,true);
  state.lastSync=new Date();populateSites();renderAll();loadInsights();setBusy($("#refreshButton"),false);
}

async function loadAlarms(){
  const suffix=state.selectedSite?`?siteId=${encodeURIComponent(state.selectedSite)}&limit=1000`:"?limit=1000";
  const path=state.alarmMode==="history"?"/api/alarms/history":state.alarmMode==="attention"?"/api/alarms/attention":state.alarmMode==="all"?"/api/alarms":"/api/alarms/active";
  try{const data=await request(path+suffix);if(state.alarmMode==="active")state.alarms=data;else state.allAlarms=data;}catch(e){notify(e.message,true);}
}

function setBridge(health){const ok=!!health;$("#bridgeDot").className=`status-dot ${ok?"ok":"error"}`;$("#bridgeLabel").textContent=ok?"Bridge online":"Bridge unavailable";$("#bridgeTime").textContent=ok?`Checked ${formatTime(health.time)}`:"Check the server";}
function openView(name){if(!views[name])return;$$(".view").forEach(v=>v.classList.remove("active"));$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$("#view-"+name).classList.add("active");$("#pageEyebrow").textContent=views[name][0];$("#pageTitle").textContent=views[name][1];history.replaceState(null,"",`#${name}`);if(name==="insights")loadInsights();}
function populateSites(){const picker=$("#globalSite"),value=state.selectedSite;picker.innerHTML=`<option value="">All sites</option>`+state.sites.map(s=>`<option value="${esc(s.siteId)}">${esc(s.clientName)} · ${esc(s.siteName)}</option>`).join("");picker.value=value;}
function scopedAlarms(){return state.alarms.filter(a=>!state.selectedSite||a.siteId===state.selectedSite);}
function scopedIssues(){return state.issues.filter(i=>!state.selectedSite||state.sites.find(s=>s.siteId===state.selectedSite&&s.siteName===i.siteName));}
function renderAll(){renderOverview();renderAlarmTable();renderWork();renderIntegrations();}

function renderOverview(){
  const alarms=scopedAlarms(),issues=scopedIssues().filter(i=>!["Resolved","Closed"].includes(i.status));
  const count=p=>alarms.filter(a=>(a.actionPriority||a.priority)===p).length;
  $("#metricCritical").textContent=count("Critical");$("#metricHigh").textContent=count("High");$("#metricActive").textContent=alarms.length;$("#metricIssues").textContent=issues.length;
  $("#navAlarmCount").textContent=alarms.filter(a=>a.needsAttention).length;$("#navIssueCount").textContent=issues.length;
  $("#lastUpdated").textContent=state.lastSync?formatRelative(state.lastSync):"—";
  const hour=new Date().getHours();$("#greeting").textContent=hour<12?"Good morning":hour<18?"Good afternoon":"Good evening";
  const attention=[...alarms].filter(a=>a.needsAttention).sort(prioritySort).slice(0,6);
  $("#attentionList").innerHTML=attention.length?attention.map(a=>`<div class="alarm-item" data-alarm="${esc(a._id)}"><i class="priority-line ${esc(a.actionPriority)}"></i><div><div class="alarm-name">${esc(a.alarmName)}</div><div class="alarm-sub">${esc(a.equipmentName||"Unknown equipment")} · ${esc(a.siteName)}</div></div><span class="age">${formatRelative(a.occurredAt)}</span></div>`).join(""):`<div class="empty">No alarms currently require attention.</div>`;
  $$("[data-alarm]",$("#attentionList")).forEach(el=>el.addEventListener("click",()=>openAlarm(el.dataset.alarm)));
  const sites=state.sites.filter(s=>!state.selectedSite||s.siteId===state.selectedSite);
  $("#siteHealth").innerHTML=sites.length?sites.slice(0,7).map(s=>`<div class="site-row"><div><strong>${esc(s.siteName)}</strong><small>${esc(s.clientName)} · ${Number(s.lastAlarmCount||0)} last reported</small></div><span class="health-pill ${s.lastAlarmPollOk===false?"error":""}">${s.lastAlarmPollOk===false?"Needs check":s.pollingEnabled?"Polling":"Manual"}</span></div>`).join(""):`<div class="empty">No sites configured.</div>`;
  const buckets=Array(24).fill(0);state.allAlarms.filter(a=>!state.selectedSite||a.siteId===state.selectedSite).forEach(a=>{const d=new Date(a.occurredAt);if(Date.now()-d<86400000)buckets[d.getHours()]++;});const max=Math.max(...buckets,1);$("#activityChart").innerHTML=buckets.map((n,h)=>`<i class="bar" style="height:${Math.max(3,n/max*100)}%" data-count="${n} at ${String(h).padStart(2,"0")}:00"></i>`).join("");
}

function renderAlarmTable(){
  const source=state.alarmMode==="active"?state.alarms:state.allAlarms;const search=$("#alarmSearch").value.trim().toLowerCase();
  const scoped=source.filter(a=>(!state.selectedSite||a.siteId===state.selectedSite)&&(!state.priority||(a.actionPriority||a.priority)===state.priority)&&(!search||[a.alarmName,a.equipmentName,a.siteName,a.clientName,a.message].join(" ").toLowerCase().includes(search))).sort(prioritySort);
  const counts=scopedAlarms().reduce((o,a)=>{const p=a.actionPriority||a.priority;o[p]=(o[p]||0)+1;return o;},{});$("#chipAll").textContent=scopedAlarms().length;$("#chipCritical").textContent=counts.Critical||0;$("#chipHigh").textContent=counts.High||0;$("#chipElevated").textContent=counts.Elevated||0;
  $("#alarmRows").innerHTML=scoped.map(a=>`<tr data-id="${esc(a._id)}"><td><span class="badge ${esc(a.actionPriority||a.priority)}">${esc(a.actionPriority||a.priority||"Normal")}</span></td><td class="alarm-cell"><strong>${esc(a.alarmName)}</strong><small>${esc(a.equipmentName||"Unknown equipment")} · ${esc(a.message||"")}</small></td><td>${esc(a.siteName)}</td><td><span class="badge ${esc(a.state)}">${esc(prettyState(a.state))}</span></td><td>${formatRelative(a.occurredAt)}</td><td>${a.serviceIssueCreated?`<span class="service-link">${esc(a.serviceIssueStatus||"Created")}</span>`:"—"}</td><td>›</td></tr>`).join("");
  $("#alarmEmpty").classList.toggle("hidden",scoped.length>0);$$("tr[data-id]",$("#alarmRows")).forEach(row=>row.addEventListener("click",()=>openAlarm(row.dataset.id)));
}
function syncPriorityChips(){$$("#priorityChips button").forEach(b=>b.classList.toggle("active",b.dataset.priority===state.priority));}

function openAlarm(id){const alarm=[...state.alarms,...state.allAlarms].find(a=>a._id===id);if(!alarm)return;$("#drawerTitle").textContent=alarm.alarmName;$("#drawerBody").innerHTML=`
  <div class="detail-priority"><span class="badge ${esc(alarm.actionPriority||alarm.priority)}">${esc(alarm.actionPriority||alarm.priority||"Normal")} priority</span> <span class="badge ${esc(alarm.state)}">${esc(prettyState(alarm.state))}</span></div>
  <div class="detail-grid"><div><span>Site</span><strong>${esc(alarm.clientName)} · ${esc(alarm.siteName)}</strong></div><div><span>Equipment</span><strong>${esc(alarm.equipmentName||"Unknown")}</strong></div><div><span>Category</span><strong>${esc(alarm.category||"Unknown")}</strong></div><div><span>Occurred</span><strong>${formatDate(alarm.occurredAt)}</strong></div><div><span>Source</span><strong>${esc(alarm.sourceSystem||"Schneider EBO")}</strong></div><div><span>Acknowledged</span><strong>${alarm.acknowledged?"Yes":"No"}</strong></div></div>
  <div class="message-box">${esc(alarm.message||"No alarm message supplied.")}</div>
  ${alarm.attentionReason?.length?`<div class="drawer-section"><h3>Why this needs attention</h3><div class="ai-output">${alarm.attentionReason.map(esc).join("<br>")}</div></div>`:""}
  <div class="drawer-section"><h3>Recommended next step</h3><p class="muted">Generate an analysis using current alarm context, or create service work for technician follow-up.</p><div class="drawer-actions"><button class="button primary" id="analyzeButton">Analyze alarm</button><button class="button ghost" id="ticketButton" ${alarm.serviceIssueCreated?"disabled":""}>${alarm.serviceIssueCreated?"Service work created":"Create service work"}</button>${["Active","Acknowledged"].includes(alarm.state)?`<button class="button ghost" id="rtnButton">Mark returned to normal</button>`:""}</div><div id="analysisOutput"></div></div>`;
  $("#alarmDrawer").classList.add("open");$("#alarmDrawer").setAttribute("aria-hidden","false");$("#drawerBackdrop").classList.remove("hidden");
  $("#analyzeButton").addEventListener("click",()=>analyzeAlarm(alarm));$("#ticketButton")?.addEventListener("click",()=>createTicket(alarm));$("#rtnButton")?.addEventListener("click",()=>returnToNormal(alarm));
}
function closeDrawer(){$("#alarmDrawer").classList.remove("open");$("#alarmDrawer").setAttribute("aria-hidden","true");$("#drawerBackdrop").classList.add("hidden");}
async function analyzeAlarm(alarm){const button=$("#analyzeButton");setBusy(button,true);try{const r=await request("/api/ai/analyze-alarm",{method:"POST",body:JSON.stringify({alarmId:alarm._id})});$("#analysisOutput").innerHTML=`<div class="ai-output"><strong>Likely cause</strong><br>${esc(r.likelyCause||"Not determined")}<br><br><strong>Recommended action</strong><br>${esc(r.recommendedAction||r.summary||"Review alarm at the equipment.")}<br><br><strong>Urgency:</strong> ${esc(r.urgency||"Review")}${r.confidence?` · <strong>Confidence:</strong> ${esc(r.confidence)}`:""}</div>`;}catch(e){notify(e.message,true);}finally{setBusy(button,false);}}
async function createTicket(alarm){const button=$("#ticketButton");setBusy(button,true);try{await request("/api/alarms/create-service-ticket",{method:"POST",body:JSON.stringify({alarmId:alarm._id,description:alarm.message})});notify("Service work created from this alarm.");await loadEverything();closeDrawer();openView("work");}catch(e){notify(e.message,true);setBusy(button,false);}}
async function returnToNormal(alarm){if(!confirm("Mark this alarm as returned to normal?"))return;try{await request(`/api/alarms/${alarm._id}/return-to-normal`,{method:"PATCH",body:"{}"});notify("Alarm marked returned to normal.");closeDrawer();await loadEverything();}catch(e){notify(e.message,true);}}

async function loadInsights(){const days=$("#insightRange").value;try{const [top,repeated,health]=await Promise.all([request(`/api/analytics/top-alarms?days=${days}`),request(`/api/analytics/repeated-alarms?days=${Math.min(Number(days),30)}&minimumCount=3`),request(`/api/analytics/equipment-health?days=${days}`)]);renderRanking($("#topAlarms"),top.slice(0,8),x=>x._id.alarmName,x=>`${x._id.siteName} · ${x._id.equipmentName||"Unknown equipment"}`,x=>`${x.count}×`);renderRanking($("#repeatAlarms"),repeated.slice(0,6),x=>x._id.alarmName,x=>`${x._id.siteName} · first ${formatRelative(x.first)}`,x=>`${x.count}×`);renderRanking($("#equipmentHealth"),health.slice(0,6),x=>x._id.equipmentName||"Unknown equipment",x=>`${x._id.siteName} · ${x.totalAlarms} alarms`,x=>`${Math.round(x.healthScore)}%`);}catch(e){[$("#topAlarms"),$("#repeatAlarms"),$("#equipmentHealth")].forEach(el=>el.innerHTML=`<div class="empty">Insights unavailable.</div>`);}}
function renderRanking(el,items,title,sub,value){el.innerHTML=items.length?items.map((x,i)=>`<div class="rank-row"><span class="rank-number">${String(i+1).padStart(2,"0")}</span><div><strong>${esc(title(x))}</strong><small>${esc(sub(x))}</small></div><span class="rank-value">${esc(value(x))}</span></div>`).join(""):`<div class="empty">Not enough alarm history yet.</div>`;}

function renderWork(){const statuses=["Open","In Progress","Resolved","Closed"];$("#workBoard").innerHTML=statuses.map(status=>{const items=scopedIssues().filter(i=>i.status===status);return `<section class="kanban-column"><div class="kanban-head"><span>${status}</span><span>${items.length}</span></div>${items.map(i=>`<article class="work-card"><div class="work-card-top"><span class="badge ${esc(i.priority)}">${esc(i.priority)}</span><button type="button" class="remove-work" data-remove-issue="${esc(i._id)}" aria-label="Remove ${esc(i.issueTitle)}" title="Remove service work">×</button></div><strong>${esc(i.issueTitle)}</strong><small>${esc(i.siteName)} · ${esc(i.equipmentName||"General")}</small><small>${i.assignedEngineer?`Assigned to ${esc(i.assignedEngineer)}`:"Unassigned"}</small><select data-issue="${esc(i._id)}" aria-label="Update status"><option value="">Move to…</option>${statuses.filter(s=>s!==status).map(s=>`<option>${s}</option>`).join("")}</select></article>`).join("")||`<div class="empty">No work</div>`}</section>`}).join("");$$(`select[data-issue]`,$("#workBoard")).forEach(s=>s.addEventListener("change",()=>updateIssue(s.dataset.issue,s.value)));$$(`[data-remove-issue]`,$("#workBoard")).forEach(button=>button.addEventListener("click",()=>removeIssue(button.dataset.removeIssue)));}
async function updateIssue(id,status){if(!status)return;try{await request(`/api/service-issues/${id}`,{method:"PATCH",body:JSON.stringify({status})});state.issues=await request("/api/service-issues");renderAll();notify(`Service work moved to ${status}.`);}catch(e){notify(e.message,true);}}
async function removeIssue(id){const issue=state.issues.find(item=>item._id===id);if(!issue||!confirm(`Remove service work “${issue.issueTitle}”?\n\nThe original alarm history will remain.`))return;try{await request(`/api/service-issues/${id}`,{method:"DELETE"});state.issues=state.issues.filter(item=>item._id!==id);renderAll();notify("Service work removed. The original alarm was preserved.");}catch(e){notify(e.message,true);}}

function renderIntegrations(){const sites=state.sites;$("#connectedSites").textContent=sites.filter(s=>s.enabled).length;$("#pollingSites").textContent=sites.filter(s=>s.pollingEnabled).length;$("#failedSites").textContent=sites.filter(s=>s.lastConnectionOk===false||s.lastAlarmPollOk===false).length;$("#integrationList").innerHTML=sites.length?sites.map(s=>`<article class="integration-item"><div><h3>${esc(s.siteName)}</h3><p>${esc(s.clientName)} · ${esc(s.siteId)}</p></div><div class="connection-state ${s.lastConnectionOk===false?"error":""}"><i></i>${s.lastConnectionOk===false?"Connection issue":s.enabled?"Enabled":"Disabled"}</div><div><strong>${esc(s.connectionType)}</strong><p>${s.pollingEnabled?`Every ${s.pollIntervalMinutes||5} min`:"Manual polling"}</p></div><div class="item-actions"><button class="button ghost" data-test-site="${esc(s.siteId)}">Test</button><button class="button ghost" data-edit-site="${esc(s.siteId)}">Edit</button></div></article>`).join(""):`<div class="empty card">No sites yet. Add your first EBO integration.</div>`;$$(`[data-edit-site]`,$("#integrationList")).forEach(b=>b.addEventListener("click",()=>openSiteDialog(state.sites.find(s=>s.siteId===b.dataset.editSite))));$$(`[data-test-site]`,$("#integrationList")).forEach(b=>b.addEventListener("click",()=>testSite(b)));}
async function testSite(button){setBusy(button,true);try{const r=await request(`/api/sites/${encodeURIComponent(button.dataset.testSite)}/test-connection`,{method:"POST",body:"{}"});notify(`Connection succeeded. ${r.alarmCount} alarm${r.alarmCount===1?"":"s"} available.`);state.sites=await request("/api/sites");renderIntegrations();}catch(e){notify(`Connection test failed: ${e.message}`,true);}finally{setBusy(button,false);}}
async function syncAlarms(){const button=$("#syncButton");setBusy(button,true);try{let result;if(state.selectedSite)result=await request(`/api/sites/${encodeURIComponent(state.selectedSite)}/fetch-alarms`,{method:"POST",body:"{}"});else result=await request("/api/sites/fetch-all-alarms",{method:"POST",body:"{}"});notify(`Sync complete. ${result.saved??result.fetched??0} alarms processed${result.returnedToNormal?`, ${result.returnedToNormal} returned to normal`:""}.`);await loadEverything();}catch(e){notify(`Sync failed: ${e.message}`,true);}finally{setBusy(button,false);}}

function openSiteDialog(site=null){state.editingSite=site;$("#siteDialogTitle").textContent=site?"Edit integration":"Add a site";$("#deleteSiteButton").classList.toggle("hidden",!site);const form=$("#siteForm");form.reset();if(site){for(const [key,value] of Object.entries(site)){const input=form.elements[key];if(!input)continue;if(input.type==="checkbox")input.checked=!!value;else if(key==="alarmPriorityFilter")input.value=(value||[]).join(", ");else input.value=value??"";}}else{form.elements.enabled.checked=true;form.elements.alarmEndpointPath.value="/alarms/active";form.elements.pollIntervalMinutes.value=5;form.elements.alarmPriorityFilter.value="Critical, High";}form.elements.siteId.disabled=!!site;$("#siteDialog").showModal();}
async function saveSite(e){e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form));data.enabled=form.elements.enabled.checked;data.pollingEnabled=form.elements.pollingEnabled.checked;data.pollIntervalMinutes=Number(data.pollIntervalMinutes||5);data.alarmPriorityFilter=data.alarmPriorityFilter.split(",").map(x=>x.trim()).filter(Boolean);const button=$("#saveSiteButton");setBusy(button,true);try{const path=state.editingSite?`/api/sites/${encodeURIComponent(state.editingSite.siteId)}`:"/api/sites";await request(path,{method:state.editingSite?"PATCH":"POST",body:JSON.stringify(data)});$("#siteDialog").close();notify(state.editingSite?"Integration updated.":"Site integration added.");state.sites=await request("/api/sites");populateSites();renderAll();}catch(e2){notify(e2.message,true);}finally{setBusy(button,false);}}
async function deleteSite(){if(!state.editingSite||!confirm(`Delete ${state.editingSite.siteName}? Stored alarm history will remain.`))return;try{await request(`/api/sites/${encodeURIComponent(state.editingSite.siteId)}`,{method:"DELETE"});$("#siteDialog").close();state.sites=await request("/api/sites");if(state.selectedSite===state.editingSite.siteId)state.selectedSite="";populateSites();renderAll();notify("Site integration deleted. Alarm history was preserved.");}catch(e){notify(e.message,true);}}

function prioritySort(a,b){const rank={Critical:0,High:1,Elevated:2,Normal:3};return (rank[a.actionPriority||a.priority]??4)-(rank[b.actionPriority||b.priority]??4)||new Date(b.occurredAt)-new Date(a.occurredAt);}
function prettyState(v){return v==="ReturnedToNormal"?"Returned to normal":v||"Unknown";}
function formatRelative(value){if(!value)return"—";const ms=Date.now()-new Date(value);if(ms<0)return"just now";const m=Math.floor(ms/60000);if(m<1)return"just now";if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;const d=Math.floor(h/24);return d<30?`${d}d ago`:new Date(value).toLocaleDateString();}
function formatDate(value){return value?new Date(value).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):"—";}
function formatTime(value){return value?new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):"—";}
function esc(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function setBusy(button,busy){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.textContent;button.textContent="Working…";}else if(button.dataset.label){button.textContent=button.dataset.label;delete button.dataset.label;}}
let noticeTimer;function notify(message,error=false){const n=$("#notice");n.textContent=message;n.className=`notice${error?" error":""}`;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.classList.add("hidden"),7000);}function clearNotice(){$("#notice").classList.add("hidden");}
