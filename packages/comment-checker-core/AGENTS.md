# comment-checker-core — apply-patch Parser + Checker Runner (Core)

**Generated:** 2026-06-17

## OVERVIEW

Two responsibilities: (1) parse LLM apply-patch edits into structured `CheckerEdit[]`, and (2) run the external `@code-yeongyu/comment-checker` binary to detect AI-slop comments in changed code. Spawn is dependency-injected (not `child_process.spawn`) so both editions can drive the same core. Package: `@oh-my-opencode/comment-checker-core`.

## PUBLIC API (`src/index.ts`)

| Export | Source | Role |
|--------|--------|------|
| `parseApplyPatchRequests(patch)` | `apply-patch-edits.ts` | parse `*** Add/Update/Delete File:` + `*** Move to:` protocol with `@@` context + `+`/`-` markers |
| `extractApplyPatchEdits(details, args?)` | `apply-patch-edits.ts` | high-level extractor (patch text OR metadata files) |
| `getApplyPatchMetadataFiles(details)` | `apply-patch-edits.ts` | read files from nested `details.files` / `result.files` / `metadata.files` |
| `resolveCommentCheckerBinary(input)` | `runner.ts` | locate binary via `createRequire(@code-yeongyu/comment-checker)` |
| `runCommentChecker(input, options)` | `runner.ts` | pipe `HookInput` JSON to stdin, read stdout/stderr, return `CheckResult` |
| types (17) | `types.ts` | `CheckerEdit`, `HookInput`, `CheckResult`, `SpawnFn`/`SpawnProcess`/`SpawnSignal`, `ApplyPatchFileMetadata`, … |

## DEPENDENCIES & CONSUMERS

- **Depends on:** `@oh-my-opencode/utils` (`isRecord` from `utils/record-type-guard`).
- **Consumed by BOTH editions:** `omo-opencode/src/hooks/comment-checker/{hook,types,cli}.ts` and `omo-codex/plugin/components/comment-checker/src/{core,core-values,apply-patch,request-extractor}.ts`.

## NOTES

- **Exit-code contract:** `0` = clean, `2` = has comments; any other code / error / timeout silently returns `{hasComments: false, message: ""}`.
- **Spawn timeouts:** default 30s, 1s kill grace, SIGTERM→SIGKILL escalation.
- **`SpawnProcess` is an injected interface** — `stdin.write/end`, `ReadableStream<Uint8Array>` stdout/stderr, `exited: Promise<number>` — never the Node `ChildProcess` type directly.
- **`HookInput` mirrors OpenCode's `tool.execute.before` input schema** exactly, so the same parser serves the Codex `PreToolUse`/`PostToolUse` adapters.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
