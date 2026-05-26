export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Agent Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b0d14; --surface:#12151e; --card:#181c2a; --card-hover:#1e2340;
  --border:#262b42; --border-accent:#343a60;
  --primary:#7c83ff; --primary-glow:rgba(124,131,255,.12);
  --success:#34d399; --warning:#fbbf24; --error:#f87171; --info:#60a5fa;
  --text:#e2e8f0; --text-secondary:#8892b0; --text-muted:#5a6488;
  --radius:8px; --radius-lg:12px;
  --font:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  --mono:SF Mono,JetBrains Mono,Fira Code,monospace;
  --shadow:0 1px 3px rgba(0,0,0,.3)
}
html{font-size:14px}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-accent);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:#4a5080}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:14px}
.topbar-title{font-size:1.15rem;font-weight:600;letter-spacing:-.02em;background:linear-gradient(135deg,#7c83ff,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.topbar-right{display:flex;align-items:center;gap:16px}
.connection-status{display:flex;align-items:center;gap:6px;font-size:.8rem}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;transition:box-shadow .3s}
.status-dot.connected{background:var(--success);box-shadow:0 0 8px rgba(52,211,153,.5)}
.status-dot.disconnected{background:var(--error);box-shadow:0 0 8px rgba(248,113,113,.4)}
.status-label{color:var(--text-secondary);font-size:.75rem;font-weight:500}
.port-label{color:var(--text-muted);font-size:.7rem;font-family:var(--mono)}
.summary-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:16px 24px}
.summary-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;transition:border-color .2s,box-shadow .2s}
.summary-card:hover{border-color:var(--border-accent);box-shadow:0 0 0 1px var(--primary-glow)}
.summary-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px}
.summary-value{font-size:1.5rem;font-weight:700;letter-spacing:-.03em}
.summary-value.green{color:var(--success)}.summary-value.amber{color:var(--warning)}
.summary-value.blue{color:var(--info)}.summary-value.purple{color:#a78bfa}
.dashboard-grid{display:grid;grid-template-columns:1fr 320px;gap:16px;padding:0 24px 24px}
@media(max-width:960px){.dashboard-grid{grid-template-columns:1fr}}
.main-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.side-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.section-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.015)}
.section-title{font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)}
.section-badge{font-size:.65rem;background:var(--primary-glow);color:var(--primary);padding:2px 8px;border-radius:10px;font-weight:600;font-family:var(--mono)}
.section-body{padding:12px 16px}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.agent-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;transition:border-color .2s,transform .15s;cursor:default}
.agent-card:hover{border-color:var(--border-accent);transform:translateY(-1px)}
.agent-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.agent-name{font-size:.82rem;font-weight:600;font-family:var(--mono);color:var(--text)}
.agent-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:box-shadow .3s}
.agent-status-dot.running{background:var(--success);box-shadow:0 0 6px rgba(52,211,153,.5)}
.agent-status-dot.idle{background:var(--warning);box-shadow:0 0 6px rgba(251,191,36,.4)}
.agent-status-dot.error{background:var(--error);box-shadow:0 0 6px rgba(248,113,113,.4)}
.agent-status-dot.waiting{background:var(--text-muted)}
.agent-task{font-size:.7rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
.agent-meta{display:flex;flex-wrap:wrap;gap:4px 8px;font-size:.65rem;color:var(--text-muted)}
.agent-meta span{white-space:nowrap}
.agent-model{color:var(--info)}
.task-table{width:100%;border-collapse:collapse;font-size:.72rem}
.task-table th{text-align:left;padding:6px 8px;font-weight:600;color:var(--text-muted);text-transform:uppercase;font-size:.65rem;letter-spacing:.05em;border-bottom:1px solid var(--border)}
.task-table td{padding:6px 8px;border-bottom:1px solid rgba(38,43,66,.5);vertical-align:middle}
.task-table tr:last-child td{border-bottom:none}
.task-table tr:hover td{background:rgba(124,131,255,.04)}
.task-id{font-family:var(--mono);font-size:.68rem;color:var(--primary)}
.task-agent{font-family:var(--mono);color:var(--text)}
.task-desc{color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.task-status{display:inline-flex;align-items:center;gap:4px;font-size:.65rem;font-weight:600;padding:2px 6px;border-radius:4px}
.task-status.created{background:rgba(96,165,250,.15);color:var(--info)}
.task-status.running{background:rgba(52,211,153,.15);color:var(--success)}
.task-status.completed{color:var(--text-muted)}
.task-status.error{background:rgba(248,113,113,.15);color:var(--error)}
.task-duration{font-family:var(--mono);font-size:.68rem;color:var(--text-muted)}
.task-expand{background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.75rem;padding:2px 4px;border-radius:3px;transition:color .15s,background .15s}
.task-expand:hover{color:var(--primary);background:var(--primary-glow)}
.task-detail{display:none;background:rgba(0,0,0,.15);border-radius:4px;padding:8px 10px;margin-top:4px;font-size:.68rem;color:var(--text-secondary);font-family:var(--mono);line-height:1.6}
.task-detail.open{display:block}
.team-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px}
.team-card:last-child{margin-bottom:0}
.team-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.team-name{font-size:.8rem;font-weight:600;color:var(--text)}
.team-members{display:flex;gap:4px;flex-wrap:wrap}
.team-member{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 6px;border-radius:4px;background:rgba(255,255,255,.04);font-size:.68rem;font-family:var(--mono);color:var(--text-secondary)}
.team-member-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.team-member-dot.active{background:var(--success)}
.team-member-dot.idle{background:var(--warning)}
.team-member-dot.blocked{background:var(--error)}
.team-member-dot.error{background:var(--error)}
.team-progress{margin-top:8px}
.team-progress-bar{height:4px;background:rgba(255,255,255,.05);border-radius:2px;overflow:hidden;margin-bottom:4px}
.team-progress-fill{height:100%;background:linear-gradient(90deg,var(--primary),#a78bfa);border-radius:2px;transition:width .5s ease}
.team-progress-text{font-size:.65rem;color:var(--text-muted);font-family:var(--mono)}
.timeline{max-height:420px;overflow-y:auto}
.timeline-item{display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid rgba(38,43,66,.3);min-height:28px}
.timeline-item:last-child{border-bottom:none}
.timeline-icon{width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:.7rem;flex-shrink:0;margin-top:1px}
.timeline-icon.task{background:rgba(96,165,250,.15)}
.timeline-icon.agent{background:rgba(52,211,153,.15)}
.timeline-icon.team{background:rgba(167,139,250,.15)}
.timeline-icon.error{background:rgba(248,113,113,.15)}
.timeline-content{flex:1;min-width:0}
.timeline-time{font-size:.6rem;color:var(--text-muted);font-family:var(--mono)}
.timeline-text{font-size:.7rem;color:var(--text-secondary);line-height:1.4}
.timeline-text strong{color:var(--text);font-weight:600}
.empty-state{text-align:center;padding:24px 16px;color:var(--text-muted);font-size:.78rem}
.empty-state-icon{font-size:1.5rem;margin-bottom:6px;opacity:.4}
@keyframes fadeSlideIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.fade-in{animation:fadeSlideIn .25s ease forwards}
@keyframes pulse{0%,100%{border-color:var(--border)}50%{border-color:var(--success);box-shadow:0 0 8px rgba(52,211,153,.25)}}
.agent-card.running{animation:pulse 2s ease-in-out infinite}
.agent-card.stalled{animation:pulse 2s ease-in-out infinite;border-color:var(--warning);box-shadow:0 0 8px rgba(251,191,36,.2)}
.loading{display:flex;align-items:center;justify-content:center;padding:40px;gap:8px;color:var(--text-muted)}
.spinner{width:16px;height:16px;border:2px solid var(--border-accent);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 24px 16px}
@media(max-width:960px){.analytics-grid{grid-template-columns:1fr}}
.analytics-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.analytics-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border)}
.analytics-body{padding:12px;min-height:100px}
.heatmap-canvas{width:100%;height:120px;border-radius:var(--radius)}
.chart-svg{width:100%;height:80px;overflow:visible}
.bar-label{font-size:.55rem;fill:var(--text-muted);font-family:var(--mono)}
.bar-value{font-size:.55rem;fill:var(--text-secondary);font-family:var(--mono)}
.chart-line{fill:none;stroke:var(--primary);stroke-width:1.5;stroke-linejoin:round}
.chart-area{fill:var(--primary-glow);stroke:none}
.heatmap-cell:hover{stroke:var(--text);stroke-width:.5}
.success-bar{fill:var(--success);opacity:.8}
.fail-bar{fill:var(--error);opacity:.8}
.success-bar:hover,.fail-bar:hover{opacity:1}
.cost-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.cost-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;text-align:center}
.cost-agent{font-size:.65rem;font-weight:600;color:var(--text-secondary);margin-bottom:2px}
.cost-tokens{font-size:.9rem;font-weight:700;color:var(--primary)}
.cost-usd{font-size:.7rem;color:var(--text-muted)}
.export-btn{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:4px;font-size:.65rem;font-weight:600;text-decoration:none;color:var(--text-secondary);background:var(--card);border:1px solid var(--border);transition:all .15s;cursor:pointer}
.export-btn:hover{color:var(--primary);border-color:var(--primary);background:var(--primary-glow)}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="2" width="16" height="16" rx="4" stroke="url(#g1)" stroke-width="1.5"/>
      <path d="M7 10L9 12L13 8" stroke="url(#g1)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <defs><linearGradient id="g1" x1="0" y1="0" x2="20" y2="20"><stop stop-color="#7c83ff"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
    </svg>
    <span class="topbar-title">Agent Dashboard</span>
  </div>
  <div class="topbar-right">
    <div class="connection-status">
      <span class="status-dot disconnected" id="statusDot"></span>
      <span class="status-label" id="statusLabel">Disconnected</span>
    </div>
    <span class="port-label" id="portLabel">—</span>
    <a href="/export/json" download class="export-btn" title="Export JSON">JSON</a>
    <a href="/export/csv" download class="export-btn" title="Export CSV">CSV</a>
  </div>
</div>

<div class="summary-bar" id="summaryBar">
  <div class="summary-card"><div class="summary-label">Agents Running</div><div class="summary-value green" id="sAgents">0</div></div>
  <div class="summary-card"><div class="summary-label">Tasks Queued</div><div class="summary-value amber" id="sQueued">0</div></div>
  <div class="summary-card"><div class="summary-label">Active Teams</div><div class="summary-value blue" id="sTeams">0</div></div>
  <div class="summary-card"><div class="summary-label">Uptime</div><div class="summary-value purple" id="sUptime">0s</div></div>
</div>

<div class="dashboard-grid">
  <div class="main-col">
    <div class="section">
      <div class="section-header">
        <span class="section-title">Active Agents</span>
        <span class="section-badge" id="agentBadge">0</span>
      </div>
      <div class="section-body" id="agentGrid"><div class="loading"><div class="spinner"></div><span>Waiting for connection...</span></div></div>
    </div>
    <div class="section">
      <div class="section-header">
        <span class="section-title">Tasks</span>
        <span class="section-badge" id="taskBadge">0</span>
      </div>
      <div class="section-body" id="taskBoard"><div class="loading"><div class="spinner"></div><span>Waiting for connection...</span></div></div>
    </div>
    <div class="section">
      <div class="section-header">
        <span class="section-title">Teams</span>
        <span class="section-badge" id="teamBadge">0</span>
      </div>
      <div class="section-body" id="teamView"><div class="empty-state"><div class="empty-state-icon">&#9678;</div>No teams active</div></div>
    </div>
  </div>
  <div class="side-col">
    <div class="section">
      <div class="section-header">
        <span class="section-title">Activity Timeline</span>
        <span class="section-badge" id="timelineBadge">0</span>
      </div>
      <div class="section-body timeline" id="timeline"><div class="empty-state"><div class="empty-state-icon">&#8987;</div>No activity yet</div></div>
    </div>
  </div>
</div>

<div class="analytics-grid" id="analyticsGrid">
  <div class="analytics-section">
    <div class="analytics-header"><span class="section-title">Agent Heatmap</span><span class="section-badge" style="font-size:.6rem">last 15 min</span></div>
    <div class="analytics-body"><canvas id="heatmapCanvas" class="heatmap-canvas" height="120"></canvas></div>
  </div>
  <div class="analytics-section">
    <div class="analytics-header"><span class="section-title">Task Duration</span><span class="section-badge" id="avgDuration" style="font-size:.6rem">&#8212;</span></div>
    <div class="analytics-body"><svg id="durationChart" class="chart-svg" viewBox="0 0 300 80"></svg></div>
  </div>
  <div class="analytics-section" style="grid-column:1/-1">
    <div class="analytics-header"><span class="section-title">Agent Success Rate</span><span class="section-badge" style="font-size:.6rem">last 24h</span></div>
    <div class="analytics-body"><svg id="successChart" class="chart-svg" viewBox="0 0 300 60"></svg></div>
  </div>
</div>
  <div class="analytics-section">
    <div class="analytics-header"><span class="section-title">Token Usage</span><span class="section-badge" id="totalCost" style="font-size:.6rem">—</span></div>
    <div class="analytics-body"><div class="cost-grid" id="costGrid"><div class="empty-state" style="padding:12px"><div class="empty-state-icon">⚡</div>Waiting for data...</div></div></div>
  </div>

<script>
(function() { 'use strict';
var state={agents:new Map(),tasks:new Map(),teams:new Map(),timeline:[],connected:false,port:null,summary:{agents:0,queued:0,teams:0,startTime:Date.now()}};
var ws=null,reconnectTimer=null,reconnectDelay=1000,pingInterval=null,uptimeInterval=null,renderScheduled=false;

function $(id){return document.getElementById(id);}
var dom={statusDot:$('statusDot'),statusLabel:$('statusLabel'),portLabel:$('portLabel'),sAgents:$('sAgents'),sQueued:$('sQueued'),sTeams:$('sTeams'),sUptime:$('sUptime'),agentGrid:$('agentGrid'),agentBadge:$('agentBadge'),taskBoard:$('taskBoard'),taskBadge:$('taskBadge'),teamView:$('teamView'),teamBadge:$('teamBadge'),timeline:$('timeline'),timelineBadge:$('timelineBadge')};

function fmtDuration(ms){if(!ms||ms<0)return'\u2014';var s=Math.floor(ms/1000);if(s<5)return'just now';if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s';var h=Math.floor(m/60);return h+'h '+(m%60)+'m';}
function fmtRelative(ts){var d=Date.now()-ts;if(d<2e3)return'just now';if(d<6e4)return Math.floor(d/1e3)+'s ago';var m=Math.floor(d/6e4);if(m<60)return m+'m ago';var h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m ago';return Math.floor(h/24)+'d ago';}
function fmtUptime(ms){var s=Math.floor(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s';var h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+h%24+'h';}
function shortId(id){return id&&id.length>8?id.slice(0,8):(id||'');}
function esc(s){var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}
function eventIcon(k){if(k.startsWith('task:'))return{cls:'task',icon:'\u25b7'};if(k.startsWith('agent:'))return{cls:'agent',icon:'\u25cf'};if(k.startsWith('team:'))return{cls:'team',icon:'\u25c6'};return{cls:'task',icon:'\u25cb'};}
function scheduleRender(){if(renderScheduled)return;renderScheduled=true;requestAnimationFrame(function(){renderScheduled=false;doRender();});}

function doRender(){
  dom.statusDot.className='status-dot '+(state.connected?'connected':'disconnected');
  dom.statusLabel.textContent=state.connected?'Connected':'Disconnected';
  var ra=0;state.agents.forEach(function(a){if(a.status==='running')ra++;});
  dom.sAgents.textContent=ra;dom.sQueued.textContent=state.summary.queued;
  dom.sTeams.textContent=state.teams.size;
  dom.sUptime.textContent=fmtUptime(Date.now()-state.summary.startTime);
  dom.agentBadge.textContent=state.agents.size;
  if(state.agents.size===0){dom.agentGrid.innerHTML='<div class="empty-state"><div class="empty-state-icon">\u25cf</div>No agents active</div>';}
  else{
    var h='<div class="agent-grid">',agents=[];state.agents.forEach(function(v){agents.push(v);});
    agents.sort(function(a,b){return((a.status==='running'?0:1)-(b.status==='running'?0:1));});
    for(var i=0;i<agents.length;i++){var a=agents[i];
      h+='<div class="agent-card fade-in'+(a.status==='running'||a.status==='stalled'?' '+a.status:'')+'"'><div class="agent-card-header"><span class="agent-name">'+esc(a.name)+'</span><span class="agent-status-dot '+a.status+'"></span></div>';
      h+='<div class="agent-task">'+esc(a.task||'Idle')+'</div><div class="agent-meta">';
      if(a.duration!=null)h+='<span>\u23f1 '+fmtDuration(a.duration)+'</span>';
      if(a.toolCalls!=null)h+='<span>\u26a1 '+a.toolCalls+' calls</span>';
      if(a.model)h+='<span class="agent-model">'+esc(a.model)+'</span>';
      h+='</div></div>';}
    h+='</div>';dom.agentGrid.innerHTML=h;
  }
  dom.taskBadge.textContent=state.tasks.size;
  if(state.tasks.size===0){dom.taskBoard.innerHTML='<div class="empty-state"><div class="empty-state-icon">\u25a1</div>No tasks</div>';}
  else{
    var h='<table class="task-table"><thead><tr><th>ID</th><th>Agent</th><th>Description</th><th>Status</th><th>Duration</th><th></th></tr></thead><tbody>';
    var tasks=[];state.tasks.forEach(function(v){tasks.push(v);});
    tasks.sort(function(a,b){return b.createdAt-a.createdAt;});
    for(var i=0;i<tasks.length;i++){var t=tasks[i];
      var sc=t.status==='error'?'error':t.status==='running'?'running':t.status==='completed'?'completed':'created';
      h+='<tr><td class="task-id">'+shortId(t.id)+'</td>';
      h+='<td class="task-agent">'+esc(t.agent||'\u2014')+'</td>';
      h+='<td class="task-desc" title="'+esc(t.description||'')+'">'+esc((t.description||'').slice(0,40))+'</td>';
      h+='<td><span class="task-status '+sc+'">'+t.status+'</span></td>';
      h+='<td class="task-duration">'+(t.status==='running'?fmtDuration(Date.now()-t.createdAt):fmtDuration(t.duration))+'</td>';
      h+='<td><button class="task-expand" onclick="toggleTask(this)" data-task="'+esc(t.id)+'">\u25b6</button></td></tr>';
      h+='<tr id="detail-'+esc(t.id)+'" style="display:none"><td colspan="6"><div class="task-detail open">'+esc(JSON.stringify(t.data||{},null,2))+'</div></td></tr>';}
    h+='</tbody></table>';dom.taskBoard.innerHTML=h;
  }
  dom.teamBadge.textContent=state.teams.size;
  if(state.teams.size===0){dom.teamView.innerHTML='<div class="empty-state"><div class="empty-state-icon">\u25ce</div>No teams active</div>';}
  else{
    var h='';state.teams.forEach(function(team){
      h+='<div class="team-card fade-in"><div class="team-header"><span class="team-name">'+esc(team.name)+'</span><span class="section-badge">'+shortId(team.id)+'</span></div><div class="team-members">';
      if(team.members){for(var j=0;j<team.members.length;j++){var m=team.members[j];var ms=(team.memberStatus&&team.memberStatus[m])?team.memberStatus[m]:'idle';
        h+='<span class="team-member"><span class="team-member-dot '+ms+'"></span>'+esc(m)+'</span>';}}
      h+='</div>';
      if(team.total>0){var pct=Math.round(team.completed/team.total*100);
        h+='<div class="team-progress"><div class="team-progress-bar"><div class="team-progress-fill" style="width:'+pct+'%"></div></div>';
        h+='<div class="team-progress-text">'+team.completed+'/'+team.total+' tasks ('+pct+'%)</div></div>';}
      h+='</div>';});
    dom.teamView.innerHTML=h;
  }
  dom.timelineBadge.textContent=state.timeline.length;
  if(state.timeline.length===0){dom.timeline.innerHTML='<div class="empty-state"><div class="empty-state-icon">\u231b</div>No activity yet</div>';}
  else{
    var h='',events=state.timeline.slice(-50).reverse();
    for(var i=0;i<events.length;i++){var ev=events[i],ei=eventIcon(ev.kind);
      h+='<div class="timeline-item fade-in"><div class="timeline-icon '+ei.cls+'">'+ei.icon+'</div><div class="timeline-content"><div class="timeline-time">'+fmtRelative(ev.timestamp)+'</div><div class="timeline-text">'+ev.html+'</div></div></div>';}
    dom.timeline.innerHTML=h;
  }
}

function handleEvent(event){
  var ts=event.timestamp||Date.now();
  function addTL(kind,agent,desc){state.timeline.push({kind:kind,timestamp:ts,html:(agent?'<strong>'+esc(agent)+'</strong> ':'')+esc(desc)});if(state.timeline.length>200)state.timeline.splice(0,state.timeline.length-200);}
  switch(event.kind){
    case'agent:spawned':var d=event.data;state.agents.set(d.agent,{name:d.agent,status:'running',task:'',model:d.model||'\u2014',toolCalls:0,duration:null,startTime:ts,sessionId:d.sessionId});addTL('agent:spawned',d.agent,'spawned \u2014 '+(d.model||'unknown model'));break;
    case'agent:activity':var d=event.data,a=state.agents.get(d.agent);if(a){a.toolCalls=(a.toolCalls||0)+1;a.task=d.toolName||'working...';}addTL('agent:activity',d.agent,'called '+(d.toolName||'tool'));break;
    case'agent:completed':var d=event.data,a=state.agents.get(d.agent);if(a){a.status='idle';a.duration=d.duration||(ts-a.startTime);a.task='Completed';}addTL('agent:completed',d.agent,'completed ('+fmtDuration(d.duration)+')');break;
    case'task:created':var d=event.data;state.tasks.set(d.taskId,{id:d.taskId,agent:d.agent,description:d.description,status:'created',duration:null,createdAt:ts,data:d});state.summary.queued++;addTL('task:created',d.agent,'task: '+(d.description||'').slice(0,60));break;
    case'task:progress':var d=event.data,t=state.tasks.get(d.taskId);if(t){t.status='running';t.data=t.data||{};t.data.toolCalls=d.toolCalls;t.data.currentAction=d.currentAction;if(d.currentAction){var a=state.agents.get(t.agent);if(a)a.task=d.currentAction;}}break;
    case'task:completed':var d=event.data,t=state.tasks.get(d.taskId);if(t){t.status='completed';t.duration=d.duration;}state.summary.queued=Math.max(0,state.summary.queued-1);addTL('task:completed',t?t.agent:'','task completed');break;
    case'task:error':var d=event.data,t=state.tasks.get(d.taskId);if(t){t.status='error';t.duration=d.duration;t.data=t.data||{};t.data.error=d.error;}state.summary.queued=Math.max(0,state.summary.queued-1);addTL('error',t?t.agent:'','error: '+(d.error||'').slice(0,80));break;
    case'team:created':var d=event.data;state.teams.set(d.teamId,{id:d.teamId,name:d.name,members:d.members||[],memberStatus:{},completed:0,total:0});addTL('team:created','','team "'+d.name+'" created');break;
    case'team:member:status':var d=event.data,tm=state.teams.get(d.teamId);if(tm){tm.memberStatus=tm.memberStatus||{};tm.memberStatus[d.member]=d.status;}addTL('team:member:status',d.member,'status: '+d.status);break;
    case'team:task:progress':var d=event.data,tm=state.teams.get(d.teamId);if(tm){tm.completed=d.completed;tm.total=d.total;}break;
  }
  scheduleRender();
}

function handleSnapshot(snapshot){if(snapshot){state.summary.queued=snapshot.queued||0;state.summary.agents=snapshot.running||0;state.summary.startTime=Date.now();if(snapshot.analytics){renderHeatmap(snapshot.analytics.heatmap);renderDurationChart(snapshot.analytics.recentDurations);renderSuccessChart(snapshot.analytics.successRate);if(snapshot.analytics.costEstimate)renderCostTracker(snapshot.analytics.costEstimate);var avgDur=snapshot.analytics.summary.avgDurationMs;var avgEl=$('#avgDuration');if(avgEl)avgEl.textContent=avgDur>0?(avgDur/1000).toFixed(1)+'s avg':'—';}}scheduleRender();}

function connect(){
  if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
  var p=window.location.protocol==='https:'?'wss:':'ws:',h=window.location.host;
  state.port=h.split(':')[1]||'80';dom.portLabel.textContent=':'+state.port;
  try{ws=new WebSocket(p+'//'+h+'/ws');}catch(e){scheduleRender();scheduleReconnect();return;}
  ws.onopen=function(){state.connected=true;reconnectDelay=1000;scheduleRender();if(pingInterval)clearInterval(pingInterval);pingInterval=setInterval(function(){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'ping'}));},25000);};
  ws.onclose=function(){state.connected=false;if(pingInterval){clearInterval(pingInterval);pingInterval=null;}scheduleRender();scheduleReconnect();};
  ws.onerror=function(){state.connected=false;scheduleRender();};
  ws.onmessage=function(ev){try{var msg=JSON.parse(ev.data);if(msg.type==='snapshot')handleSnapshot(msg.snapshot);else if(msg.type==='event'&&msg.data)handleEvent(msg.data);}catch(e){}};
}

function scheduleReconnect(){if(reconnectTimer)clearTimeout(reconnectTimer);if(state.connected)return;reconnectTimer=setTimeout(function(){if(!state.connected){reconnectDelay=Math.min(reconnectDelay*2,30000);connect();}},reconnectDelay);}

window.toggleTask=function(btn){var id=btn.getAttribute('data-task'),row=document.getElementById('detail-'+id);if(row)row.style.display=row.style.display==='none'?'':'none';};

function renderHeatmap(cells) {
  var canvas = document.getElementById('heatmapCanvas');
  if (!canvas || !cells || cells.length === 0) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.width = canvas.offsetWidth * 2;
  var H = 120 * 2;
  ctx.clearRect(0, 0, W, H);
  
  var agents = {}, maxCount = 1;
  cells.forEach(function(c) {
    if (!agents[c.agentName]) agents[c.agentName] = [];
    agents[c.agentName].push(c);
    if (c.eventCount > maxCount) maxCount = c.eventCount;
  });
  
  var names = Object.keys(agents);
  var now = Date.now();
  var cellW = Math.max(4, (W - 60) / 15);
  var cellH = Math.min(24, (H - 20) / Math.max(names.length, 1));
  var padL = 50, padT = 10;
  
  names.forEach(function(name, i) {
    ctx.fillStyle = '#8892b0';
    ctx.font = '9px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(name, 0, padT + i * cellH + cellH/2 + 3);
    
    for (var m = 0; m < 15; m++) {
      var bucketStart = now - (14 - m) * 60000;
      var bucketEnd = bucketStart + 60000;
      var count = 0;
      (agents[name]).forEach(function(c) {
        if (c.timeBucket >= bucketStart && c.timeBucket < bucketEnd) {
          count += c.eventCount;
        }
      });
      var intensity = Math.min(1, count / Math.max(maxCount, 1));
      var r = Math.round(124 + (130 - 124) * intensity);
      var g = Math.round(131 + (100 - 131) * (1 - intensity));
      var b = Math.round(255 + (255 - 255) * intensity);
      ctx.fillStyle = count > 0 ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(38,43,66,.3)';
      ctx.fillRect(padL + m * (cellW + 1), padT + i * cellH, cellW, cellH - 2);
    }
  });
}

function renderDurationChart(samples) {
  var svg = document.getElementById('durationChart');
  if (!svg || !samples || samples.length < 2) {
    if (svg) svg.innerHTML = '<text x="150" y="40" text-anchor="middle" fill="#5a6488" font-size="10">Waiting for data...</text>';
    return;
  }
  
  var W = 300, H = 80;
  var recent = samples.slice(-20);
  var maxDur = 1;
  recent.forEach(function(s) { if (s.durationMs > maxDur) maxDur = s.durationMs; });
  
  var padL = 25, padR = 5, padT = 5, padB = 15;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;
  
  var points = recent.map(function(s, i) {
    var x = padL + (i / Math.max(recent.length - 1, 1)) * chartW;
    var y = padT + chartH - (s.durationMs / maxDur) * chartH;
    return x + ',' + y;
  });
  
  var polyPoints = padL + ',' + (padT + chartH) + ' ' + points.join(' ') + ' ' + (padL + chartW) + ',' + (padT + chartH);
  
  var html = '<polygon class="chart-area" points="' + polyPoints + '"/>';
  html += '<polyline class="chart-line" points="' + points.join(' ') + '"/>';
  
  html += '<text class="bar-label" x="0" y="' + (padT + chartH) + '">0</text>';
  html += '<text class="bar-label" x="0" y="' + (padT + 5) + '">' + (maxDur > 1000 ? (maxDur/1000).toFixed(0) + 's' : maxDur.toFixed(0) + 'ms') + '</text>';
  
  svg.innerHTML = html;
}

function renderSuccessChart(rates) {
  var svg = document.getElementById('successChart');
  if (!svg || !rates || rates.length === 0) {
    if (svg) svg.innerHTML = '<text x="150" y="30" text-anchor="middle" fill="#5a6488" font-size="10">Waiting for data...</text>';
    return;
  }
  
  var W = 300, H = 60;
  var padL = 40, padR = 10, padT = 5, padB = 20;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;
  var barW = Math.min(24, chartW / rates.length - 4);
  
  var html = '';
  rates.forEach(function(r, i) {
    var x = padL + (i / rates.length) * chartW + (chartW / rates.length - barW) / 2;
    var succH = r.rate * chartH;
    var failH = (1 - r.rate) * chartH;
    
    var succY = padT + chartH - succH;
    html += '<rect class="success-bar" x="' + x + '" y="' + succY + '" width="' + (barW/2-1) + '" height="' + Math.max(succH, 1) + '" rx="2"/>';
    var failY = padT + chartH - failH;
    html += '<rect class="fail-bar" x="' + (x + barW/2 + 1) + '" y="' + failY + '" width="' + (barW/2-1) + '" height="' + Math.max(failH, 1) + '" rx="2"/>';
    
    html += '<text class="bar-label" x="' + (x + barW/2) + '" y="' + (padT + chartH + 12) + '" text-anchor="middle">' + r.agent.substring(0, 6) + '</text>';
    html += '<text class="bar-value" x="' + (x + barW/2) + '" y="' + (padT + chartH - Math.max(succH, 1) - 3) + '" text-anchor="middle">' + Math.round(r.rate * 100) + '%</text>';
  });
  
  svg.innerHTML = html;
}
function renderCostTracker(estimates) {
var grid = document.getElementById('costGrid');
if (!grid) return;
if (!estimates || estimates.length === 0) {
grid.innerHTML = '<div class="empty-state" style="padding:12px"><div class="empty-state-icon">⚡</div>Waiting for data...</div>';
return;
}
var html = '';
var totalTokens = 0;
var totalCost = 0;
estimates.forEach(function(e) {
totalTokens += e.estimatedTokens || 0;
totalCost += e.estimatedCostUsd || 0;
html += '<div class="cost-card">' +
'<div class="cost-agent">' + e.agent + '</div>' +
'<div class="cost-tokens">' + formatTokens(e.estimatedTokens) + '</div>' +
'<div class="cost-usd">$' + (e.estimatedCostUsd).toFixed(4) + '</div>' +
'</div>';
});
grid.innerHTML = html;
var totalEl = document.getElementById('totalCost');
if (totalEl) totalEl.textContent = '$' + totalCost.toFixed(3) + ' | ' + (totalTokens > 1000 ? Math.round(totalTokens/1000) + 'K' : totalTokens) + ' tok';
}
function formatTokens(n) {
if (!n) return '0';
if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
if (n >= 1000) return Math.round(n/1000) + 'K';
return String(n);
}

connect();scheduleRender();uptimeInterval=setInterval(scheduleRender,5000);
})();
</script>
</body>
</html>
`
