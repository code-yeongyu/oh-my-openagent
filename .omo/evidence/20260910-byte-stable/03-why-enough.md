# WHY ENOUGH (20260910-byte-stable, worktree wt-byte-stable)

This change adds one markdown file and edits no code, so the decisive
question is whether existing behavior still holds. The evidence answers it
three ways.

* The golden gate (6/6) pins the exact bytes this feature exists to
  protect: sorted registry export, pass-through transform output, S1 retry
  equality, S2 model-switch determinism. Green without the regen flag
  means the doc commit drifted nothing.
* The neighbor suites (20/20) cover every mechanism the doc describes:
  registry freeze and sort, chain order, todo apply-once, volatile tail
  replace semantics, prefix-hash pins, stable stringify. A doc wording
  error against any of them would show here first.
* The scoped typecheck (exit 0) rules out accidental edits to code files;
  `git status` confirms the only non-submodule delta is the new doc plus
  this evidence dir.

Residual risk: live server, SSE, and TUI surfaces were not exercised (see
`04-omitted.md`). For a docs-only change with zero code delta, that risk
is limited to the doc being wrong, which the golden and neighbor suites
already guard. A doc-comment fix under 5 lines remains allowed if review
finds a wording slip.
