# QA evidence summary

## What was tested

1. Pre-change hierarchy audit:
   `.omo/evidence/20260812-init-deep/hierarchy-red.txt`.
2. Location scoring:
   `.omo/evidence/20260812-init-deep/scoring.md`.
3. Post-change hierarchy audit:
   `.omo/evidence/20260812-init-deep/hierarchy-green.txt`.
4. Package tests, typecheck, markdown links, AGENTS contract, and diff hygiene:
   `.omo/evidence/20260812-init-deep/validation-green.txt`.
5. Manual instruction-surface review:
   `.omo/evidence/20260812-init-deep/manual-review.md`.

## What was observed

- RED: `memory-core` was a 96-file, 11,019-line, 13-subsystem Core package
  without local instructions.
- GREEN: `packages/memory-core/AGENTS.md` exists, the package table links to it,
  no redundant `packages/omo-opencode/AGENTS.md` exists, and all substantial
  packages have package-root or source-root coverage.
- 319 memory-core tests passed; typecheck passed.
- 16 markdown-link audit tests passed; 4 AGENTS dev-environment tests passed.
- Manual path, symbol, scope, and style checks passed.

## Why it is enough

The hierarchy scenario directly proves the requested init-deep outcome. Package
tests and typecheck prove the documented implementation remains green. The
repository markdown audit proves the new link and instruction file integrate
with the checked-in knowledge base. Manual review proves the prose is accurate,
scoped, and non-duplicative.

## What was omitted

- No OpenCode/Codex runtime QA: no adapter/runtime surface changed.
- No prose-string tests: repository rules classify those as pretend coverage.
- Raw environment dumps and unrelated submodule deletion lists are summarized,
  not copied beyond the diagnostic note.

## Cleanup receipt

- No server, browser, tmux session, container, socket, or bound port was created.
- No QA temp directory was created outside the committed evidence directory.
- Read-only explore children are terminal; lost lanes were recorded
  inconclusive and do not hold resources.
- The unrelated dirty `designpowers` submodule is excluded from task pathspecs
  and remains untouched.
- The main checkout's unrelated
  `packages/omo-senpi/plugin/extensions/omo.js` modification remains unchanged.
