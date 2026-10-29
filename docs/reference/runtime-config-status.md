# Runtime model configuration status

The OpenCode adapter has transport-independent helpers for a trusted in-process
consumer. A future configuration UI can combine the declaration editor backend
with runtime status without interpreting log messages. These helpers do not
register a server, endpoint, global registry or cross-process connection.

## Saved declarations and runtime acceptance

`plugin/runtime-model-config.ts` exports `createRuntimeModelConfigLoader`. Its
existing callable form still validates the saved configuration and returns the
latest accepted agents/categories snapshot, retaining the last good snapshot
when validation rejects a candidate. It now also exposes:

| Method | Reads saved configuration | Accepts a new runtime snapshot | Result |
| --- | --- | --- | --- |
| `load()` (the returned function) | Yes | If valid with no ignored values | The accepted model configuration |
| `load.status()` | No | No | Accepted revision and last reload outcome |
| `load.inspect()` | Yes | No | Status plus saved candidate validity and whether it matches the accepted snapshot |

`acceptedRevision` starts at 1 and increases when the accepted agents/categories
snapshot changes. Repeated acceptance of an identical snapshot keeps the same
revision. This counter belongs to one loader lifetime; it is neither a file
version nor a persistent revision. A process restart or new profile selection
creates a new loader. Do not compare counters across loaders.

`lastReload.outcome` is `startup`, `accepted` or `rejected`. `startup` means the
loader has not attempted a reload since receiving its initial snapshot; a
session selection validates that initial snapshot before constructing its
loader. An observation never changes `lastReload` or `acceptedRevision`.

`saved.valid` is false for malformed input, invalid values that the normal
startup loader would prune, unknown fields and read failures.
This strict acceptance policy applies to explicit profile selections. Default
delegation keeps the startup validator's best-effort behavior: sanitized
agents/categories still reload when other settings are ignored or unknown.
For that loader, `saved.valid` means a sanitized candidate can be accepted;
diagnostics remain visible even on acceptance. Unexpected validation exceptions
still retain the previous snapshot.
`saved.matchesAccepted` is `null` for a rejected candidate, otherwise a boolean
comparison of the effective agents/categories snapshot. It does not compare raw
file bytes, comments, or unrelated hook/provider settings. An edit may remain
pending until a subsequent dispatch reads it. Acceptance covers model routing
only: startup agent registrations, hooks and providers retain their startup
settings, and requests/child continuations already resolved keep their snapshots.

Primary request snapshots retain active work rather than completed turn history.
Terminal assistant success or failure releases the snapshot after its event
handlers finish. A queued or accepted runtime fallback owns the exact original
user-message snapshot until that request resumes, is removed, or is superseded
by an accepted recovery. Abort and timeout work also retain ownership across
asynchronous operations. Record identity and retry generations prevent late
completion, deletion, or acknowledgement from releasing a newer request.
Intermediate tool steps and nonterminal updates do not release active snapshots.

Diagnostics expose only `{ code, count }`:

| Code | Meaning |
| --- | --- |
| `validation-error` | The candidate failed validation or has unrecognized configuration fields |
| `ignored-value` | At least one value would have been ignored or pruned |
| `read-failed` | Candidate validation unexpectedly threw |

The status DTO contains no configuration values, file paths, raw exceptions or
validation messages. Counts are diagnostic counts, not distinct file counts.
Runtime rejection logs use the same redacted diagnostics. A consumer needing
declaration details must use an explicitly authorized editor/source-map view.

## Session capabilities

`createSessionModelProfiles(...)` in `plugin/session-model-profiles.ts` returns
the existing `inspect`, `select`, `command`, `load` and request snapshot helpers,
plus:

- `inspectRuntime(sessionID)` returns `{ ok: true, sessionID, source, ...status }`.
  It resolves a child to its parent selection and observes the matching saved
  candidate. `source` is `session` for a named session override and `startup`
  otherwise. Session-resolution failures return
  `{ ok: false, error: { code: "session-unavailable" } }`.
- `control(sessionID, profile)` accepts a nonblank, unpadded profile name or
  `null` to restore the startup selector. It returns `{ ok: true }` on success;
  malformed names return `invalid-profile`, while missing profiles, invalid
  candidates, attempts to switch a child session, and failed selection callbacks
  return `selection-rejected` in the same error DTO shape. No raw error is
  returned. Failed selection preserves the previous selector and runtime loader.

`control` changes only the instance's selector. It does not write configuration
files or environment variables. Existing `inspect` remains the declaration-name
listing API; the new status DTO deliberately excludes names and model values.
Unselected sessions share the instance's startup loader, as before; named
selections have their own loader. Clearing a selection returns to the captured
startup environment and resets that selection's revision counter.

These are instance-local capabilities. A separately constructed manager cannot
inspect or control the private manager inside a running plugin instance. The
current plugin entry does not publish its manager. A future adapter must obtain
the actual instance explicitly and provide its own authentication, session
ownership checks and transport. `readSession` is a trusted callback, not an
authorization mechanism. Status observation may cache session ancestry but does
not alter selection, accepted configuration or request snapshots.

## Composing an editor

The included terminal-independent `cli/config-editor/backend.ts` API handles
staged declaration edits, validation, safe saves and named-profile creation,
copying and deletion. Both the terminal editor and future trusted in-process
adapters can reuse this backend for a selected, authorized file. Save success
means the declaration reached disk; it does not mean a running instance accepted
it. Observe `inspectRuntime` after saving and after subsequent dispatches to show
the difference.

Editor sessions are trusted mutable in-process objects, not transport DTOs. A
transport should keep them private, constrain target and field access, and return
only deliberately chosen values/errors. The writer's backup, permissions and
concurrent-change refusal remain separate from runtime acceptance. No HTTP
security boundary is supplied by these internal helpers.
