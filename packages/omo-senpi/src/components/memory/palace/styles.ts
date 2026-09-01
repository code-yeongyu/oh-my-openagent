export const PALACE_STYLES = `:root {
  --accent: hsl(240, 93%, 35%);
  --accent-soft: hsl(240, 67%, 98%);
  --accent-soft-border: hsl(240, 62%, 94%);
  --bg: hsl(0, 0%, 100%);
  --panel: hsl(0, 0%, 100%);
  --surface: hsl(0, 0%, 98%);
  --surface-2: hsl(0, 0%, 96%);
  --hover: hsl(0, 0%, 96%);
  --border: hsl(210, 10%, 92%);
  --text: hsl(0, 0%, 8%);
  --text-muted: hsl(210, 3%, 28%);
  --text-dim: hsl(210, 3%, 56%);
  --warn: hsl(28, 80%, 34%);
  --warn-soft: hsl(38, 92%, 95%);
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
  --radius: 6px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 22px;
  --text-xs: 10px;
  --text-sm: 11px;
  --text-md: 13px;
  --text-lg: 15px;
  --max-w: 1180px;
}
html.dark {
  --accent: hsl(240, 80%, 68%);
  --accent-soft: hsl(240, 20%, 18%);
  --accent-soft-border: hsl(240, 15%, 25%);
  --bg: hsl(0, 0%, 11%);
  --panel: hsl(0, 0%, 13%);
  --surface: hsl(0, 0%, 15%);
  --surface-2: hsl(0, 0%, 18%);
  --hover: hsl(0, 0%, 18%);
  --border: hsl(210, 3%, 20%);
  --text: hsl(210, 7%, 84%);
  --text-muted: hsl(210, 3%, 60%);
  --text-dim: hsl(210, 3%, 42%);
  --warn: hsl(38, 80%, 66%);
  --warn-soft: hsl(28, 30%, 18%);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--mono);
  font-size: var(--text-md);
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
}
.shell {
  max-width: var(--max-w);
  margin: var(--space-5) auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}
.header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.header h1 {
  font-family: var(--sans);
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: 0.02em;
}
.header .meta {
  margin-left: auto;
  text-align: right;
  color: var(--text-dim);
  font-size: var(--text-sm);
}
.header .meta strong { color: var(--text-muted); font-weight: 500; }
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}
.tab {
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  font-size: var(--text-xs);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-muted);
  user-select: none;
  border: 0;
  background: transparent;
  font-family: var(--mono);
}
.tab:hover { color: var(--text); background: var(--hover); }
.tab.active {
  color: var(--accent);
  background: var(--panel);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.main { padding: var(--space-4) var(--space-5); }
.panel-title {
  font-size: var(--text-xs);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: var(--space-2);
}
.entry {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: var(--space-3);
  overflow: hidden;
  background: var(--panel);
}
.entry-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.entry-path { color: var(--text); font-size: var(--text-md); }
.entry-projection { color: var(--text-dim); font-size: var(--text-sm); }
.entry-body {
  padding: var(--space-3);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
  font-size: var(--text-md);
}
.pill {
  font-size: var(--text-xs);
  border-radius: var(--radius-pill);
  padding: 0 var(--space-2);
  border: 1px solid var(--accent-soft-border);
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}
.pill.warn {
  border-color: var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
}
.pill.plain {
  border-color: var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
}
.tree {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--space-3);
  background: var(--surface);
  white-space: pre;
  overflow-x: auto;
  color: var(--text-muted);
  font-size: var(--text-md);
  margin-bottom: var(--space-4);
}
.rows { list-style: none; }
.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
}
.row:last-child { border-bottom: 0; }
.row .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .dim { color: var(--text-dim); font-size: var(--text-sm); }
.commit { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); }
.commit-head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.commit-sha { color: var(--accent); }
.diff {
  margin: 0;
  padding: var(--space-3);
  overflow-x: auto;
  font-size: var(--text-sm);
  color: var(--text-muted);
  white-space: pre;
}
.note {
  color: var(--text-dim);
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
}
.empty {
  color: var(--text-dim);
  padding: var(--space-4);
  text-align: center;
}
.person {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: var(--space-3);
  overflow: hidden;
  background: var(--panel);
}
.person-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.person-name { color: var(--text); font-size: var(--text-md); }
.person-slug { color: var(--text-dim); font-size: var(--text-sm); }
.edges { list-style: none; padding: var(--space-2) var(--space-3); }
.edge {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-md);
}
.edge-predicate {
  color: var(--accent);
  letter-spacing: 0.04em;
}
.edge-arrow { color: var(--text-dim); }
.footer {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: var(--text-sm);
}
`
