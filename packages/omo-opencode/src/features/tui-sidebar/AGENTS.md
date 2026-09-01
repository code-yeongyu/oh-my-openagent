# src/features/tui-sidebar/ — TUI Sidebar Snapshot + Mirror

**Generated:** 2026-08-17

## OVERVIEW

24 .ts files (12 impl + 12 co-located tests). Two halves connected only by a JSON mirror file on disk: the plugin process writes runtime snapshots (`TuiStateMirror`), the TUI process polls the mirror, derives section states, and renders sidebar nodes. Gated on `tui.sidebar.enabled` (on unless explicitly `false`).

## DATA FLOW

```
plugin side:  events/heartbeat → TuiStateMirror.flush() → buildTuiRuntimeSnapshot() → writeMirror() (atomic JSON)
TUI side:     1s poll → readMirror() → derivers → computeView() → viewKey diff → buildViewNodes() → sidebar_content
```

## STRUCTURE

| File | Purpose |
|------|---------|
| `mirror-manager.ts` | `TuiStateMirror` — debounced (250ms) flush, 2s heartbeat, single in-flight write, start/stop lifecycle |
| `snapshot-builder.ts` | `buildTuiRuntimeSnapshot` — active agents from session statuses, job board from `BackgroundManager.getTasksSnapshot()`, loop state; redacts `activeGoal` text before write |
| `snapshot-schema.ts` | Zod schema `TuiRuntimeSnapshotSchema` (version literal 1) + `parseSnapshot` |
| `mirror-io.ts` | `writeMirror` (atomic, mode 0600) / `readMirror` — rejects unparseable, wrong-project, or stale (>6s) snapshots |
| `mirror-path.ts` | XDG data dir + sha1(projectDir) prefix filename; `canonicalProjectDir` via realpath |
| `loop-reader.ts` | Reads `.omo/ulw-loop/*/goals.json` (v1 schema) + legacy `.omo/loop/goals.json`, freshest live loop wins; stale after 120s |
| `derivers.ts` | Snapshot → section states; jobs sorted by status priority (running first), caps MAX_AGENTS/MAX_JOBS = 12 |
| `compute-view.ts` | `computeView` picks active/broken/idle; `viewKey` gives stable string for re-render diffing |
| `render-view.ts` | `buildViewNodes` (themed box/text tree) + `describeView` (plain lines); 24-char label truncation |
| `state-types.ts` | Discriminated-union section states (`kind` tags) + `assertNever` |
| `roster-resolver.ts` | Idle-view model roster from config via doctor's model resolution |
| `element-helpers.ts` | `ViewNode` type + `box`/`text` constructors (renderer-agnostic) |
| `config-validator.ts` | Re-export of `validatePluginConfig` |
| `constants.ts` | All timing/size knobs: STALE_MS 6s, HEARTBEAT_MS 2s, POLL_INTERVAL_MS 1s, WRITE_DEBOUNCE_MS 250ms, LOOP_FRESH_MS 120s |

## KEY EXPORTS

- `TuiStateMirror` — constructed in `src/create-managers.ts` when sidebar enabled; deps injected (`client`, `backgroundManager`, optional `getStatuses`/`sessionAgentResolver`).
- `readMirror`, `computeView`, `viewKey`, `buildViewNodes`, derivers, `POLL_INTERVAL_MS` — consumed by `src/tui.ts` on the render side.
- `TuiRuntimeSnapshot` — the cross-process contract; bump `MIRROR_SCHEMA_VERSION` on shape changes (readers drop non-matching versions).

## LIFECYCLE / WIRING

- Writer: `create-managers.ts` instantiates the mirror; `onEvent()` triggers debounced flush, `start()` adds heartbeat, `stop()` clears timers and resolves pending flushes.
- Reader: `tui.ts` polls every 1s, re-renders only when `viewKey` changes, falls back to idle roster view (from local config) when the mirror is missing or stale.
- View selection: active if any of agents/jobs/loop is live; broken if config invalid and nothing active; idle otherwise.

## CONVENTIONS

- Every state is a `kind`-tagged union; exhaustive switches end in `assertNever`.
- Failure means degrade, never throw: bad JSON, missing files, stale data all collapse to `null` / `{ kind: "none" }`. Only non-Error throws are rethrown.
- All writes go through `writeFileAtomically`; readers validate version, project dir, and freshness before trusting the file.
- Privacy: goal titles are redacted to `null` before writing; render side shows "private".

## ANTI-PATTERNS

- Don't share memory between plugin and TUI sides; the mirror file is the only channel.
- Don't change snapshot shape without bumping `MIRROR_SCHEMA_VERSION`; old readers silently drop the file otherwise.
- Don't write the mirror directly; go through `TuiStateMirror.flush()` so debounce and in-flight dedup hold.
- Don't add new timing values inline; all knobs live in `constants.ts`.
