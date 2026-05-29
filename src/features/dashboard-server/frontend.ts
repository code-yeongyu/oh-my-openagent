export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Agent Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a; --surface:#111111; --card:rgba(255,255,255,0.02); --card-hover:rgba(255,255,255,0.05);
  --border:#262626; --border-accent:rgba(0,212,255,0.2);
  --primary:#00d4ff; --primary-glow:rgba(0,212,255,0.10);
  --agent-identity:#7c3aed;
  --success:#10b981; --warning:#f59e0b; --error:#ef4444; --info:#00d4ff;
  --text:#ededed; --text-secondary:#a1a1a1; --text-muted:#71717a;
  --radius:8px; --radius-lg:12px;
  --font:"Geist", system-ui, -apple-system, sans-serif;
  --mono:"Geist Mono", SF Mono, JetBrains Mono, monospace;
}
html{font-size:14px}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5;-webkit-font-smoothing:antialiased}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;background:rgba(17,17,17,0.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:14px}
.topbar-title{font-size:1.15rem;font-weight:700;letter-spacing:-.03em;color:var(--text)}
.topbar-right{display:flex;align-items:center;gap:16px}
.connection-status{display:flex;align-items:center;gap:6px;font-size:.8rem}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;transition:box-shadow .3s}
.status-dot.connected{background:var(--success);box-shadow:0 0 8px rgba(16,185,129,.5)}
.status-dot.disconnected{background:var(--error);box-shadow:0 0 8px rgba(239,68,68,.4)}
.status-label{color:var(--text-secondary);font-size:.75rem;font-weight:500}
.port-label{color:var(--text-muted);font-size:.7rem;font-family:var(--mono)}
.summary-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;padding:16px 24px}
.summary-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;transition:all .2s}
.summary-card:hover{border-color:var(--border-accent);box-shadow:inset 0 0 12px var(--primary-glow)}
.summary-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:4px}
.summary-value{font-size:1.5rem;font-weight:700;letter-spacing:-.03em}
.summary-value.cyan{color:var(--primary)}.summary-value.amber{color:var(--warning)}
.summary-value.green{color:var(--success)}.summary-value.indigo{color:var(--agent-identity)}
.dashboard-grid{display:grid;grid-template-columns:1fr 340px;gap:16px;padding:0 24px 24px}
@media(max-width:960px){.dashboard-grid{grid-template-columns:1fr}}
.main-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.side-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.section-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.015)}
.section-title{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text)}
.section-badge{font-size:.65rem;background:var(--primary-glow);color:var(--primary);padding:2px 8px;border-radius:6px;font-weight:600;font-family:var(--mono)}
.section-body{padding:12px 16px}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.agent-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;transition:all .2s cubic-bezier(0.16, 1, 0.3, 1);cursor:default}
.agent-card:hover{border-color:rgba(0,212,255,0.3);box-shadow:inset 0 0 12px rgba(0,212,255,0.02), 0 4px 12px rgba(0,0,0,0.5);transform:translateY(-2px)}
.agent-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.agent-name{font-size:.85rem;font-weight:600;font-family:var(--mono);color:var(--agent-identity)}
.agent-status-wrapper{display:flex;align-items:center;gap:6px}
.agent-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:box-shadow .3s}
.agent-status-dot.running{background:var(--success);box-shadow:0 0 6px rgba(16,185,129,.5)}
.agent-status-dot.idle{background:var(--warning);box-shadow:0 0 6px rgba(245,158,11,.4)}
.agent-status-dot.error{background:var(--error);box-shadow:0 0 6px rgba(239,68,68,.4)}
.agent-status-dot.waiting{background:var(--text-muted)}
.thinking-wave{display:none;align-items:flex-end;gap:2px;height:8px}
.running .thinking-wave{display:inline-flex}
.thinking-bar{width:2px;background:var(--success);border-radius:1px;animation:bounce 0.8s ease-in-out infinite alternate}
.thinking-bar:nth-child(1){height:40%;animation-delay:0s}
.thinking-bar:nth-child(2){height:80%;animation-delay:0.2s}
.thinking-bar:nth-child(3){height:60%;animation-delay:0.4s}
@keyframes bounce{0%{height:30%}100%{height:100%}}
.agent-task{font-size:.75rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:6px}
.agent-meta{display:flex;flex-wrap:wrap;gap:6px 10px;font-size:.65rem;color:var(--text-muted);font-family:var(--mono)}
.task-table{width:100%;border-collapse:collapse;font-size:.75rem}
.task-table th{text-align:left;padding:8px;font-weight:600;color:var(--text-muted);text-transform:uppercase;font-size:.65rem;letter-spacing:.05em;border-bottom:1px solid var(--border)}
.task-table td{padding:8px;border-bottom:1px solid var(--border);vertical-align:middle}
.task-table tr:last-child td{border-bottom:none}
.task-table tr:hover td{background:var(--card-hover)}
.task-id{font-family:var(--mono);font-size:.7rem;color:var(--primary)}
.task-agent{font-family:var(--mono);color:var(--agent-identity);font-weight:500}
.task-desc{color:var(--text);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.task-status{display:inline-flex;align-items:center;gap:4px;font-size:.65rem;font-weight:600;padding:2px 8px;border-radius:6px;font-family:var(--mono)}
.task-status.created{background:var(--primary-glow);color:var(--primary)}
.task-status.running{background:rgba(16,185,129,.15);color:var(--success)}
.task-status.completed{color:var(--text-muted);border:1px solid var(--border)}
.task-status.error{background:rgba(239,68,68,.15);color:var(--error)}
.task-duration{font-family:var(--mono);font-size:.7rem;color:var(--text-muted)}
.task-expand{background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px;border-radius:4px;transition:all .15s;display:inline-flex;align-items:center;justify-content:center}
.task-expand:hover{color:var(--primary);background:var(--primary-glow)}
.task-expand svg{width:14px;height:14px;fill:currentColor}
.task-detail{display:none;background:#000;border:1px solid var(--border);border-radius:6px;padding:12px;margin-top:4px;font-size:.7rem;color:var(--text-secondary);font-family:var(--mono);line-height:1.6;white-space:pre-wrap;overflow-x:auto}
.task-detail.open{display:block}
.team-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:10px}
.team-card:last-child{margin-bottom:0}
.team-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.team-name{font-size:.85rem;font-weight:600;color:var(--text)}
.team-members{display:flex;gap:6px;flex-wrap:wrap}
.team-member{display:flex;align-items:center;gap:6px;padding:3px 8px 3px 6px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid var(--border);font-size:.7rem;font-family:var(--mono);color:var(--text-secondary)}
.team-progress{margin-top:10px}
.team-progress-bar{height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden;margin-bottom:6px;position:relative}
.team-progress-fill{height:100%;background:var(--primary);border-radius:3px;transition:width .5s ease;position:relative;overflow:hidden}
@keyframes shimmer{100%{transform:translateX(100%)}}
.team-progress-fill::after{content:'';position:absolute;top:0;right:0;bottom:0;left:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent);transform:translateX(-100%);animation:shimmer 1.5s infinite}
.team-progress-text{font-size:.65rem;color:var(--text-muted);font-family:var(--mono);display:flex;justify-content:space-between}
.terminal-log{background:#000;border-radius:var(--radius);font-family:var(--mono);padding:14px;overflow-y:auto;height:420px;box-shadow:inset 0 0 20px rgba(0,0,0,0.8)}
.terminal-line{font-size:.7rem;color:var(--text-secondary);line-height:1.5;margin-bottom:4px;word-wrap:break-word}
.terminal-time{color:var(--text-muted);margin-right:8px;opacity:0.7}
.terminal-agent{color:var(--agent-identity);font-weight:600;margin-right:8px}
.terminal-text{color:var(--text)}
.terminal-text strong{color:var(--primary);font-weight:600}
.cursor-blink{display:inline-block;width:6px;height:12px;background:var(--primary);animation:blink 1s step-end infinite;vertical-align:middle;margin-left:4px;box-shadow:0 0 8px var(--primary)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.empty-state{text-align:center;padding:32px 16px;color:var(--text-muted);font-size:.8rem}
.empty-state-icon{margin-bottom:12px;opacity:.4;display:flex;justify-content:center}
.empty-state-icon svg{width:32px;height:32px;fill:none;stroke:currentColor;stroke-width:1.5}
@keyframes fadeSlideIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fade-in{animation:fadeSlideIn .3s cubic-bezier(0.16, 1, 0.3, 1) forwards}
.loading{display:flex;align-items:center;justify-content:center;padding:40px;gap:10px;color:var(--text-muted);font-family:var(--mono);font-size:.75rem}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:0 24px 24px}
@media(max-width:960px){.analytics-grid{grid-template-columns:1fr}}
.analytics-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden}
.analytics-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.analytics-body{padding:16px;min-height:120px}
.heatmap-canvas{width:100%;height:120px;border-radius:6px}
.chart-svg{width:100%;height:100px;overflow:visible}
.bar-label{font-size:.6rem;fill:var(--text-muted);font-family:var(--mono)}
.bar-value{font-size:.6rem;fill:var(--text-secondary);font-family:var(--mono)}
.chart-line{fill:none;stroke:var(--primary);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;filter:drop-shadow(0 0 6px var(--primary))}
.chart-area{fill:var(--primary-glow);stroke:none}
.heatmap-cell:hover{stroke:var(--text);stroke-width:.5}
.success-bar{fill:var(--success);opacity:.8;transition:opacity .2s}
.fail-bar{fill:var(--error);opacity:.8;transition:opacity .2s}
.success-bar:hover,.fail-bar:hover{opacity:1}
.cost-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.cost-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;text-align:center;transition:border-color .2s}
.cost-card:hover{border-color:var(--border-accent)}
.cost-agent{font-size:.7rem;font-weight:600;color:var(--text-secondary);margin-bottom:4px;font-family:var(--mono)}
.cost-tokens{font-size:1rem;font-weight:700;color:var(--primary);letter-spacing:-.02em}
.cost-usd{font-size:.75rem;color:var(--text-muted)}
.export-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;font-size:.7rem;font-family:var(--mono);font-weight:600;text-decoration:none;color:var(--text-secondary);background:var(--card);border:1px solid var(--border);transition:all .2s;cursor:pointer}
.export-btn:hover{color:var(--primary);border-color:var(--primary);background:var(--primary-glow)}
.export-btn svg{width:14px;height:14px;stroke:currentColor;stroke-width:2;fill:none}
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="6" stroke="var(--primary)" stroke-width="1.8"/>
      <path d="M8 12L11 15L16 9" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span class="topbar-title">Agent Dashboard</span>
  </div>
  <div class="topbar-right">
    <div class="connection-status">
      <span class="status-dot disconnected" id="statusDot"></span>
      <span class="status-label" id="statusLabel">Disconnected</span>
    </div>
    <span class="port-label" id="portLabel">—</span>
    <a href="/export/json" download class="export-btn" title="Export JSON">
      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      JSON
    </a>
    <a href="/export/csv" download class="export-btn" title="Export CSV">
      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      CSV
    </a>
  </div>
</div>

<div class="summary-bar" id="summaryBar">
  <div class="summary-card"><div class="summary-label">Agents Running</div><div class="summary-value cyan" id="sAgents">0</div></div>
  <div class="summary-card"><div class="summary-label">Tasks Queued</div><div class="summary-value amber" id="sQueued">0</div></div>
  <div class="summary-card"><div class="summary-label">Active Teams</div><div class="summary-value indigo" id="sTeams">0</div></div>
  <div class="summary-card"><div class="summary-label">Uptime</div><div class="summary-value green" id="sUptime">0s</div></div>
</div>

<div class="dashboard-grid">
  <div class="main-col">
    <div class="section">
      <div class="section-header">
        <span class="section-title">Active Agents</span>
        <span class="section-badge" id="agentBadge">0</span>
      </div>
      <div class="section-body" id="agentGrid"><div class="loading"><div class="spinner"></div><span>Awaiting telemetry...</span></div></div>
    </div>
    <div class="section">
      <div class="section-header">
        <span class="section-title">Tasks</span>
        <span class="section-badge" id="taskBadge">0</span>
      </div>
      <div class="section-body" id="taskBoard"><div class="loading"><div class="spinner"></div><span>Awaiting telemetry...</span></div></div>
    </div>
    <div class="section">
      <div class="section-header">
        <span class="section-title">Teams</span>
        <span class="section-badge" id="teamBadge">0</span>
      </div>
      <div class="section-body" id="teamView">
        <div class="empty-state">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg></div>
          No teams active
        </div>
      </div>
    </div>
  </div>
  <div class="side-col">
    <div class="section">
      <div class="section-header">
        <span class="section-title">Terminal Log</span>
        <span class="section-badge" id="timelineBadge">0</span>
      </div>
      <div class="section-body" style="padding:0">
        <div class="terminal-log" id="timeline">
          <div class="loading"><div class="spinner"></div><span>Awaiting telemetry...</span></div>
        </div>
      </div>
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
    <div class="analytics-body"><svg id="durationChart" class="chart-svg" viewBox="0 0 300 100"></svg></div>
  </div>
  <div class="analytics-section" style="grid-column:1/-1">
    <div class="analytics-header"><span class="section-title">Agent Success Rate</span><span class="section-badge" style="font-size:.6rem">last 24h</span></div>
    <div class="analytics-body"><svg id="successChart" class="chart-svg" viewBox="0 0 300 80"></svg></div>
  </div>
  <div class="analytics-section" style="grid-column:1/-1">
    <div class="analytics-header"><span class="section-title">Token Usage</span><span class="section-badge" id="totalCost" style="font-size:.6rem">—</span></div>
    <div class="analytics-body"><div class="cost-grid" id="costGrid"><div class="empty-state" style="padding:12px"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>Waiting for data...</div></div></div>
  </div>
</div>

<script>
(function() { 'use strict';
var state={agents:new Map(),tasks:new Map(),teams:new Map(),timeline:[],connected:false,port:null,summary:{agents:0,queued:0,teams:0,startTime:Date.now()}};
var ws=null,reconnectTimer=null,reconnectDelay=1000,pingInterval=null,uptimeInterval=null,renderScheduled=false;

function $(id){return document.getElementById(id);}
var dom={statusDot:$('statusDot'),statusLabel:$('statusLabel'),portLabel:$('portLabel'),sAgents:$('sAgents'),sQueued:$('sQueued'),sTeams:$('sTeams'),sUptime:$('sUptime'),agentGrid:$('agentGrid'),agentBadge:$('agentBadge'),taskBoard:$('taskBoard'),taskBadge:$('taskBadge'),teamView:$('teamView'),teamBadge:$('teamBadge'),timeline:$('timeline'),timelineBadge:$('timelineBadge')};

function fmtDuration(ms){if(!ms||ms<0)return'\u2014';var s=Math.floor(ms/1000);if(s<5)return'just now';if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s';var h=Math.floor(m/60);return h+'h '+(m%60)+'m';}
function fmtTime(ts){var d=new Date(ts);return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0')+':'+d.getSeconds().toString().padStart(2,'0');}
function fmtUptime(ms){var s=Math.floor(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60);if(m<60)return m+'m '+(s%60)+'s';var h=Math.floor(m/60);if(h<24)return h+'h '+(m%60)+'m';return Math.floor(h/24)+'d '+h%24+'h';}
function shortId(id){return id&&id.length>8?id.slice(0,8):(id||'');}
function esc(s){var d=document.createElement('div');d.appendChild(document.createTextNode(s));return d.innerHTML;}
function scheduleRender(){if(renderScheduled)return;renderScheduled=true;requestAnimationFrame(function(){renderScheduled=false;doRender();});}

function doRender(){
  dom.statusDot.className='status-dot '+(state.connected?'connected':'disconnected');
  dom.statusLabel.textContent=state.connected?'Connected':'Disconnected';
  var ra=0;state.agents.forEach(function(a){if(a.status==='running')ra++;});
  dom.sAgents.textContent=ra;dom.sQueued.textContent=state.summary.queued;
  dom.sTeams.textContent=state.teams.size;
  dom.sUptime.textContent=fmtUptime(Date.now()-state.summary.startTime);
  dom.agentBadge.textContent=state.agents.size;
  if(state.agents.size===0){dom.agentGrid.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg></div>No agents active</div>';}
  else{
    var h='<div class="agent-grid">',agents=[];state.agents.forEach(function(v){agents.push(v);});
    agents.sort(function(a,b){return((a.status==='running'?0:1)-(b.status==='running'?0:1));});
    for(var i=0;i<agents.length;i++){var a=agents[i];
      h+='<div class="agent-card fade-in'+(a.status==='running'||a.status==='stalled'?' '+a.status:'')+'"><div class="agent-card-header"><span class="agent-name">'+esc(a.name)+'</span><div class="agent-status-wrapper"><span class="agent-status-dot '+a.status+'"></span><div class="thinking-wave"><div class="thinking-bar"></div><div class="thinking-bar"></div><div class="thinking-bar"></div></div></div></div>';
      h+='<div class="agent-task">'+esc(a.task||'Idle')+'</div><div class="agent-meta">';
      if(a.duration!=null)h+='<span>\u23f1 '+fmtDuration(a.duration)+'</span>';
      if(a.toolCalls!=null)h+='<span>\u26a1 '+a.toolCalls+' calls</span>';
      h+='</div></div>';}
    h+='</div>';dom.agentGrid.innerHTML=h;
  }
  dom.taskBadge.textContent=state.tasks.size;
  if(state.tasks.size===0){dom.taskBoard.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>No tasks</div>';}
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
      h+='<td><button class="task-expand" onclick="toggleTask(this)" data-task="'+esc(t.id)+'"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button></td></tr>';
      h+='<tr id="detail-'+esc(t.id)+'" style="display:none"><td colspan="6"><div class="task-detail open">'+esc(JSON.stringify(t.data||{},null,2))+'</div></td></tr>';}
    h+='</tbody></table>';dom.taskBoard.innerHTML=h;
  }
  dom.teamBadge.textContent=state.teams.size;
  if(state.teams.size===0){dom.teamView.innerHTML='<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg></div>No teams active</div>';}
  else{
    var h='';state.teams.forEach(function(team){
      h+='<div class="team-card fade-in"><div class="team-header"><span class="team-name">'+esc(team.name)+'</span><span class="section-badge">'+shortId(team.id)+'</span></div><div class="team-members">';
      if(team.members){for(var j=0;j<team.members.length;j++){var m=team.members[j];var ms=(team.memberStatus&&team.memberStatus[m])?team.memberStatus[m]:'idle';
        h+='<span class="team-member"><span class="agent-status-dot '+ms+'"></span>'+esc(m)+'</span>';}}
      h+='</div>';
      if(team.total>0){var pct=Math.round(team.completed/team.total*100);
        h+='<div class="team-progress"><div class="team-progress-bar"><div class="team-progress-fill" style="width:'+pct+'%"></div></div>';
        h+='<div class="team-progress-text"><span>'+team.completed+'/'+team.total+' tasks</span><span>'+pct+'%</span></div></div>';}
      h+='</div>';});
    dom.teamView.innerHTML=h;
  }
  dom.timelineBadge.textContent=state.timeline.length;
  if(state.timeline.length===0){dom.timeline.innerHTML='<div class="empty-state" style="padding-top:100px"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4"/><polyline points="14 2 14 8 20 8"/><path d="M2 15h10"/><path d="M9 18l3-3-3-3"/></svg></div>No terminal activity</div>';}
  else{
    var h='',events=state.timeline;
    for(var i=0;i<events.length;i++){
      var ev=events[i];
      h+='<div class="terminal-line fade-in"><span class="terminal-time">['+fmtTime(ev.timestamp)+']</span>';
      if(ev.agent) h+='<span class="terminal-agent">'+esc(ev.agent)+'</span>';
      h+='<span class="terminal-text">'+ev.html+'</span></div>';
    }
    h+='<div class="terminal-line"><span class="cursor-blink"></span></div>';
    dom.timeline.innerHTML=h;
    dom.timeline.scrollTop = dom.timeline.scrollHeight;
  }
}

function handleEvent(event){
  var ts=event.timestamp||Date.now();
  function addTL(kind,agent,desc){state.timeline.push({kind:kind,timestamp:ts,agent:agent,html:esc(desc)});if(state.timeline.length>200)state.timeline.splice(0,state.timeline.length-200);}
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
    ctx.fillStyle = '#a1a1a1';
    ctx.font = '500 11px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(name, 0, padT + i * cellH + cellH/2 + 4);
    
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
      ctx.fillStyle = count > 0 ? 'rgba(0, 212, 255, ' + Math.max(0.15, intensity) + ')' : 'rgba(255,255,255,.02)';
      ctx.fillRect(padL + m * (cellW + 1), padT + i * cellH, cellW, cellH - 2);
    }
  });
}

function renderDurationChart(samples) {
  var svg = document.getElementById('durationChart');
  if (!svg || !samples || samples.length < 2) {
    if (svg) svg.innerHTML = '<text x="150" y="50" text-anchor="middle" fill="#71717a" font-size="10">Waiting for data...</text>';
    return;
  }
  
  var W = 300, H = 100;
  var recent = samples.slice(-20);
  var maxDur = 1;
  recent.forEach(function(s) { if (s.durationMs > maxDur) maxDur = s.durationMs; });
  
  var padL = 30, padR = 10, padT = 10, padB = 20;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;
  
  var points = recent.map(function(s, i) {
    var x = padL + (i / Math.max(recent.length - 1, 1)) * chartW;
    var y = padT + chartH - (s.durationMs / maxDur) * chartH;
    return x + ',' + y;
  });
  
  var polyPoints = padL + ',' + (padT + chartH) + ' ' + points.join(' ') + ' ' + (padL + chartW) + ',' + (padT + chartH);
  
  var html = '<defs><linearGradient id="areaGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(0,212,255,0.2)"/><stop offset="100%" stop-color="rgba(0,212,255,0)"/></linearGradient></defs>';
  html += '<polygon fill="url(#areaGlow)" stroke="none" points="' + polyPoints + '"/>';
  html += '<polyline class="chart-line" points="' + points.join(' ') + '"/>';
  
  html += '<text class="bar-label" x="0" y="' + (padT + chartH) + '">0</text>';
  html += '<text class="bar-label" x="0" y="' + (padT + 5) + '">' + (maxDur > 1000 ? (maxDur/1000).toFixed(0) + 's' : maxDur.toFixed(0) + 'ms') + '</text>';
  
  svg.innerHTML = html;
}

function renderSuccessChart(rates) {
  var svg = document.getElementById('successChart');
  if (!svg || !rates || rates.length === 0) {
    if (svg) svg.innerHTML = '<text x="150" y="40" text-anchor="middle" fill="#71717a" font-size="10">Waiting for data...</text>';
    return;
  }
  
  var W = 300, H = 80;
  var padL = 40, padR = 10, padT = 10, padB = 20;
  var chartW = W - padL - padR;
  var chartH = H - padT - padB;
  var barW = Math.min(24, chartW / rates.length - 4);
  
  var html = '';
  rates.forEach(function(r, i) {
    var x = padL + (i / rates.length) * chartW + (chartW / rates.length - barW) / 2;
    var succH = r.rate * chartH;
    var failH = (1 - r.rate) * chartH;
    
    var succY = padT + chartH - succH;
    html += '<rect class="success-bar" x="' + x + '" y="' + succY + '" width="' + (barW/2-1) + '" height="' + Math.max(succH, 1) + '" rx="1"/>';
    var failY = padT + chartH - failH;
    html += '<rect class="fail-bar" x="' + (x + barW/2 + 1) + '" y="' + failY + '" width="' + (barW/2-1) + '" height="' + Math.max(failH, 1) + '" rx="1"/>';
    
    html += '<text class="bar-label" x="' + (x + barW/2) + '" y="' + (padT + chartH + 14) + '" text-anchor="middle">' + r.agent.substring(0, 6) + '</text>';
    html += '<text class="bar-value" x="' + (x + barW/2) + '" y="' + (padT + chartH - Math.max(succH, failH, 1) - 4) + '" text-anchor="middle">' + Math.round(r.rate * 100) + '%</text>';
  });
  
  svg.innerHTML = html;
}
function renderCostTracker(estimates) {
var grid = document.getElementById('costGrid');
if (!grid) return;
if (!estimates || estimates.length === 0) {
grid.innerHTML = '<div class="empty-state" style="padding:12px"><div class="empty-state-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>Waiting for data...</div>';
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
