/* ═══════════════════════════════════════════
   MaTrix Dashboard — UI Components
   ═══════════════════════════════════════════ */

const MaTrix = {
  ProgressBar({ pct, color = 'var(--brand-cyan)', height = '4px', label } = {}) {
    const barColor = pct > 85 ? 'var(--brand-red)' : pct > 70 ? 'var(--brand-amber)' : color;
    return `<div style="margin-bottom:${label ? '2px' : '0'}">
      ${label ? `<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:2px;"><span>${label}</span><span>${pct}%</span></div>` : ''}
      <div style="background:rgba(255,255,255,0.06);border-radius:var(--radius-full);height:${height};overflow:hidden;">
        <div style="width:${Math.min(pct, 100)}%;height:100%;background:${barColor};border-radius:var(--radius-full);transition:width 0.5s ease;"></div>
      </div>
    </div>`;
  },

  StatCard({ label, value, accent, subtext } = {}) {
    return `<div class="glass-card" style="display:flex;flex-direction:column;gap:2px;padding:var(--space-3);">
      <div style="font-size:var(--font-size-xs);color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
      <div style="font-size:var(--font-size-2xl);font-weight:700;font-family:var(--font-mono);color:${accent || 'var(--brand-cyan)'};">${value ?? '—'}</div>
      ${subtext ? `<div style="font-size:9px;color:var(--text-muted);">${subtext}</div>` : ''}
    </div>`;
  },

  ThinBar({ values, color = 'var(--brand-cyan)' } = {}) {
    if (!values || values.length === 0) return '';
    const max = Math.max(...values, 1);
    const barWidth = Math.max(4, Math.min(30, 100 / values.length));
    return `<div style="display:flex;align-items:flex-end;gap:2px;height:32px;margin-top:var(--space-2);">
      ${values.map(v => {
        const h = Math.max(4, (v / max) * 28);
        return `<div style="width:${barWidth}px;height:${h}px;background:${color};border-radius:2px 2px 0 0;opacity:0.7;"></div>`;
      }).join('')}
    </div>`;
  },

  AgentStatusDot({ status = 'idle' } = {}) {
    const colors = { active: 'var(--status-success)', working: 'var(--status-active)', idle: 'var(--status-idle)', error: 'var(--status-error)' };
    return `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${colors[status] || colors.idle};flex-shrink:0;"></span>`;
  },
};
