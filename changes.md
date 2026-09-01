## 2026-09-01 — Defer bind-time reflection reconciliation on scheduler contention

Session-start reflection reconciliation now uses a zero-wait scheduler lock and defers when a sibling session is already scheduling the same memory identity. Normal reflection reservation and completion paths retain their existing serialized wait budget.

## 2026-08-28 — Pin Senpi 2026.8.28-2 for the shared interactive host hotfix

`packages/omo-native/package.json`, `packages/omo-senpi/package.json`, and the
root `package.json` now require the exact published `@code-yeongyu/senpi`
`2026.8.28` release. The engine hotfix repairs the beta.23 shared-host
regressions: Shift+Tab no longer prints `Thinking level: [object Promise]`
and the low/med/high options render again, user messages no longer render
twice, and resuming a session held by a live shared host attaches instead of
failing with `session_path_in_use`. The release also carries the compiled
eval-kernel asset resolution fix, restoring the JavaScript and Python eval
kernels in compiled binaries.

## 2026-08-27 — Keep Windows persistence and DAP paths portable

The shared atomic-write helper now opens temporary files with a writable
descriptor, tolerates filesystem-specific `fsync` limitations, uses unique
temporary names, and skips parent-directory `fsync` on Windows where directory
handles reject that operation. The thread mailbox and durable receipt stores
now use that helper rather than maintaining divergent atomic-write code.

The zero-dependency DAP client now accepts only numeric `host:port` strings as
socket adapter specs. Windows drive-letter paths such as
`C:\workspace\fixture-adapter.mjs` remain executable script paths. This fixes
the real adapter launch path without increasing polling deadlines or masking
transport errors.

Focused regression coverage includes the real DAP fixture session, Windows
drive-letter classification, atomic-write replacement with injected `EPERM`
from `fsync`, mailbox persistence, and durable receipt lifecycle behavior.

## 2026-08-27 — Keep platform smoke tests aligned with runtime requirements

The release-binary smoke harness now exports `USERPROFILE` alongside the
isolated Git Bash `HOME` on Windows so Node's `os.homedir()` resolves the same
directory used by the provisioning assertion. Linux x64 musl smoke now installs
the binary's required `libstdc++` runtime package inside Alpine before running
the version check. These changes keep the smoke gate strict while matching the
actual Windows home-directory and musl runtime contracts.

The compiled OmO launcher now materializes its first-run Windows executable by
copying it directly with the platform file-copy API, because Windows rejects
renaming a newly copied `.exe` into place with `EPERM` even when the
destination did not previously exist. POSIX keeps the temporary-copy and
atomic-rename path. Both branches retain hash-checked provisioning and cleanup.
The compiled Windows child now identifies its launched executable from
`process.argv[0]` rather than Bun's original compile path, preventing repeated
self-provisioning and the resulting `AssignProcessToJobObject` loop. Windows
first-run provisioning now continues in-process after materialization, while
POSIX keeps the child reexec handoff.
The dedicated Linux arm64 Alpine smoke lane now installs `libstdc++` before
executing the musl binary, matching the x64 musl smoke contract.

Windows CI now gives the Codex installer integration test and the seven-node
DAG failure E2E their observed platform-specific execution budgets. The
assertions and event-driven behavior remain unchanged; only the test harness
deadlines are widened from the prior 60-second and 15-second ceilings that
expired on the full Windows matrix.

## 2026-08-27 — Keep Windows LSP daemon stamping safe with spaced runtimes

The LSP daemon build helper now disables shell execution when invoking an
absolute runtime path such as `C:\Program Files\nodejs\node.exe`, while keeping
shell lookup for bare `tsc` and `bun` commands on Windows. The release builder
therefore reaches the version-stamping step instead of letting the shell split
the runtime path at `C:\Program`. The command-policy regression tests cover
absolute Windows paths, bare package commands, and POSIX execution.
## 2026-08-27 — Record post-beta.23 merged follow-ups

The root product changelog now records the pull requests merged after the
beta.23 release note was authored: LSP formatting and resident-client caps
(`#7428`), config-watch duplicate-load stand-down (`#7420`), the Codex GPT-5.6
650k context-window contract (`#7429`), Windows portability and the beta.23
source-state merge (`#7432`, `#7427`), and the Senpi daemon-first
post-mutation pipeline (`#7430`). The entries include their merge commits so
the release note remains traceable to the final `dev` history.

## 2026-08-27 — Release OmO Native beta.23 with Senpi 2026.8.27

This release advances the OmO Native engine contract from Senpi `2026.8.26-2`
to `2026.8.27`. The version is exact-pinned in the native package, adapter
peers, task runtime, package-shape contracts, compiled-entry fixtures, and
the generated dependency lock. The package remains beta-channel-only:
install or upgrade it with `npm i -g omo-ai@beta` or the equivalent Bun
command; the intentionally unchanged `latest` tag is not the update channel.

### JavaScript-first eval composition

The eval guidance now teaches JavaScript as the primary composition surface.
The first example cell establishes state in the persistent JavaScript kernel;
the next example fans out independent session-tool calls with
`await Promise.all(...)`; a later example shows the explicit cross-language
escape hatch when the JavaScript kernel is occupied by detached work. This
aligns the examples with the runtime's persistent-kernel and bounded-parallel
execution model, allowing an agent to reuse state and schedule independent
work without first translating the workflow into a separate shell script.

`parallel(thunks)` executes asynchronous thunks through a bounded worker pool
and preserves result order while allowing concurrent progress. The default
pool width is four, and `pipeline(items, ...stages)` creates sequential stage
barriers while using the same bounded fan-out inside each stage. This note
does not claim a percentage speedup: the repository contains instrumentation
for wall-clock savings and round-trip counts, but no committed cross-version
benchmark that would justify one.

### Persistent JavaScript kernel state

JavaScript cells continue to share one session-scoped kernel, so values
created in one cell remain available to the next cell. State persistence now
rewrites only top-level declarations, including destructuring bindings and
uninitialized declarations, while leaving declaration-shaped text inside
strings, comments, and nested function bodies untouched. This makes the
state-carrying transform safe for examples, templates, regular expressions,
and nested implementation snippets.

The JavaScript worker path remains the normal execution mode. When the worker
entry cannot be loaded, the runtime can use its controlled inline fallback;
the fallback preserves the language-level contract without requiring a
build-time worker file to remain at its original source path. Kernel state is
isolated per language, so resetting a Python kernel does not reset JavaScript
state.

### Busy kernels and cross-language continuation

A detached cell keeps its language kernel busy until it reaches a terminal
state. A second eval request in that language receives a diagnostic that
identifies the occupied cell and its available output context, then lists
each idle enabled kernel that can continue the work. This converts a vague
same-language contention error into an explicit scheduling decision. If no
other interpreter is idle, the diagnostic does not invent an escape route.

JavaScript is always available on supported Node runtimes. Python, Ruby, and
Julia remain optional capability-gated interpreters: their absence is
reported as a capability gap rather than making the JavaScript path
unavailable. This preserves a fast default while keeping polyglot workflows
possible when the corresponding interpreter is installed.

### Detached-cell lifecycle and diagnostics

Detached execution remains an explicit lifecycle rather than a hidden
background promise. A cell can be created, started, detached, completed,
failed, stopped, or inspected through `peek`; each terminal transition is
reported once. Completion notifications are delivered as internal,
model-visible messages instead of synthetic user-input queue entries, so
background eval status cannot masquerade as a user steering message.

Detached overflow notices carry plain absolute spill paths, which the regular
agent read surface can consume directly. The `local://` scheme remains an
in-cell kernel helper for session-local artifacts and is not presented as an
agent-facing file path. A wall-clock hard limit, defaulting to 1800 seconds,
continues to run across detachment and bridge calls; reaching it interrupts
the cell and settles it as cancelled instead of leaving unbounded work
behind.

### Tool orchestration and observability

Tools invoked from inside an eval cell continue through the session's real
tool execution surface. Reserved helpers such as `agent`, `output`, and
`tool_schema` use their dedicated bridge path, while recursive eval remains
rejected. The runtime records one bounded `senpi.eval.execution` event per
settled cell, including wall time, kernel time, terminal status, detached
status, nested tool-call counts, and bounded per-tool aggregates. The
external projection excludes prompts, arguments, call identifiers, errors,
and result previews.

The OmO Native telemetry adapter accepts versioned full-detail eval events,
reduces them to scalar rollups, correlates cells to their owning sessions,
and fails closed on duplicate ownership or malformed metadata. Eval-only
waves remain separated from non-eval waves so modeled savings cannot be
inflated by mixing unlike execution modes. These metrics make composition
behavior observable without turning an unmeasured model into a promised
benchmark.

### Failure recovery and compatibility

The JavaScript kernel recovers from worker crashes by settling the active
cell, retiring the failed worker, and preparing a fresh worker for the next
cell. Session-generation fencing prevents callbacks from retired sessions
from emitting into a newer session. Subprocess-backed languages continue to
gate execution on interpreter readiness so startup time does not consume the
cell's execution budget.

The supported runtime contract remains Node `>=24`. JavaScript is available
without a separately installed interpreter; optional languages are detected
independently. OmO Native's launcher continues to support explicit runtime
selection through `OMO_RUNTIME=node` or `OMO_RUNTIME=bun`, with loop guards
preventing accidental re-execution of an already selected runtime. Bun 1.4
remains the release/build toolchain, while the codemode package keeps its
Node-compatible boundary and does not depend on Bun-only APIs.

### Upgrade and verification notes

This is a package-chain update, not a session-data reset. Existing settings,
credentials, sessions, permissions, and enabled extensions remain outside the
package replacement. The exact Senpi version is carried consistently through
the native runtime, adapter peer/dev dependencies, task-engine pins,
compiled-entry identity tests, and lockfile.

The release was verified against the Senpi `2026.8.27` registry identity and
isolated CLI checks, OmO Native package-shape and pin contracts, the
Senpi-adapter test suite, strict type checking, native payload staging, and
the compiled runtime identity check. No percentage latency claim is made
because no cross-version benchmark is committed; users can inspect the
versioned eval telemetry for their own workloads.

## 2026-08-26 — Stop the omo launcher from orphaning its engine

The MCP environment cleaner now accepts an optional ambient environment map,
so callers and tests can represent absent variables without mutating
`process.env`; the default runtime path remains unchanged. This keeps
undefined environment entries out of spawned stdio MCP environments across
Bun platforms.

The native launcher chain blocked in `spawnSync` at both of its layers: `bin/omo.js` waiting on the
engine, and the bun re-exec waiting on the bun launcher. No JavaScript runs while `spawnSync`
blocks, so a launcher that received `SIGTERM` died on the spot and the engine below it was
reparented to pid 1, still holding the terminal and still running. Those orphans are what later
surface as stdin `EIO` crashes and as engine processes lingering for days.

Both layers now go through one asynchronous spawn helper. It forwards `SIGTERM` and `SIGHUP` to the
child, waits for the child to finish its own shutdown within a bounded grace window (10 seconds,
overridable with `OMO_SIGNAL_GRACE_MS`), and re-raises the signal on itself if the child ignores it,
so a supervisor still observes the death it asked for. `SIGINT` is not forwarded, because the tty
delivers it to the entire foreground process group already and a second delivery would interrupt the
engine twice; the launcher merely stops dying underneath it. Exit-status fidelity is unchanged - the
child's exit code passes through, and a child killed by a signal still makes the launcher die by
that same signal. Windows installs no signal handlers, where POSIX signal delivery does not exist.

`omo doctor` now also names the orphans that earlier launcher versions left behind: interactive
engine processes reparented to pid 1, reported with pid, age and tty. Cleaning them up is an
explicit per-pid action, `omo doctor --reap <pid> [pid...]`, which re-reads the live process table
and refuses any pid that is not an orphaned interactive engine at that moment - a live session, an
`--mode` rpc or app-server engine, or anything that is not an engine at all. There is deliberately
no pattern-matching kill.

Real-surface QA drives the whole chain on a pty whose session leader outlives the launcher (so the
kernel's own `SIGHUP` on session teardown cannot be mistaken for a fix), on both the node chain and
the three-deep bun chain a `bun add -g omo-ai` install has. Evidence:
`.omo/evidence/20260826-launcher-signal-forward/`.

## 2026-08-26 — Release OmO beta.21 with Senpi 2026.8.26

Hotfix release: OmO release metadata and platform package pins advance from
beta.20 to beta.21 with the Senpi contract aligned to `@code-yeongyu/senpi`
2026.8.26 (compaction liveness + anthropic sdk peer alignment), carrying the
pi-tui/senpi cross-bundle lazy warm-up fix and status-widget render containment
from #7354. The Bun lockfile is regenerated for the exact release dependency
graph.

## 2026-08-25 — Release OmO beta.20 with Senpi 2026.8.25

OmO release metadata and platform package pins advance from beta.19 to beta.20,
with the native, adapter, task-engine, and package-shape Senpi contract aligned to
`@code-yeongyu/senpi` 2026.8.25. The Bun lockfile is regenerated for the exact
release dependency graph.

The committed Senpi extension and Codex installer bundles were regenerated after
the provenance-safe CI gate reported stale generated output for the beta.20
release-state SHA. The generated payloads now match the release metadata and
must remain synchronized with the exact Senpi dependency and skill inventory.

The staged native-payload test now normalizes Windows CRLF before checking the
shipped `.gitignore` contract. The file content remains `/plugin/`; checkout
line-ending policy no longer creates a false release-gate failure on Windows.

The embedded-runtime provisioning test now treats POSIX file mode assertions as
POSIX-only. Windows does not expose the same `0o644` mode bits, while byte
content, SHA-256 validation, and marker-based skip behavior remain covered.

## 2026-08-24 — Pin OmO beta.19 to Senpi 2026.8.24

The OmO Native launcher, adapter peers/dev dependencies, task engine, root
development dependency, and package-shape tests now move in lockstep to
`@code-yeongyu/senpi` 2026.8.24. This release carries the Bun 1.4 redirect-body
cleanup fix for environments whose Undici body lacks `dump()`, plus the audited
Senpi dependency refresh.

The exact pin is part of the shipped runtime contract and is synchronized before
the beta.19 publishing workflow stamps package versions.

## 2026-08-24 — Refresh compatible dependencies

The beta.19 release refreshes the compatible direct dependency lines used by the
OpenCode, TUI, matching, telemetry, and Senpi adapter surfaces: OpenCode
SDK/plugin 1.18.22, OpenTUI 0.5.8, Picomatch 4.0.7, PostHog Node 5.51.1, and
TypeBox 1.3.18. The Bun lockfile is regenerated from those manifest pins.
The dependency security and Codex component package-shape tests now assert the
new Picomatch 4.0.7 floor instead of pinning the previous safe floor.

The clean-install warnings reported against beta.18 were also reproduced and
audited. Bun intentionally does not let a dependency grant trust to its own
transitive lifecycle scripts, so adding package-local `trustedDependencies`
would be ineffective and was rejected. `@google/genai` runs a declared no-op
preinstall and `protobufjs` runs a compatibility-warning-only postinstall; both
are safe to leave blocked. The Anthropic peer warning remains an intentional
tradeoff: the required `@anthropic-ai/sdk >=0.93.0` line pulls Node credential
modules into the browser bundle, while the retained 0.91.1 pin passes the
browser-safety gate.


## 2026-08-23 — Surface attribution + shared install id on every omo-native event (schema v3)

**What:** `OMO_NATIVE_SCHEMA_VERSION` bumps to 3. `telemetry-core` event clients spread
`product.additionalProperties` into the shared property block (fixed identity keys still win).
`product-identity.ts` gains `getOmoNativeAttribution`/`withOmoNativeAttribution`: `surface`
(`cli` | `desktop`, from `OMO_NATIVE_SURFACE`) and `install_id` (random 64-hex file beside the
session-id salt; `OMO_NATIVE_INSTALL_ID` env wins when valid). Both the session client and the
component's privacy facade attach them, so every event carries attribution. Test fixtures
(`withTempAgentDir`, `useTemporaryAgentDir`) now pin all three agent-dir env names — an ambient
`OMO_CODING_AGENT_DIR` used to leak real-home writes out of tests. Docs updated in
`docs/reference/senpi-telemetry.md`.

**Why:** The OmO Desktop app drives the bundled runtime over RPC; without attribution those
turns counted as CLI adoption and the 264 RPC users could not be split. The install id is the
agent-home file shared with the desktop host, so CLI and Desktop join without deriving anything
from the machine.

**A future refactor or sync must not break:** attribution must never derive from hostname,
hardware, or accounts; keep both capture paths (session client + facade) attributed or events
disagree about their own schema.
## 2026-08-20 — Demand parent-side verification of DAG completions

A DAG node's completion summary was delivered to the orchestrating parent as if
it were established fact, so a node that overstated or fabricated its work could
satisfy the parent without a single artifact being read. Model-facing DAG
completion payloads now carry an explicit verification directive: reconstruct the
node's owed scope from its prompt, open the files and run the commands it claims,
verify each deliverable with the parent's own tool calls, and send corrective
instructions back to the same node until that verification passes.

`CompletionDetails` gains an optional `dag` block (`run_id`, `node_id`) sourced
from the task record's DAG owner, so the parent can address the exact node it
must correct. `buildCompletionMessage` appends the directive once per message
whenever any batched detail is DAG-owned, and run-level terminal wakes
(completed, failed, cancelled) append it to their injection content. A plain
non-DAG completion keeps byte-identical content, and `dag.run.paused` stays
directive-free because a pause is not a completion claim. The width-rendered TUI
path is untouched: `completionMessageLines` and the task-completion renderer
still render from `details`, so this changes only what the model reads.

## 2026-08-18 — Rebuild the Sisyphus runtime prompt on same-family model switches

The Sisyphus runtime prompt reconciler skipped every rebuild whose runtime
model shared the configured model's broad prompt family. The `fallback`
family is not prompt-uniform: `buildFallbackSisyphusPrompt` applies
Gemini-specific override blocks, and other families bake model-dependent
sections (GPT identity text, claude/non-claude planner sections). Switching
between same-family models in the TUI (e.g. Gemini -> MiniMax-M3 or
DeepSeek -> MiniMax-M3) therefore kept the previous model's baked prompt in
place, and the active model reported a stale identity (issue #6966).

The reconciler now skips only when the runtime model is exactly the model the
baked prompt was built for, and the existing rebuilt-versus-baked equality
check suppresses genuine no-op switches (DeepSeek and MiniMax bake
byte-identical fallback bodies, verified against the real prompt builder).
The system-transform handler canonicalizes the opencode hook model record to
`<providerID>/<id>` so bare builtin-provider ids compare exactly. Rebuild work
per request is unchanged for cross-family switches; same-family switches now
rebuild like cross-family ones already did.

## 2026-08-18 — Respect user permission.task on OMO main agents

`applyToolConfig` built the permission object for sisyphus, atlas, hephaestus,
and prometheus by spreading the agent's existing permission first and then
hardcoding `task: "allow"` on top, so any user-configured `permission.task`
was silently discarded while the config looked applied. The default is now
injected before the spread, which keeps `task: "allow"` when the user
configured nothing and lets an explicit user value win otherwise.

The plugin-injected rules that fence delegation (`call_omo_agent: "deny"`,
`task_*`, `teammate`, todo denials, prometheus bash denials) still apply after
the user permission, so only the `task` default changed precedence. Verified
against a real isolated `opencode serve` boot with a user-layer
`[opencode].agents.<agent>.permission.task` override for all four agents, plus
a negative-control boot without user config. Object mappings for
`permission.task` and a configurable deny list remain follow-ups tracked in
the issue.

## 2026-08-18 — Resolve configured category model chains against availability

OpenCode category `models` chains now skip entries that are absent from the connected provider catalog before creating the delegated session. The configured order and per-entry settings remain intact, and fuzzy-normalized model IDs resolve to the provider's available spelling instead of being discarded.

When no configured entry is available, delegation still fails rather than selecting an unrelated default, but the error now names the complete configured chain. Cold-cache behavior remains unchanged until an availability catalog exists.

## 2026-08-17 — Track Senpi 2026.8.17 for the omo-ai beta line

All active native Senpi pins now use `2026.8.17` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The lockfile resolves the complete 2026.8.17 companion family while
the existing Pi `0.84.2` compatibility overrides remain unchanged because
the upstream manifest changed only its Senpi package aliases.

The hand-derived provider registry was checked against the new engine. Its
provider IDs are unchanged, while the upstream Cerebras catalog no longer
advertises `zai-glm-4.7`; only the derivation version changes locally. This is
a host dependency update, not an OMO extension behavior change, so extension
source stays untouched and committed bundles are refreshed only from the
normal build. Conflict zones are the exact manifest pins, `bun.lock`, the
provider-map derivation comment, and generated Senpi extension artifacts.

## 2026-08-18 — Ship @babel/parser with omo-ai for bundled Senpi codemode

`@code-yeongyu/senpi@2026.8.16` bundles the source-only
`@code-yeongyu/senpi-codemode` extension but its bundled-dependency closure
omits the Babel parser that `senpi-codemode/src/kernels/js/rewrite-imports.ts`
imports at runtime. Clean `omo-ai` installs therefore logged a non-fatal
`Failed to load extension ... Cannot find module '@babel/parser'` warning at
boot and silently lost codemode/eval surfaces (verified on a real isolated
`omo-ai@5.0.0-0.beta.8` install: 43 extensions loaded, `senpi-codemode`
absent).

`omo-ai` now declares `@babel/parser@8.0.4` as a direct exact-pinned runtime
dependency. npm installs the full transitive Babel closure next to Senpi, so
the bundled codemode extension resolves its import and loads enabled. This is
a deliberately duplicative downstream compatibility dependency until Senpi
publishes a complete bundle; remove it at the next Senpi pin bump only after
isolated packed-install and RPC boot QA prove the upstream fix.

## 2026-08-17 — Make explicit beta publication ownership-safe

The synchronized `/publish` command and skill now accept an exact semantic version in addition to `patch`, `minor`, and `major`. Exact versions are dispatched through the workflow's `version` input, and the returned workflow run ID is the sole owner followed through release completion; latest-run inference is no longer part of the command.

Prerelease changelogs now compare against the preceding release in the same channel, and GitHub releases explicitly carry prerelease metadata. Stable bump behavior remains unchanged. Senpi RPC model admission diagnostics also report the probed catalog size and child stderr tail while the launch-parity test keeps its process environment fixed at module load.

## 2026-08-16 — Track Senpi 2026.8.16 for the omo-ai beta line

All active native Senpi pins now use `2026.8.16` across the root workspace,
the `omo-ai` launcher package, the OMO Senpi adapter, and the Senpi task
engine. The companion Pi compatibility line moves from `0.84.1` to `0.84.2`
to match the upstream host contract incorporated by this Senpi release.

The workspace lockfile, manifest-shape tests, and builtin-provider map move
with the exact engine pin. Senpi 2026.8.16 adds Cursor as a builtin
authentication provider, so the native provider map now includes `cursor`.
Keep these surfaces aligned whenever Senpi changes; a manifest-only update is
incomplete because the published native payload and generated adapter bundle
consume the resolved dependency graph.

## 2026-08-13 — Track Senpi 2026.8.13 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.13` across the root, native
launcher, OmO Senpi adapter, and task engine. Senpi 2026.8.13 adds `baseten`
and `qwen-token-plan-individual`; this update also synchronizes the local map
with the already-available `opengateway` provider. Keep
`packages/omo-native/bin/lib/provider-map.json` synchronized with
`builtinProviders()` whenever the shared pin moves.

The lockfile must move with the exact pins. The focused pin tests continue to
reject manifest drift, while the provider-map contract now compares the local
map directly with the installed engine registry.

## 2026-08-06 — Model packed Senpi installs in compatibility fixtures

The root Senpi compatibility fixture now passes the packed plugin path explicitly when exercising
`runSenpiInstaller`. This keeps the hermetic packed-layout test on the immutable verification path
after source installs began rebuilding generated artifacts unconditionally.

Future compatibility fixtures must choose the installer mode deliberately: omit `pluginPath` only
for a real source-tree refresh, and provide it when modeling a published or packed plugin.

## 2026-08-11 — Publish native task lifecycle snapshots over RPC

The OmO Senpi task component now emits safe `omo.task.updated` snapshots on session start and every
task-store mutation. Snapshots are scoped to the captured parent session and include only display,
model, lifecycle, residency, timing, and optional terminal run-stat fields; durable notification and
root-session bookkeeping must never cross the RPC boundary. Older Senpi hosts without `pi.rpc`
remain a no-op compatibility path.

## 2026-08-12 — Require the request-capable Senpi release

All native Senpi workspace pins now use `2026.8.11-6`, the first published release that exposes
`pi.rpc.handle`, `extension_request`, and `RpcClient.requestExtension`. Earlier releases can still
receive extension events but cannot serve desktop task send/cancel/output requests.

Keep the root, native launcher, OmO Senpi adapter, and task engine pins aligned. Downgrading any one
of them to an emit-only host silently turns the interactive task panel back into telemetry-only UI.

## 2026-08-12 — Track Senpi 2026.8.12-4 for the omo-ai beta line

All native Senpi workspace pins now use `2026.8.12-4` (root, native launcher, OmO Senpi adapter, and
task engine), moving the omo-ai 5.0.0 beta line onto the Senpi 2026.8.12 engine train. The
four-surface alignment rule above still holds: `packages/omo-native/test/senpi-pin.test.ts` fails any
manifest that drifts from the shared pin, so all four move in one commit.

## 2026-08-13 — Record the OmO 5.0.0 beta.7 release

Release PR #6797 merged the `v5.0.0-beta.7` source state at
`923726cdeb0bd0c1d60cdf83dc4cf6fe1117a548` and published
`omo-ai@5.0.0-0.beta.7`. The published package pins
`@code-yeongyu/senpi@2026.8.12-4`; future release preparation must keep the
root, `omo-native`, `omo-senpi`, `senpi-task`, lockfile, generated extension
bundle, and pin tests aligned before tagging.

The release also includes `d694add58dd1` (`fix(omo-native): emit doctor report
atomically`). Doctor output now becomes visible only after a complete report is
ready, so consumers must not reintroduce partially written report files or
split the atomic write path during future release refactors.

## 2026-08-18 — Make the lsp-daemon test budget dominate its subprocess budgets

`packages/lsp-daemon/vitest.config.ts` declared no `testTimeout`, so vitest's
5s default applied while `test/qa-driver-portability.test.ts` granted its `bun`
cancellation smoke 10s (an `execFileSync` timeout and a `setTimeout` guard
around its `spawn`). The harness therefore killed the test before the inner
guard could ever fire, so a slow-but-correct subprocess reported `Test timed out
in 5000ms` instead of an assertion result. Windows CI runners routinely spend
more than 5s spawning `bun`, which is why "Run vendored lsp-daemon tests" failed
on `windows-latest` with no product defect behind it.

The package now sets `testTimeout`/`hookTimeout` to 30s, exported from the
config as `TEST_TIMEOUT_MS` alongside the documented `MAX_IN_TEST_BUDGET_MS`
ceiling of 10s. The invariant is that the harness budget strictly exceeds every
budget a test grants a subprocess or timed promise; `test/test-timeout-budget.test.ts`
reads both the configured value and the real budgets out of the test sources and
fails if that ordering is ever reintroduced. Keep the bound proportionate: it
exists to survive a cold Windows process spawn, not to hide a genuine hang.
