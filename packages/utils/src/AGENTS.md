# utils/src — Utility Implementations

## OVERVIEW
Direct utility modules and the root barrel for `@oh-my-opencode/utils` (score 16: 147 files, 9 subdirectories, ~1,350 declarations, barrel imported repo-wide); this file covers the broad direct surface, while domain-heavy subtrees have their own guidance.

## STRUCTURE

- `index.ts` — public root barrel and cross-domain export surface.
- `config-*.ts`, `deep-merge.ts`, `frontmatter.ts`, `jsonc-parser.ts` — config and structured-text handling.
- `file-utils.ts`, `atomic-write.ts`, `write-file-atomically.ts`, `xdg-data-dir.ts` — filesystem boundaries.
- `prompt-async-gate.ts` and `prompt-async-gate/` — serialized internal prompt dispatch.
- `process-tree*.ts`, `process-stream-reader.ts`, `process-sweep/` — process lifecycle utilities.
- `ast-grep/`, `git-worktree/`, `logging/`, `migration/`, `runtime/`, `zip-entry-listing/` — specialized domains.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Add a public utility | `index.ts` plus its implementation | Keep root exports and package subpath exports aligned. |
| Merge or parse config | `config-merge.ts`, `config-section-parser.ts`, `jsonc-parser.ts` | Preserve JSONC and section-boundary behavior. |
| Dispatch an internal prompt | `prompt-async-gate.ts` | See `prompt-async-gate/AGENTS.md`; never call a session prompt directly. |
| Cross-runtime process work | `runtime/` | See `runtime/AGENTS.md` for adapter invariants. |
| Process cleanup | `process-sweep/` | See `process-sweep/AGENTS.md` for kill authorization. |

## CONVENTIONS

- Use relative imports; this package is strict ESM with `moduleResolution: bundler`.
- Keep tests colocated as `*.test.ts` and expose new public APIs through the root barrel only when intended.
- Boundary helpers fail closed or return their documented fallback rather than guessing at malformed input.

## ANTI-PATTERNS

- Do not bypass `dispatchInternalPrompt()` for internal `session.prompt` work.
- Do not add process-kill authorization based only on an executable-looking argv; use the domain attestation path.
- Do not add path aliases or silently widen package exports.

## COMMANDS

```bash
bun run typecheck
bun run test
```
