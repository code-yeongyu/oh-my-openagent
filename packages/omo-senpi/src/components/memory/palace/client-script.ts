export function palaceClientScript(dataElementId: string): string {
  return `(function () {
  'use strict';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var applyTheme = function (matches) { document.documentElement.classList.toggle('dark', matches); };
  applyTheme(media.matches);
  media.addEventListener('change', function (event) { applyTheme(event.matches); });

  var DATA;
  try {
    DATA = JSON.parse(document.getElementById('${dataElementId}').textContent);
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

  var renderPeople = function (root, section) {
    if (!root) return;
    var nodes = (section && section.nodes) || [];
    var edges = (section && section.edges) || [];
    if (nodes.length === 0) { root.appendChild(el('div', 'empty', 'No people recorded')); return; }
    root.appendChild(el('div', 'panel-title', 'People graph'));
    nodes.forEach(function (node) {
      var card = el('article', 'person');
      var head = el('div', 'person-head');
      head.appendChild(el('span', 'person-name', node.displayName));
      head.appendChild(el('span', 'person-slug', node.path));
      if (node.kind) head.appendChild(pill(node.kind));
      (node.aliases || []).forEach(function (alias) { head.appendChild(pill(alias, 'plain')); });
      head.appendChild(pill(node.state, stateVariant(node.state)));
      card.appendChild(head);
      var outgoing = edges.filter(function (edge) { return edge.source === node.slug; });
      if (outgoing.length === 0) {
        card.appendChild(el('div', 'entry-body', 'No relationships recorded'));
      } else {
        var list = el('ul', 'edges');
        outgoing.forEach(function (edge) {
          var row = el('li', 'edge');
          row.appendChild(el('span', 'edge-predicate', edge.predicate));
          row.appendChild(el('span', 'edge-arrow', '->'));
          row.appendChild(el('span', 'grow', edge.target));
          if (!edge.targetSlug) row.appendChild(pill('no card', 'warn'));
          list.appendChild(row);
        });
        card.appendChild(list);
      }
      root.appendChild(card);
    });
    var diagnostics = (section && section.diagnostics) || [];
    if (diagnostics.length === 0) return;
    root.appendChild(el('div', 'panel-title', 'Card diagnostics'));
    var issues = el('ul', 'rows');
    diagnostics.forEach(function (diagnostic) {
      var row = el('li', 'row');
      row.appendChild(el('span', 'grow', diagnostic.path));
      row.appendChild(el('span', 'dim', diagnostic.message));
      issues.appendChild(row);
    });
    root.appendChild(issues);
  };

  renderCore(document.getElementById('panel-core'), DATA.core);
  renderExternal(document.getElementById('panel-external'), DATA.external);
  renderHistory(document.getElementById('panel-history'), DATA.history);
  renderReflection(document.getElementById('panel-reflection'), DATA.reflection);
  if (DATA.people) renderPeople(document.getElementById('panel-people'), DATA.people);

  document.getElementById('tabs').addEventListener('click', function (event) {
    var button = event.target.closest('[data-tab]');
    if (!button) return;
    var name = button.getAttribute('data-tab');
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (tab) {
      tab.classList.toggle('active', tab === button);
    });
    ['core', 'external', 'history', 'reflection', 'people'].forEach(function (panel) {
      var node = document.getElementById('panel-' + panel);
      if (node) node.hidden = panel !== name;
    });
  });
})();
`
}
