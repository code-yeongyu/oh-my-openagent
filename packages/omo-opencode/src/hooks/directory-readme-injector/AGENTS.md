# directory-readme-injector — Local README Context

## OVERVIEW

Tool-guard hook that discovers README guidance near a read file and appends it to that tool's output. It fires on `tool.execute.after` for the `read` tool only; discovery, per-session caching, and injection formatting are separate modules.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook integration | `hook.ts` |
| Path and README discovery | `finder.ts` (`resolveFilePath`, `findReadmeMdUp`) |
| Storage path and filename | `constants.ts` |
| Context assembly | `injector.ts` |
| Per-session deduplication | `storage.ts` |
| Public exports | `index.ts` |

## CONVENTIONS

- Keep injection session-scoped: an in-memory cache plus `storage.ts` injected-path state prevent repeat injection, and both are cleared on `session.deleted` and `session.compacted`.
- Injected content is sized by `createDynamicTruncator`, so context-window state affects how much of a README is emitted.
- Discovery walks up from the resolved read path; `output.title` supplies that path.
- Keep filesystem access and injection assembly behind focused helpers so tests can use temporary directories.
- Tests use colocated Bun fixtures and assert the machine-consumed output shape.

## ANTI-PATTERNS

- Do not inject unrelated README files based only on filename text.
- Do not extend the trigger to write/edit tools without revisiting the dedup keys; the hook is deliberately read-only.
- Do not persist injected paths across sessions.
- Do not replace tool output when discovery fails; ordinary lookup failures should degrade without breaking the tool call.
