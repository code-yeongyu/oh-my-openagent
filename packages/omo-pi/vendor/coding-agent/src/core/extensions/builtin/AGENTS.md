# packages/coding-agent/src/core/extensions/builtin

19 in-tree extensions. Each is the canonical answer to "can senpi do X without core changes?". Registration order matters.

## INVENTORY (registration order from `builtin/index.ts`)

| # | ID | Path | Role |
|---|-----|------|------|
| 1 | `permission-system` | `permission-system/` | Full opencode-style permission port: rules, JSONL storage, prompts |
| 2 | `gpt-apply-patch` | `gpt-apply-patch/` | Codex-style `apply_patch` tool with rich render + freeform grammar |
| 3 | `prompt-preset` | `prompt-preset/` | Per-model system prompts (gpt-5.x, claude-opus-4-{5,6,7}, kimi-k2-{6,7}) |
| 4 | `todowrite` | `todotools/` | Plan/task tools; synced from `../pi-extensions/pi-todotools` |
| 5 | `redraws` | `redraws.ts` | Force-redraw event hooks for stable streaming visuals |
| 6 | `anthropic-web-search` | `anthropic-web-search/` | Anthropic-native web search tool |
| 7 | `anthropic-bash` | `anthropic-bash/` | Anthropic-native bash tool variant |
| 8 | `openai-web-search` | `openai-web-search/` | OpenAI-native web search |
| 9 | `service-tier` | `service-tier.ts` | Per-model service-tier (e.g., priority-tier mapping) |
| 10 | `bash-timeout` | `bash-timeout/` | Bash tool timeout + handlers |
| 11 | `tool-pair-guard` | `tool-pair-guard/` | Repairs orphaned tool_use/tool_result pairs (compaction safety) |
| 12 | `compaction` | `compaction/` | Plugsuit-style speculative + emergency compaction with restoration |
| 13 | `history-search` | `history-search/` | Cross-session transcript search overlay (indexes session files) |
| 14 | `session-observer` | `session-observer/` | `/sessions` command — peek at previous session transcripts in a HUD |
| 15 | `websearch` | `websearch/` | Provider-backed `web_search` tool + `/websearch` (providers incl. kimi); vendored from `../pi-extensions/pi-websearch` |
| 16 | `webfetch` | `webfetch/` | `webfetch` tool (md/text/html, gated by `PI_WEBFETCH`); vendored from `../pi-extensions/pi-webfetch` |
| 17 | `nested-agents-md` | `nested-agents-md/` | Auto-injects nearby `AGENTS.md` + `/nested-agents`; vendored from `../pi-extensions/pi-nested-agents-md` |
| 18 | `rules` | `rules/` | Rule-file discovery + `/rules`/`/reload-rules`; vendored from `../pi-extensions/pi-rules` |
| 19 | `goal` | `goal/` | Budget-free goal tools + `/goal`; vendored from `../pi-extensions/pi-goal` |

Plus 4 **global default extensions** (resolved fast-path): `diff`, `files`, `prompt-url-widget`, `tps` (in `globalDefaultExtensionFactories`).

## ADDING A NEW BUILTIN EXTENSION

1. Create `builtin/<name>/index.ts` exporting `default function(pi: ExtensionAPI) { … }`. Single-file extensions go in `builtin/<name>.ts`.
2. Add to `builtin/index.ts` import block + `builtinExtensions` array — pick registration order with intent.
3. Add a regression test under `test/suite/<name>-extension.test.ts` using `test/suite/harness.ts`.
4. If you modify upstream files (rare for new extensions), add a section to `<extension-dir>/changes.md`.
5. Reach for `ExtensionContext` getters (the `ctx` parameter of event handlers); do NOT cross into `core/` directly.

## CONVENTIONS

- **Subdirectory extensions** ship multi-file: `index.ts` + supporting `.ts` (`registry.ts`, `types.ts`, `parsers.ts`, etc.).
- **Single-file extensions** are kept flat (`diff.ts`, `files.ts`, `redraws.ts`, `service-tier.ts`, `tps.ts`, `prompt-url-widget.ts`).
- **`prompt-preset/`** has per-model files (`gpt-5.5.ts`, `claude-opus-4-7.ts`, …) and a shared `file-operations.ts` tuning block. New model = new preset file + entry in `presets.ts`.
- **`permission-system/` is a full port** of opencode's permission flow.
- **`compaction/`** is policy-rich (`policy.ts`, `speculative.ts`, `restoration-tracker.ts`, `circuit-breaker.ts`, `degradation-monitor.ts`, `per-turn-cap.ts`, `tool-truncation.ts`, `checkpoint-state.ts`, `context-reduction.ts`, `openai-remote.ts`, `repair-tool-pairs.ts`, `state.ts`, `todo-bridge.ts`). Touch only with policy tests in lock-step.
- **External versions**: `external-versions.json` pins versions of sibling `../pi-extensions` packages used as vendored builtins; refresh with `packages/coding-agent/scripts/sync-builtin-extensions.mjs`.

## ANTI-PATTERNS

- Reordering `builtinExtensions` for cosmetic reasons — registration order is load-bearing for tools and permission hooks.
- Expecting context inside the factory body — `ExtensionContext` only arrives as the `ctx` parameter of event handlers. Do side effects inside `pi.on("session_start", …)`.
- Importing from `core/` directly — extensions must use the public `pi.*` API.
- Adding a new builtin without a regression test in `test/suite/<name>-extension.test.ts`.
- Splitting an existing single-file extension into a folder "for symmetry" — only split when there's actual code to split.

## NOTES

- `permission-system/storage.ts` writes JSONL approval logs; don't change the line shape without a migration.
- `compaction/restoration-tracker.ts` powers the post-compact context restoration feature — see `compaction/changes.md`.
- Prompt presets routinely append the shared `file-operations.ts` tuning block. Mirror this when adding GPT-5.x presets — see `prompt-preset/changes.md` 2026-05-07.
