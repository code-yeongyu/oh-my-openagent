# Init-deep scoring decision

## Create

- `packages/memory-core/AGENTS.md`: selected despite a raw score below the
  automatic `>15` threshold because the `8-15` rule permits distinct domains.
  The package has 96 files, 11,019 lines, 13 source subsystems, package-specific
  concurrency and git-backed storage invariants, its own test/typecheck
  commands, and no local instruction file.

## Skip

- `packages/omo-opencode/AGENTS.md`: skip. The package is large, but
  `packages/omo-opencode/src/AGENTS.md` plus its descendants already cover the
  meaningful source surface. A package-root file would duplicate root,
  `packages/AGENTS.md`, and `src/AGENTS.md`.
- Source-only hotspots under `senpi-task`, `omo-senpi`, `utils`, `omo-codex`,
  and `lsp-core`: skip. Their package-root `AGENTS.md` files already define the
  package domain, and no distinct uncovered boundary was found.

## Ancestor update

- Update `packages/AGENTS.md` so the `memory-core` Core-table entry links to
  `memory-core/AGENTS.md`, matching sibling packages.

## Selected file map

1. Create `packages/memory-core/AGENTS.md`.
2. Update only the `memory-core` row in `packages/AGENTS.md`.
3. Do not create `packages/omo-opencode/AGENTS.md`.

## RED to GREEN contract

- RED: `packages/memory-core` has no package-scoped instructions and its package
  table entry points only to the directory.
- GREEN: the selected file map exists, the ancestor link resolves, and no
  redundant package/source instruction files are introduced.
