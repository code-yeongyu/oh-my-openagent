# Final QA

## What was observed

- The three reviewer regressions failed before production edits:
  - newer draft was replaced with an empty string;
  - New BTW used `ses_other` instead of the picker parent;
  - Escape handling had no injectable clock.
- Focused GREEN checks then proved:
  - the newer draft survives catalog completion;
  - New BTW metadata keeps the encoded `ses_parent`;
  - picker browsing works without a prompt ref, while New BTW remains
    unavailable instead of consuming a different route's composer;
  - same-parent prompt remounts use the current active replacement ref;
  - an Escape after 1,001 ms starts a new pair, while the next Escape after
    99 ms returns once.
- The real TUI returned from the side to Main after two Escape presses 500 ms
  apart and displayed `BTW retained`.
- Isolated SQLite contained:
  - Main `ses_fdd7cb126ffeqrc131gwQ89nzb`;
  - side `ses_fdd7cabfbffeGtC15w2KGCTaWN`, whose metadata parent is Main.
- Mandatory tmux smoke rendered OpenCode 1.18.18, accepted send-keys, tore down
  the tmux session, and kept the host session count at `7628`.
- Host OpenCode session count was `7628` immediately before and after the
  recorded tmux smoke.

## Why it is enough

The focused tests pin the exact asynchronous and timing races reported by the
reviewer. The real TUI run exercises the shipped OpenTUI surface, route change,
side retention, model response, and bounded double-Escape behavior. SQLite
metadata confirms the side relationship, and the unchanged host count proves
isolation.

## What was omitted

- Raw host OMO logs contain unrelated concurrent activity and were not copied.
- Fake-model request bodies were not copied because deterministic responses
  and session metadata were sufficient.
- The isolated database, package caches, and temporary HOME are removed after
  their exact query and terminal outputs are captured under `artifacts/`.
