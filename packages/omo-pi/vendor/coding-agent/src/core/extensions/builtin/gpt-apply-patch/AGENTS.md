# builtin/gpt-apply-patch

Builtin extension #2. When the active model is a `gpt-*` model on a Responses-family API, swaps `write` / `edit` for a freeform Codex-style `apply_patch` tool with a Lark-style grammar. Applies multi-file patches (add / update / delete / move). Falls back to standard edit tools for all other models. Largest single builtin (18 files).

## FILES

```
gpt-apply-patch/
├── index.ts            # Re-export barrel — the module's public surface, no logic
├── extension.ts        # Extension entry — API/model gate (isOpenAIGptModel) + tool registration;
│                       # hooks session_start + model_select
├── tool.ts             # `apply_patch` tool definition (TypeBox schema + execute)
├── params.ts           # Argument parsing + validation
├── parser.ts           # Codex apply_patch grammar parser
├── streaming-parser.ts # Streaming variant for partial-arg rendering during stream
├── streaming-render.ts # TUI render for partial patches
├── patch-diff.ts       # Diff/hunk math on top of the npm `diff` package
├── patch-replace.ts    # Replace algorithms (anchor matching, seek fallback)
├── seek-sequence.ts    # Strict context-line seek with N-line tolerance
├── apply.ts            # Apply parsed patch to workspace
├── workspace.ts        # File I/O + path normalization for patches
├── preview.ts          # Preview before apply (used by permission-system parser)
├── preview-format.ts   # Render preview as TUI nodes (opencode-style diff)
├── text.ts             # Text utilities (line splitting, trailing newline handling)
├── constants.ts        # Sentinel tokens (`*** Begin Patch`, `*** End Patch`, etc.)
├── errors.ts           # Typed parse + apply errors
└── types.ts            # Patch AST shape (FileOp union, Hunk, Replace)
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Fix a parse error from a real GPT output | `parser.ts` — add a regression test in `test/suite/gpt-apply-patch-extension.test.ts` |
| Improve strict-seek tolerance | `seek-sequence.ts` |
| Change render | `preview-format.ts` + `streaming-render.ts` |
| Add a new file op (e.g. `*** Rename File:`) | `types.ts` + `parser.ts` + `apply.ts` |
| Adjust which models opt in | `extension.ts` — `APPLY_PATCH_FREEFORM_APIS` + `gpt-` id prefix in `isOpenAIGptModel()` |

## CONVENTIONS

- **Gate is API + id**: active only when `model.api` is in `APPLY_PATCH_FREEFORM_APIS` (`openai-responses`, `azure-openai-responses`, `openai-codex-responses`) AND `model.id` starts with `gpt-` — freeform custom tools only exist on the Responses-family APIs, so a `gpt-*` model on `openai-completions` keeps `write`/`edit`. Selection happens on `session_start` and `model_select`.
- **Strict context lines**: `seek-sequence.ts` requires exact context-line match (with bounded fuzz). Bypassing strict mode masks real grammar bugs.
- **Mirror upstream Codex grammar** in `parser.ts` — the canonical reference is `openai/codex` `apply_patch` source. The schema golden (`test/goldens/codex-apply-patch-schema.json`) is extracted from there via the repo-root `scripts/extract-codex-apply-patch-golden.mjs`.
- **Permission-system integration**: `parsers.ts` in `permission-system/` extracts file paths from patch bodies for per-file approval (see `permission-system/changes.md` 2026-04-13).
- **Render diffs like opencode** (recent commit f1d24c2f): the preview UI mirrors opencode's diff formatting.

## ANTI-PATTERNS

- Falling back to non-strict seek for "convenience" — masks model output bugs and produces wrong patches.
- Gating on a provider allowlist — gate on `model.api` + the `gpt-` id prefix in `extension.ts` so OpenAI-compatible custom providers (e.g. a proxy exposing gpt-5.5 via `openai-responses`) opt in too.
- Re-implementing diff rendering — `preview-format.ts` must keep using `core/tools/diff-render.ts` (`renderToolDiff`), the module shared with the `edit`/`write` renders.
- Changing patch sentinels (`*** Begin Patch`, etc.) — must match Codex exactly.

## NOTES

- The `apply_patch` tool exposes `promptSnippet` + `promptGuidelines` that the dynamic prompt picks up; prompt-preset's `file-operations.ts` reinforces "use apply_patch, not python heredoc" for GPT presets.
- The schema golden lives at `packages/coding-agent/test/goldens/codex-apply-patch-schema.json` (consumed by `test/suite/regressions/codex-apply-patch-schema-parity.test.ts`). Re-extract from upstream with `node scripts/extract-codex-apply-patch-golden.mjs` at the repo root (requires a local `openai/codex` checkout).
- `streaming-parser.ts` powers partial render during model streaming — keep it tolerant of incomplete blocks.
