// Self-contained memory palace HTML shell. No external fonts, stylesheets, scripts or network calls.
// Design tokens (ported from the letta memory viewer, system font stacks substituted for the CDN
// webfonts) live in :root / html.dark; every rule below references a token, never a raw literal.

export const PALACE_DATA_PLACEHOLDER = "<!--OMO_PALACE_DATA-->"
export const PALACE_DATA_ELEMENT_ID = "omo-palace-data"

export const PALACE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Memory Palace</title>
<style>
:root {
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
.footer {
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: var(--text-sm);
}
</style>
</head>
<body>
<div class="shell">
  <header class="header">
    <h1>Memory Palace</h1>
    <div class="meta">
      <div>identity <strong id="meta-identity"></strong></div>
      <div>HEAD <strong id="meta-head"></strong></div>
      <div>recompiled <strong id="meta-recompiled"></strong></div>
    </div>
  </header>
  <nav class="tabs" id="tabs">
    <button class="tab active" data-tab="core" type="button">Core</button>
    <button class="tab" data-tab="external" type="button">External</button>
    <button class="tab" data-tab="history" type="button">History</button>
    <button class="tab" data-tab="reflection" type="button">Reflection</button>
  </nav>
  <main class="main">
    <section id="panel-core"></section>
    <section id="panel-external" hidden></section>
    <section id="panel-history" hidden></section>
    <section id="panel-reflection" hidden></section>
  </main>
  <footer class="footer" id="footer"></footer>
</div>
<script type="application/json" id="${PALACE_DATA_ELEMENT_ID}">${PALACE_DATA_PLACEHOLDER}</script>
<script>
(function () {
  'use strict';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var applyTheme = function (matches) { document.documentElement.classList.toggle('dark', matches); };
  applyTheme(media.matches);
  media.addEventListener('change', function (event) { applyTheme(event.matches); });

  var DATA;
  try {
    DATA = JSON.parse(document.getElementById('${PALACE_DATA_ELEMENT_ID}').textContent);
  } catch (error) {
    document.body.textContent = 'Failed to parse palace data.';
    return;
  }

  var el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  var pill = function (text, variant) { return el('span', variant ? 'pill ' + variant : 'pill', text); };
  var stateVariant = function (state) { return state === 'committed' ? 'plain' : 'warn'; };

  var meta = DATA.metadata || {};
  document.getElementById('meta-identity').textContent = meta.identity || 'unknown';
  document.getElementById('meta-head').textContent = meta.headSha || 'no commits';
  document.getElementById('meta-recompiled').textContent = meta.recompiledAt || '';
  document.getElementById('footer').textContent =
    'Generated locally from the committed memory repository. Uncommitted files are shown but are not part of the system prompt.';

  var renderCore = function (root, section) {
    var entries = (section && section.entries) || [];
    if (entries.length === 0) { root.appendChild(el('div', 'empty', 'No core memory files')); return; }
    entries.forEach(function (entry) {
      var card = el('article', 'entry');
      var head = el('div', 'entry-head');
      head.appendChild(el('span', 'entry-path', entry.path));
      head.appendChild(el('span', 'entry-projection', entry.projection));
      if (entry.description) head.appendChild(pill(entry.description));
      head.appendChild(pill(entry.state, stateVariant(entry.state)));
      card.appendChild(head);
      card.appendChild(el('div', 'entry-body', entry.body));
      root.appendChild(card);
    });
  };

  var renderExternal = function (root, section) {
    var entries = (section && section.entries) || [];
    if (section && section.tree) {
      root.appendChild(el('div', 'panel-title', 'Projection'));
      root.appendChild(el('div', 'tree', section.tree));
    }
    if (entries.length === 0) { root.appendChild(el('div', 'empty', 'No external memory files')); return; }
    var list = el('ul', 'rows');
    entries.forEach(function (entry) {
      var row = el('li', 'row');
      row.appendChild(el('span', 'grow', entry.path));
      row.appendChild(el('span', 'dim', entry.byteSize + ' B'));
      row.appendChild(pill(entry.binary ? 'binary' : 'text', entry.binary ? undefined : 'plain'));
      row.appendChild(pill(entry.state, stateVariant(entry.state)));
      list.appendChild(row);
    });
    root.appendChild(list);
  };

  var renderHistory = function (root, section) {
    var commits = (section && section.commits) || [];
    var caps = (section && section.caps) || {};
    root.appendChild(el(
      'div',
      'note',
      'First-parent history, capped at ' + caps.maxCommits + ' commits, ' +
        Math.round((caps.perDiffBytes || 0) / 1024) + 'KB per diff, ' +
        Math.round((caps.totalDiffBytes || 0) / 1048576) + 'MB total.'
    ));
    if (commits.length === 0) { root.appendChild(el('div', 'empty', 'No commits yet')); return; }
    commits.forEach(function (commit) {
      var card = el('article', 'commit');
      var head = el('div', 'commit-head');
      head.appendChild(el('span', 'commit-sha', commit.shortSha));
      head.appendChild(el('span', 'grow', commit.subject));
      if (commit.isReflection) head.appendChild(pill('reflection'));
      head.appendChild(el('span', 'dim', commit.date));
      card.appendChild(head);
      if (commit.diff) card.appendChild(el('pre', 'diff', commit.diff));
      else if (commit.diffTruncated) card.appendChild(el('div', 'note', 'Diff omitted by payload cap.'));
      root.appendChild(card);
    });
  };

  var renderReflection = function (root, section) {
    var cursor = section && section.cursor;
    root.appendChild(el('div', 'panel-title', 'Journal cursor'));
    if (!cursor) {
      root.appendChild(el('div', 'empty', 'No journal state recorded'));
    } else {
      var list = el('ul', 'rows');
      [
        ['conversation', section.conversationId || 'unknown'],
        ['completed steps', cursor.total_completed_steps],
        ['reflected steps', cursor.reflected_completed_steps],
        ['steps since reflection', cursor.steps_since_last_successful_reflection],
        ['last success', cursor.last_reflection_succeeded_at || 'never']
      ].forEach(function (pair) {
        var row = el('li', 'row');
        row.appendChild(el('span', 'grow', pair[0]));
        row.appendChild(el('span', 'dim', pair[1]));
        list.appendChild(row);
      });
      root.appendChild(list);
    }
    root.appendChild(el('div', 'panel-title', 'Recent run outcomes'));
    var outcomes = (section && section.outcomes) || [];
    if (outcomes.length === 0) { root.appendChild(el('div', 'empty', 'No reflection runs recorded')); return; }
    var runs = el('ul', 'rows');
    outcomes.forEach(function (outcome) {
      var row = el('li', 'row');
      row.appendChild(el('span', 'grow', outcome.runId));
      row.appendChild(pill(outcome.outcome, outcome.outcome === 'merged' ? undefined : 'warn'));
      row.appendChild(el('span', 'dim', outcome.finishedAt));
      runs.appendChild(row);
    });
    root.appendChild(runs);
  };

  renderCore(document.getElementById('panel-core'), DATA.core);
  renderExternal(document.getElementById('panel-external'), DATA.external);
  renderHistory(document.getElementById('panel-history'), DATA.history);
  renderReflection(document.getElementById('panel-reflection'), DATA.reflection);

  document.getElementById('tabs').addEventListener('click', function (event) {
    var button = event.target.closest('[data-tab]');
    if (!button) return;
    var name = button.getAttribute('data-tab');
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (tab) {
      tab.classList.toggle('active', tab === button);
    });
    ['core', 'external', 'history', 'reflection'].forEach(function (panel) {
      document.getElementById('panel-' + panel).hidden = panel !== name;
    });
  });
})();
</script>
</body>
</html>
`
