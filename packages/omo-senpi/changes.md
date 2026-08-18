## 2026-08-18 — Follow the Senpi 2026.8.18 host contract

The adapter peer and development dependency now require Senpi `2026.8.18`,
and the task engine's peer and development pins move with it. The 2026.8.18
host fixes extension widget stacking order: `setWidget` now replaces the
component in place, so the adapter's `omo-task` and `omo-dag` belowEditor
status widgets keep a constant vertical order while both live-refresh.

This bump does not add or alter adapter behavior beyond the inherited host
fix. The provider registry contract was re-verified: builtin provider IDs
are unchanged between 2026.8.17 and 2026.8.18. Conflict zones are the
adapter and task manifests, workspace lockfile, package-shape and senpi-pin
expectations, and committed extension bundles.

## 2026-08-17 — Follow the Senpi 2026.8.17 host contract

The adapter peer and development dependency now require Senpi `2026.8.17`,
and the task engine's peer and development pins move with it. Senpi's package
aliases resolve the matching 2026.8.17 AI, agent-core, TUI, PTY, telemetry,
and codemode companions; the separate Pi `0.84.2` compatibility line does
not change.

This bump does not add or alter adapter behavior. The generated plugin is
rebuilt only to prove the existing extension remains compatible with the new
host, and the provider registry contract confirms that builtin provider IDs
are unchanged. Conflict zones are the adapter and task manifests, workspace
lockfile, package-shape expectations, and committed extension bundles.

## 2026-08-17 — Count eval-internal tools without inventing savings

OmO Native now consumes Senpi 2026.8.16's in-process
`senpi.eval.execution` event and folds fixed scalar rollups into the existing
once-per-session `parallelism_summary`. `parallelism_v2` reports event-bus
coverage, accepted/rejected eval executions, nested tool status and duration
totals, top-level eval wrappers, and direct non-eval calls from mixed waves.

The existing pure non-eval wave, modeled saving, upper-bound, and saved
round-trip formulas are unchanged. Eval aggregate keys, arguments, paths, and
previews never cross the privacy boundary. Nested duration sums do not contain
enough interval information to infer concurrency or savings, and future
changes must preserve that distinction.

## 2026-08-16 — Follow the Senpi 2026.8.16 host contract

The adapter peer and development dependency now require Senpi `2026.8.16`,
and its direct Pi TUI dependency follows the `0.84.2` host line. The task
engine's optional Senpi and Pi TUI peers move in lockstep so the adapter,
process children, and generated plugin bundle compile against one host
contract.

The workspace lockfile and committed plugin artifacts must be regenerated
with the new engine. The provider-map registry test remains the authority for
whether Senpi's builtin provider set changed.

The task lifecycle QA now performs `task_output(mode:"tail")` as the immediate
tool boundary after `task_send`. The old sequence ended the parent turn with
text first and incorrectly relied on another wake, so both the old and new
Senpi pins could finish every real task transition while the harness reported
a false `task_output_peek` failure.

## 2026-08-13 — Follow the Senpi 2026.8.13 host contract

The adapter peer and development dependency now require Senpi `2026.8.13`.
The workspace lockfile now resolves the matching Senpi package family,
including the host's telemetry package alias.

Keep the peer and development pins exact and aligned with the root, OMO Native,
and senpi-task manifests. A pin-only edit without the matching lockfile is not
a complete adapter update.

## 2026-08-12 — Publish and control native tasks over RPC

The task component now emits every available child-session, result, error, persisted/live run-stat,
and semantic live-progress field through `omo.task.updated`. It owns one deduplicated child
subscription per live resident task and releases subscriptions when a task settles, leaves the
session, or the session shuts down.

Modern Senpi hosts also receive session-scoped `omo.task.output`, `omo.task.send`, and
`omo.task.cancel` request handlers. These handlers reuse the existing task tool policies, reject
malformed or foreign-session requests, never enable `all_scope`, and remain an optional no-op on
older hosts that expose only `pi.rpc.emit`.

Future changes must preserve the single live-subscription owner, semantic snapshot deduplication,
parent-session scoping, and old-host compatibility.

## 2026-08-06 — Refresh local Senpi installs before activation

Source installs now rebuild every generated OMO Senpi artifact even when the previous bundle is
complete, and they replace older settings entries whose package manifest is also
`@code-yeongyu/omo-senpi`. This prevents a copied, stale extension from continuing to run legacy
task lifecycle code after the source tree has gained crash-revival fixes.

Keep the distinction between source and packed installs: source installs must refresh generated
artifacts, while packed installs must verify their immutable staged artifacts without attempting a
build. Do not remove package-identity replacement; loading stale and current OMO package paths
together can register duplicate components and retain obsolete task behavior.

The parent-restart QA driver proves the integration boundary by SIGKILLing a real Senpi parent,
reopening the same session and task state, and requiring the original in-process child task to
continue without becoming `lost`. It also verifies process and temporary sandbox cleanup.

## 2026-08-12 — Fence and bound desktop task RPC

Task RPC controls now remain unavailable until a parent session is attached, detach before a
session switch, and stay fenced after shutdown. Cancellation accepts exact task ids only, performs
the current-parent ownership check before the shared cancel path, and redacts foreign-session
details. Messages, reasons, task collections, terminal results, and errors are bounded with explicit
snapshot truncation metadata; terminal records prefer durable run stats over retained live trackers.

The packaged extension now lazy-loads the task component through the generated `omo-task.js`
sidecar. Build freshness and import-purity checks cover both artifacts, while source tests keep the
normal static component entrypoint. Preserve the `#omo-task-runtime` package import mapping and do
not fold the task sidecar back into `omo.js`; the main artifact must remain below its fixed
900,000-byte budget.

## 2026-08-12 — Harden task RPC installation and output boundaries

Packed installs now require both lazy task and member extension artifacts before mutating Senpi
settings. Task controls cap identifiers and tail requests, return the same generic not-found result
for foreign and absent task ids, and bound every task snapshot/status string exposed to RPC clients.
Terminal results, errors, and descriptions carry explicit truncation flags.

Keep authorization checks before the shared name-capable task control paths, and keep the generated
installer synchronized with `install-senpi.ts`. A missing `omo-task.js` must fail installation rather
than silently disabling the task component at activation time.

The adapter peer and development dependency now require Senpi `2026.8.11-6`; this is the first
published host contract with request handler registration and client-side extension requests.

## 2026-08-12 — Anchor task state at the session cwd, not the process launch dir

The task component resolved its project root from `process.cwd()`. In a multi-session host - one
shared senpi process serving every session, as the OmO desktop rpc child does - that is the process
LAUNCH directory, not the session's project root. Every session therefore shared a single task
store, records from unrelated projects interleaved in it, and child artifacts landed where the
host's per-project readers (`<projectDir>/.omo/senpi-task`) never look.

`register` now takes the cwd the host reports for THIS session (`cwd` on the extension API), and
falls back to `process.cwd()` only for hosts that predate it. Everything downstream - the record
store, the `omo.json` load, team runtime dirs and the resumption channels - derives from that one
value, so they all follow the session.

Keep the fallback until the minimum supported Senpi guarantees `cwd`, and keep resolving the cwd
ONCE at register: re-reading it later would let a session's store move mid-flight.
