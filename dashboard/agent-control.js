/* ═══════════════════════════════════════════
   MaTrix Dashboard — Agent Control Actions
   ═══════════════════════════════════════════ */

function sendDispatch() {
  const agent = document.getElementById('dispatchAgent').value;
  const task = document.getElementById('dispatchTask').value.trim();
  const resultEl = document.getElementById('dispatchResult');
  if (!task) { resultEl.textContent = '⚠️ Tâche vide'; return; }
  resultEl.textContent = '⏳ Dispatch...';
  fetch('/api/agent/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, task }),
  })
    .then(r => r.json())
    .then(d => { resultEl.textContent = d.success ? `✅ ${d.message}` : `❌ ${d.message}`; })
    .catch(() => { resultEl.textContent = '❌ Erreur réseau'; });
}

function restartOpenCode() {
  if (!confirm('Redémarrer OpenCode ?')) return;
  fetch('/api/agent/restart', { method: 'POST' })
    .then(r => r.json())
    .then(d => { alert(d.message || 'Redémarrage initié'); })
    .catch(() => { alert('Erreur réseau'); });
}

function updateControl(d) {
  const sessions = d.sessions || {};
  const activeList = sessions.active || [];
  const errors = sessions.errors || [];

  document.getElementById('activeCount').textContent = `${activeList.length} active`;
  document.getElementById('activeSessionsList').innerHTML = activeList.length === 0
    ? '<div class="text-sm text-muted" style="text-align:center;padding:var(--space-4);">Aucune session active</div>'
    : activeList.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid rgba(255,255,255,0.03);">
        <div>
          <strong style="font-size:var(--font-size-sm);color:#F8FAFC;">${s.agent || '?'}</strong>
          <span style="font-size:var(--font-size-xs);color:var(--text-muted);margin-left:var(--space-2);">${(s.title || '').substring(0, 40)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <span style="font-size:10px;color:var(--text-muted);">${Math.round(s.idle_min || 0)}m idle</span>
          <button class="btn" style="padding:2px 6px;font-size:10px;background:rgba(239,68,68,0.15);color:var(--status-error);border-radius:4px;" onclick="fetch('/api/agent/kill?id=${s.id}',{method:'POST'}).then(()=>location.reload())">Kill</button>
        </div>
      </div>
    `).join('');

  document.getElementById('errorList').innerHTML = errors.length === 0
    ? '<div class="text-sm text-muted" style="text-align:center;padding:var(--space-4);">Aucune erreur détectée</div>'
    : errors.map(e => `
      <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0;font-size:var(--font-size-xs);border-bottom:1px solid rgba(255,255,255,0.03);">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--status-error);flex-shrink:0;"></span>
        <span style="color:var(--agent-morpheus);font-size:10px;">${e.agent || '?'}</span>
        <span style="color:var(--text-muted);">${(e.title || '').substring(0, 50)}</span>
      </div>
    `).join('');
}
