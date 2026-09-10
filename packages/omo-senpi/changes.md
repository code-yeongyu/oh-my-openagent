## 2026-09-09 — Pin persona assets to the payload a process started from

The memory component read each persona markdown from beside the bundle at child-launch time, so the asset had to still be on disk, under its current name, every time a gate fired. The install tree is mutable while a session runs: a global install replaces it in place and the omob launcher rebuilds and prunes runtime dirs. After the Kibitzer rename shipped, sessions whose process had loaded the pre-rename bundle kept opening `extensions/memorian-persona.md` in the replaced tree and every recall gate died with `session_create_failed` (ENOENT). The same shape hit omob runtime dirs on 2026-09-07 through a prune.

Persona filenames now have one definition (`memory-core/src/personas/manifest.ts`), the loaders read through a process-level cache that serves the content the process started with, and the memory component primes all four personas at registration. A read that fails is reported once, naming the asset and its cause, and is never substituted at runtime: a genuinely incomplete payload is a packaging failure, so the packing validators own it. `plugin-artifacts.ts` derives its persona entries from the manifest and is now the single required-artifact list; `script/build-omo-native.ts` re-exports it instead of keeping a hand-copied mirror, which had drifted and stopped requiring `extensions/omo-task.js`, `extensions/omo-member.js` and the gate persona in the published `omo-ai` payload.

## 2026-09-09 — Rename the memory advisor to Kibitzer

Renamed the Memorian implementation, persona asset, packaging references, QA drivers and documentation to Kibitzer. Recall notices now identify Kibitzer instead of the former Aha! wording, and English/Korean model-facing hints name their source.

New entries use `omo-kibitzer:nudged`, `omo-kibitzer:gate` and `omo-kibitzer:recall`. Legacy `omo-memorian:*` entries remain renderable, and both recall channels are excluded from recall search and transcript ingestion. Existing recall settings, hint validation, scheduling, pending files and the separate `memory.nudge` write reminder retain their behavior. Tracking issue: #7993.

## 2026-09-09 — Make thread discovery test paths platform-native

`src/components/thread/live-surface.test.ts` builds agent-home fixture paths and expected socket paths with `node:path`. Windows resolves configured directories to drive-qualified paths and uses backslashes; fixed POSIX literals caused three CI failures and made the fake settings-file lookup miss the intended directory. Override priority, canonical/flat/standalone discovery, and unavailable-host assertions are preserved. Runtime code is unchanged.

## 2026-09-08 — Regenerate task and member extensions for durable team linkage

Regenerated `plugin/extensions/omo-task.js` and `omo-member.js` with the CI-pinned Bun 1.4.0 build. The shipped extensions now preserve team run, team name, member name, and member role on senpi-task records; the repository's extension freshness check passes.

## 2026-09-08 — A bind superseded by session replacement is a skip, not a failure

`logBindReconcileFailure` classifies senpi's retired-context error ("This extension ctx is stale after session replacement or reload.") the same way it already classifies reflection-lock contention: a recoverable `info` skip with `reason: "session replaced before the bind completed"`. Bind-time reconcile floats past `session_start` by design, so when the host replaces the session mid-bind it retires the ctx that bind was handed and the replacement session runs its own bind - nothing is lost and nothing needs operator attention. Genuinely unexpected errors keep `warn`.

Observed live on omo-desktop (mengmotaHost, packaged runtime under `--mode rpc --multi-session`): every desktop restart that resumed a session logged `memory bind-time reconcile failed` or its downstream `memory reflection launch failed` with that message; the boot with zero resumed sessions was clean until the next session bound.

## 2026-09-08 — Run the bundled agent toolkit under Bun mode from the packaged binary

`ulw-loop/omo-command.ts` spawns a `.js` toolkit entry through `process.execPath`. Under the packaged runtime (omo-desktop's compiled `omo`, omob) that path IS the omo binary, so without `BUN_BE_BUN` it ran its own embedded entrypoint with the toolkit path as a prompt: `ulw-loop status` exited 1 with `Unknown option: --json`, the hook logged `omo-senpi ulw-loop status ignored { reason: "non-zero-exit" }` on every input, and every desktop thread with a plan read as inactive so no continuation fired. The `.js` spawn target now carries `env: { ...process.env, BUN_BE_BUN: "1" }` (the same guard `lsp-daemon` gained in #7916); plain executables keep their inherited env.

## 2026-09-07 — Complete a facts child that finishes without assistant prose

Facts extraction records through `record_fact` and often ends the turn with no final assistant text, including when nothing durable was found. The in-process launch now sets `completion: "turn"` so a normally settled turn is success; `stopReason` `error`/`aborted` still fails. Ordinary task children keep the default `final-text` policy.

## 2026-09-07 — Flush the journal before shutdown cleanup

The session shutdown path now flushes the transcript journal before awaiting memory cleanup, gate cancellation, and facts cancellation, so the fixed 1500 ms shutdown budget cannot skip the durable journal step. Journal-flush budget exhaustion is emitted as an error-level alarm with the session and step details, while optional work keeps its existing informational message. Memorian gate runs now stop promptly when the child reports a terminal upstream 503, `auth_unavailable`, or overloaded provider error; silent children still use the deadline backstop.

## 2026-09-05 — Name `tool.monitor` in the ultrawork directive and drop the polling loop

The Waiting discipline section of `skills/ultrawork/SKILL.md` told the model that
`monitor` is "the first tool you reach for", but in every session with `eval`
the direct tool list carries neither `monitor` nor `bash` (senpi withholds both
since 2026-09-03); the only callable form is `tool.monitor(...)` inside a cell.
The 2026-09-05 `gpt-6-astra-fast` session traces show the result: a
subscription appeared only in sessions whose request itself named the CI run or
the async work, one orchestrator polled `task_output` 35 times with
`TASK STILL ACTIVE` demands, and another blocked inside eval cells on
`Bun.spawn` + `setTimeout(kill, 580-880 s)` for installs and test runs. A
sandboxed backtest against the real model with this directive attached
(`/tmp/ulw-astra-monitor/monitor-run.ts`, eval-only tool shape) reproduced it:
no first response registered a subscription across three wait-shaped requests.

Three edits, each at the source of a defect and none appended on top. Waiting
discipline now names the two call shapes (`tool.monitor({ description, command,
filter })` for a command or an `until ...; printf 'READY\n'` gate,
`tool.monitor({ description, path, event })` for a file), states the eval-only
fact once, lists the conditions (a build, install, or test run finishing; a CI
check or PR turning green; a deploy landing; a log line; a file appearing; a
port opening; another session's pane or a remote machine changing state),
states that the subscription is the whole cost of a wait - `sleep`, timed
retries, re-polls, a cell that awaits a `--watch` or a spawned process, and a
child spawned to watch are the forbidden forms, because the multi-round
backtest showed the model awaiting `gh pr checks --watch` inside a cell or
handing the wait to a child task once plain polling was ruled out - and keeps
the unprompted-arming rule, whose duplicate list and the duplicate "register
before the wait exists" sentence are gone along with the "blocking waits are
gone" and "every wait is a subscription" restatements. Parallel
execution scopes `Bun.$` to a command that finishes inside the cell and routes
anything that can outlive one reply through `tool.monitor`, which is what
turned the awaited-spawn blocking pattern into a directive-compliant one. Child
execution loses the "peek once ... after four silent or ack-only checks" loop
that contradicted the single-midpoint-peek rule and the senpi-task delivery
contract; a running child is alive, its completion wakes the session, and the
turn ends instead of polling. `generated-directive.ts` is regenerated by
`embed-directive.mjs` (forbidden-token guard passed) and `ultrawork.test.ts`
gains one sentinel: the shipped directive contains `tool.monitor(`, RED on
`021aaf8cf` and GREEN after. o200k tokens for the directive: 7318 -> 7451.

## 2026-08-29 — Teach "mass ulw research" the mass path

A combined mass + research invocation collected at team scale instead of mass
scale, and two of its spellings never loaded the research skill at all.

`mass-ulw/references/planning.md` sent every `ulw-research` request to the team
path and reserved the dag for "independent harvest stages only", so the
composite invocation could never reach mass fan-out. That routing now splits: a
plain research request still goes to the team, while a MASS research request
runs collection as chained dags and keeps a team only for debate rounds. A new
"Mass research" section states the scale the mode means — a 60+ node opening
wave covering every angle, routed across `quick` / `unspecified-low` /
`unspecified-high` / `deep` in one graph, each wave's EXPAND leads defining the
next wave's nodes until convergence, and a synthesis that reduces through
several parallel `architect` nodes into one `architect` reducer, with
`ultrabrain` substituting where the config defines no `architect` category.
Both `ulw-research` copies (senpi-native and shared) gained the matching branch
at their Phase 1 roster decision, so the mode is reachable from either skill.

`skill-pointers` extracts the mass alias group into a shared `MASS_ALIAS`
constant and lets it stand in for the `ulw` half of the research pattern. The
aliases carrying no literal "ulw" (`mulw`, `meth`) and the reversed `ulw mass`
previously matched mass-ulw alone, so "mulw research" armed dag orchestration
with no research doctrine behind it; those spellings now inject both pointers,
exactly like "mass ulw research". Near-miss guards (`method`, `promethean`,
`ulw massive`) are unchanged.

## 2026-08-28 — Align the Senpi adapter with 2026.8.28

`packages/omo-senpi/package.json` now requires the exact published
`@code-yeongyu/senpi` `2026.8.28` release for both its optional peer and
development dependency, matching the native runtime pin. The engine release
repairs the beta.23 shared interactive host regressions (thinking-level
cycling, duplicate user-message rendering, and resume of host-held sessions)
and restores the compiled eval kernels.

## 2026-08-27 — Align the Senpi adapter with 2026.8.27

`packages/omo-senpi/package.json` now requires the exact published
`@code-yeongyu/senpi` `2026.8.27` release for both its optional peer and
development dependency. Keep the peer, dev dependency, root patched-dependency
key, and generated lockfile aligned with the native runtime pin.

## 2026-08-27 — Allow the mailbox durability stress test to finish on Windows

The mailbox cap-and-restart test now has a 15-second per-test budget. It performs
128 durable atomic queue writes plus a second byte-cap queue on Windows, where
filesystem write and rename latency can exceed Bun's default five-second test
budget even though the queue contract completes correctly. This changes only the
test deadline; mailbox bounds, ordering, persistence, and production retry
behavior remain unchanged.

## 2026-08-27 — Preserve the full Windows model-admission test budget

The task RPC model-admission parity tests now pass their calculated timeout
through Bun's supported timeout option object. This preserves the intended
`PROBE_TIMEOUT_MS * 3 + 20_000` budget on Windows instead of allowing the
legacy numeric argument form to be capped by the runner's default test
deadline. Production probe behavior is unchanged.

## 2026-08-27 — Keep thread persistence and DAP portable on Windows

The thread mailbox and durable receipt stores now use the shared atomic-write
implementation, which opens a writable temporary file, tolerates the Windows
filesystem's allowed `fsync` limitations, and avoids directory `fsync` where
Windows rejects directory handles. The DAP client now distinguishes a real
`host:port` adapter endpoint from a Windows drive-letter script path, so the
fixture adapter launches instead of attempting a socket connection to drive
`C:`. The existing POSIX durability behavior remains unchanged.

## 2026-08-27 — Regenerate both Senpi extension entry points after merge

The generated `omo.js` and `omo-task.js` entry points are refreshed from the
current source after the post-beta.23 merges. This removes conflict-marker
content that had remained in `omo-task.js` and keeps both tracked entry points
aligned with the source component set consumed by the release build.

## 2026-08-26 — Normalize ULW CLI pointer paths across platforms

The ulw-loop skill pointer now normalizes the resolved executable path to
POSIX separators before embedding it in the machine-consumed command sentence.
Windows Senpi compatibility therefore receives the same canonical path shape as
POSIX while the actual executable path remains unchanged.

## 2026-08-25 — Name the executable in the local-launcher brand profile

The sibling-store local launcher now injects `command: "omo"` on the `SENPI_BRAND`
profile it hands the engine, matching the published omo-ai launcher. Senpi can
render resume hints with the real executable name instead of guessing; unknown
fields stay ignored on older engines.

## 2026-08-22 — One exception-free keyword table for every ULW skill pointer

The mass-ulw and ulw-skill-pointers components were the same mechanism written twice, and the
detectors carried `ulw(?!-)` lookaheads that silently swallowed overlapping mentions: "mass
ulw-loop" fired neither mass-ulw nor ultrawork. They are replaced by a single `skill-pointers`
component holding one uniform target table (mass-ulw with its aliases, ulw-plan, ulw-loop,
ulw-research) with no cross-keyword exceptions — overlapping keywords all fire, each matched
skill gets its own hidden pointer, and the ultrawork trigger likewise drops `(?!-)` so any
`ulw` mention arms it. Typing "mass ulw-loop" now loads ultrawork + mass-ulw + ulw-loop
together; "ulw plan" loads ultrawork + the ulw-plan skill.

CustomTypes stay stable (`omo-mass-ulw:skill-pointer`, `omo-ulw-loop/-research:skill-pointer`;
new `omo-ulw-plan:skill-pointer`). The per-component flags `omo-senpi-mass-ulw-disabled` and
`omo-senpi-ulw-skill-pointers-disabled` are replaced by `omo-senpi-skill-pointers-disabled`.
Only structural dedup remains: extension-source inputs, a raw `/skill:` command for the same
skill, expanded skill blocks, and the `<ultrawork-mode>` tag-pair guard.

## 2026-08-22 — Load every skill a composite ULW invocation names

"mass ulw loop" armed ultrawork and pointed at the mass-ulw skill, but nothing loaded the
ulw-loop skill the phrase names; "mass ulw research" had the same gap. The new
`ulw-skill-pointers` component detects `ulw loop` / `ulw-loop` / `ulwloop` and the research
equivalents (any case) and injects one hidden skill pointer per matched skill, so a composite
invocation now loads ultrawork, mass-ulw, and the named skill together.

Suppressions mirror mass-ulw per skill — extension-source inputs, a raw `/skill:` command for
the same skill, and an already-expanded skill block never re-inject — and queued prompts carry
the pointers appended inside the one message so the group survives senpi's one-at-a-time queue
drain. Gated by `omo-senpi-ulw-skill-pointers-disabled`.

## 2026-08-21 — Follow the Senpi 2026.8.21 host contract

The adapter peer and development dependency now require Senpi `2026.8.21`, and the
task engine's peer and development pins move with it. The 2026.8.21 host carries
the settings-lock CPU-spin repair that froze the omo TUI at ~100% CPU under
provider-error storms: contended settings-lock retries sleep through
`Atomics.wait` instead of busy-waiting, retry-fallback chain canonicalization is
memoized per error burst, and the `cursor-cli-oauth` / `claude-sdk-oauth` lanes
cache their settings loads by mtime+size. It also carries the follow-up that
makes settings reads lock-free: writers publish through a same-directory temp
file plus rename, so read-only settings loads take no lock and can never observe
a torn write. Alongside those, the host refreshes hydrated provider catalog data
(the vercel-ai-gateway Grok vendor slug moved `xai/` -> `spacexai/`, and opencode
delisted `deepseek-v4-flash-free`).

The bump covers all four manifest surfaces, the workspace lockfile, the
`senpi-pin` and package-shape test pins, and the provider-map provenance comment
(re-verified: `packages/ai/src/providers/all.ts`, which defines
`builtinProviders()`, is byte-identical between `v2026.8.20-2` and `v2026.8.21`,
so the builtin provider ids are unchanged).

## 2026-08-21 — Add mass-ulw trigger aliases

The mass-ulw keyword detector now also fires on `ulw mass`, `ulwmass`, `mulw`, and
`meth` (any case, space/hyphen variants), alongside the existing `mass ulw` /
`massulw` / `mass-ulw` spellings. `MASS_ULW_PATTERN` becomes
`/\b(?:mass[\s-]*ulw(?!-)|ulw[\s-]*mass|mulw|meth)\b/i`; the `ulw(?!-)` guard,
all suppressions, and both injection paths are unchanged.

## 2026-08-20 — Render transcript notices in the Senpi notice-box family

Fallback architect announcements, task completion and liveness cards, and memory reflection, health, soul, accepted-turn, and write notices now share the Senpi-canonical padded `customMessageBg` block. Titles retain semantic tone and bold emphasis, body rows stay dim, and diagnostic detail remains expanded-only.

Compact category warnings and normal tool result rows remain unchanged.

## 2026-08-19 — Follow the Senpi 2026.8.19 host contract

**What changed.** The adapter peer and development dependency now require Senpi
`2026.8.19`, and the task engine's peer and development pins move with it.
`packages/omo-senpi/package.json`, `packages/senpi-task/package.json`,
`packages/omo-native/package.json`, the root `package.json` development pin,
and the workspace `bun.lock` advance together, along with the
`packages/omo-native/bin/lib/provider-map.json` provenance stamp and the
`packages/omo-senpi/src/package-shape.test.ts` /
`packages/omo-native/test/package-shape.test.ts` /
`packages/omo-native/test/senpi-pin.test.ts` expectations.

**Why.** The 2026.8.19 host stops implicit fallback expansion from routing
through provider lanes that are guaranteed to refuse: a registered provider can
declare itself ineligible, and the cursor-cli-oauth lane does so while its
`--force` acknowledgement is missing or its kill switch is set. It also stops
auto-compaction from being starved when a provider reports a small context
while the local transcript keeps growing, and it detects the
`com.apple.quarantine` attribute on shipped native PTY prebuilds before
`dlopen()`, so macOS degrades to the pipe fallback instead of blocking the
process on a Gatekeeper dialog. The release additionally carries the `/loop`
scheduled-prompt builtin, memory and mass-ulw tip rotation, and the upstream
`badlogic/pi-mono` main@`59a71b23` sync.

**Why an extension could not handle it.** These are host-version pins. The
adapter cannot express a required Senpi runtime version from inside an
extension; the manifests are the contract the installer and the workspace
resolver read.

**Expected merge conflict zones.** The adapter and task manifests, the
`omo-native` manifest and its pin tests, the workspace lockfile, package-shape
expectations, and the provider-map provenance comment.

## 2026-08-18 — Follow the Senpi 2026.8.18-3 host contract

The adapter peer and development dependency now require Senpi `2026.8.18-3`,
and the task engine's peer and development pins move with it. The 2026.8.18-3
host repairs the release changelog itself: a merge resolution had left a stray
conflict marker and duplicated empty headings inside the `[Unreleased]`
section, which the release stamper would have frozen into an immutable
released section.

The host release also carries the accumulated post-2026.8.18-2 runtime work:
active goals resume after a continuation-flooded session load suppressed
auto-continuation, transient provider stream-start timeouts spend their full
configured retry budget, Cursor exec-bridge dispatches bind to the run that
opened their stream, leaked-invoke recovery resolves wire-aliased tool names,
Cursor context windows track the models.dev first-party catalog, Cursor
reasoning levels drive both Cursor surfaces, advertised Cursor tool schemas
are sanitized of JSON-Schema composition keywords, input typed during
auto-compaction is queued instead of dropped, eval cells with no tool calls
omit the throughput badge, the packaged codemode sidecar retains its Babel
dependency closure, and Claude SDK OAuth selects the libc-appropriate binary.

This bump does not add or alter adapter behavior beyond the inherited host
fixes. The provider registry contract was re-verified: `builtinProviders()` in
`packages/ai/src/providers/all.ts` is byte-identical to 2026.8.18-2, so the
42 builtin provider IDs are unchanged and only the provider-map provenance
stamp moves. Conflict zones are the adapter and task manifests, the workspace
lockfile, package-shape and senpi-pin expectations, and the provider-map
provenance comment.

## 2026-08-18 — Follow the Senpi 2026.8.18-2 host contract

The adapter peer and development dependency now require Senpi `2026.8.18-2`,
and the task engine's peer and development pins move with it. The 2026.8.18-2
host fixes Cursor exec-bridge recovery: symbol-keyed exec markers survive
model-recovery snapshot cloning, so side-effecting tool calls are not executed
twice; late bridge events stay bound to their originating run; and active
goals re-engage after a settings hot-reload. Cursor CLI OAuth bootstraps
native credentials by default, and GPT-5.6 Sol/Sol Fast models default to a
400k-token context window.

This bump does not add or alter adapter behavior beyond the inherited host
fixes. The provider registry contract was re-verified: builtin provider IDs
are unchanged between 2026.8.18 and 2026.8.18-2 (senpi-pin and package-shape
suites green). Conflict zones are the adapter and task manifests, the
workspace lockfile, package-shape and senpi-pin expectations, and the
provider-map provenance comment.

## 2026-08-18 — Keep shipped skills on the Senpi task roster

Shared skill copies now translate Oracle review lanes to `unspecified-high`,
Oracle debugging and plan lanes to `deep`, and omit raw team leads that the
Senpi harness supplies itself. Native DAG examples use a real category, and
the compatibility banner no longer advertises the nonexistent `git` category.

The generated skill guard derives valid named agents and categories from the
runtime registries, so future shared-skill or native-skill drift fails before
shipping. Shared OpenCode skill sources remain unchanged.

## 2026-08-18 — Keep completed resident team members visible

The below-editor task widget now keeps completed canonical team members while their process-local handles remain resident, so users can still see members that `task_send` can revive. Active rows remain first, the five-row cap still applies afterward, and retained completed rows render as settled compact rows without a live spinner.

Ordinary completed background tasks and stale or non-resident team records remain hidden. This is a presentation-only change; task lifecycle, residency, and messaging behavior are unchanged.

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
