# src/tools/session-manager/ -- Session Read Tools + Dual Storage Backend

**Generated:** 2026-09-10

**Score:** 15 (15 files, ~2.7k LOC, own module boundary, >30 symbols, >10 exports; distinct domain: session persistence, not tool plumbing)

## OVERVIEW

The four `session_*` tools plus the only place in the plugin that reads OpenCode session storage two ways: SDK/SQLite first, file storage as fallback.

## STORAGE DISPATCH

`storage.ts` is the single dispatcher. Each read tries the SDK path when `isSqliteBackend()` and a client was registered via `setStorageClient()`, then falls back to files:

| Function | SDK path | Fallback trigger |
|----------|----------|------------------|
| `getMainSessions` / `getAllSessions` | SDK list merged with file list (SDK wins per id) | `isSessionSdkUnavailableError` (`sdk-unavailable.ts`) |
| `sessionExists` | SDK hit returns true | SDK miss or unavailable error |
| `readSessionMessages` / `readSessionTodos` | SDK result used only when non-empty | empty result or unavailable error |
| `readSessionTranscript` | none | always file storage |

`shouldFallbackFromSdkError` re-throws anything that is not a connectivity/timeout class error, so real failures stay visible.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Tool schemas, limits, DI seam | `tools.ts` (`SessionManagerToolDeps` overrides; search timeout 60s, at most 50 sessions scanned) |
| File-backed reads (messages, parts, todos, transcripts) | `file-storage.ts` + `constants.ts` (todos/transcripts live under the Claude config dir) |
| SDK-backed reads | `sdk-storage.ts` |
| Output rendering and search excerpting | `session-formatter.ts` |
| Multi-project filtering | `directory-filter.ts`; `storage.ts` treats directory `/` as "no filter" |

## CONVENTIONS

- Every tool returns a formatted string and converts thrown errors into `Error: ...` text; never let a storage error escape the tool.
- `createSessionManagerTools(ctx, deps)` takes a partial dependency record; tests substitute storage/formatter functions instead of module mocks.
- `setStorageClient` is called during tool construction; module-level client state is reset with `resetStorageClient()`.

## ANTI-PATTERNS

- Do not add a third storage path: extend `storage.ts` dispatch so SDK and file results stay merged and ordered by `time.updated`.
- Do not treat an empty SDK response as authoritative; the empty case intentionally falls through to file storage.
- Do not compare session directories with raw string equality; use `sessionDirectoriesMatch`.
