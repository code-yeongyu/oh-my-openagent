## Model profiles: Capable then Deep work, Simple work removed, subscription lane first

`model-profile/builtin-profiles.ts`: the builtin table is `capable` then `deep-work`, and
`simple-work` is removed. `capable` leads with `claude-fable-5-1` at `xhigh` (was `max`).
`deep-work` is its own chain, `gpt-6-astra` high -> `gpt-6-sol` medium, and no longer mirrors
deep-high ++ deep-low, so it stops at GPT-6 Sol instead of inheriting the `gpt-5.6-sol` tail.
Every Claude rung is headed by `anthropic-subscription`, like the category chains (#8051): before
this a subscription machine holding an OpenCode Zen key resolved `capable` to the metered
`opencode/claude-fable-5-1`. A config still naming `model_profile: "simple-work"` now gets the
existing unknown-profile notice (known profiles: capable, deep-work) and keeps senpi's default
model; a user `model_profiles.simple-work` entry keeps working as a user profile. omo#8704.

## Model profiles and telemetry vocabulary follow the GPT-6 routing

`model-profile/builtin-profiles.ts`: `simple-work` leads with `gpt-6-luna-fast` low and
`deep-work` carries the new `gpt-6-sol` medium rung between Astra and `gpt-5.6-sol`, keeping the
profile equal to deep-high ++ deep-low. `telemetry/model-vocabulary.ts`: `gpt-6-luna` and
`gpt-6-luna-fast` join the OpenAI lanes (and `gpt-6-luna` the OpenCode Zen lane) so the new
rungs export under their own names instead of `custom`; `docs/reference/senpi-telemetry.md` is
regenerated from `script/telemetry-schema-block.mjs`. The QA mock providers under `scripts/qa/`
serve `gpt-6-luna-fast` as the quick chain's first rung. omo#8701.

## The live background row no longer claims "running" before a real turn lands

`status-row-format.ts` kept a second copy of the status-line grammar in `liveStatsTokens` and
defaulted the activity string to `"running"`, so a freshly spawned child with zero stats - or one
whose provider attempts had all failed - read `turn 0 · running` (or worse, `turn 4 · $0.0000 ·
running`, failures counted as turns by the old run stats). The row now draws its stats tokens from
the shared `buildLiveStatsTokens` builder and derives the fallback verb through
`selectLiveActivityVerb`: `starting` before anything lands, `retrying` once failures prove the
child is alive, `running` only after a successful turn, and `running <tool>` unchanged while a
tool executes. A child with no stats at all keeps the legacy `running` fallback: it is alive,
its turn facts are just unknown to the renderer. `task-rpc-codec.ts` carries `failed_turns`
through the live-progress snapshot so RPC and DAG consumers read the same facts as the TUI.
The QA stats renderer (`scripts/qa/task-stats-renderer.mjs`) was repaired alongside: it now warms
the lazy pi-tui boundary before rendering (it crashed at HEAD since the lazy boundary landed),
renders every scenario when invoked bare instead of demanding an argument, pins the current
completed-row grammars (the foreground row lost its `tps` token and the team notice moved to
space-separated fields since the script was written), and adds a `failed` scenario pinning the
failed-only row. omo#8627.

## The reflection child uses the agent directory its parent engine resolved

The reflection sandbox granted an agent directory the adapter re-derived through `resolveAgentHome`:
an environment override, then `~/.omo/agent` behind its `settings.json` sentinel, then the flat
`~/.omo`, then `~/.senpi/agent`. The engine answers that question differently - the brand's
environment prefix before the legacy ones, then the nearest parent project config directory walked
up from the session's cwd, then its own home default - so the two could name different directories.
The child then locked its credentials outside the grant and the run died with
`EPERM ... auth.json.lock` followed by `No API key found`, while the parent stayed authenticated
(omo#8595).

`session-context-resolver.ts` now reads the engine's own answer off the event context
(`ExtensionContext.agentDir`, accepted only when absolute and non-blank) and `wiring-runtime.ts`
hands it to the identity runtime; detection remains the fallback for a host that reports none.
`identity-runtime.ts` resolves that directory once, grants it, and pins it into the reflection
child's environment under `OMO_CODING_AGENT_DIR`, `SENPI_CODING_AGENT_DIR` and
`PI_CODING_AGENT_DIR`. The pin matters twice: the child's cwd is the reflection worktree, so without
it the child walks its own way to a directory nobody granted, and an inherited value under the brand
prefix would beat a legacy-only pin because the engine takes the first DEFINED name across
`<brand>`, `SENPI`, `PI`. Grant and pin come from one resolution, so they cannot drift apart.

## The default component logger writes every level to stderr

`extension/compose.ts` `defaultLogger.info` used `console.info` (stdout). A child process's stdout
is its deliverable - the reflection worker's report is read back from `child-stdout.log` and its
first three non-empty lines become the "Memory updated" preview - so component info lines
(`ulw-execute-continuation skipped`, `ulw-loop continuation skipped`) were shown as the report.
`info` now writes through `console.error` like `warn` and `error`; the argument shape is unchanged
(no trailing `undefined`). Pinned by `extension/compose.test.ts`. omo#8564.

## Memory identity comes from the session's workspace, and a reattach rebinds instead of failing closed

`createMemoryComponent` resolved every session's identity from `process.cwd()`, read once at registration and reused for every bind. One shared host serves sessions from many workspaces, so a generation ensured by a process sitting in some other directory handed that directory's identity to every session it picked up: seven sessions reported `memory identity conflict: session is bound to <workspace>-<hash>, but config resolved server-<hash>` inside one second and lost their memory tools, with no workspace change behind it (#8556).

The bind now resolves the identity from the session's own cwd. senpi builds one `ExtensionRunner` per `AgentSession` and exposes that session's directory as `ExtensionContext.cwd`, so `readSessionSurface` reads it off the event; the extension's load cwd (`pi.cwd`) and then `process.cwd()` remain as fallbacks for a host that reports neither. Registration-time work (the config read, the transient sweep, the wiring's own cwd getter) keeps using the host cwd, which is what it has always meant.

`identity-adoption.ts` decides what a bind does when the session already carries a binding entry. The record wins, because it is the only evidence of what the session was; a divergence goes to the log at `info` and never to the user. Two cases the record cannot answer keep the fail-closed error: an explicitly configured `memory.agent` that names a different identity, and a record whose memory repository cannot be reproduced under the current memory root. The `session_start` path for a user-initiated identity change is therefore unchanged, and so is the repository check on the `before_agent_start` rebind from #8017.

## The `deep` delegation category splits into `deep-low` and `deep-high`

`deep` opened its description with a bold MANDATORY list of domains (3D, computer and browser use,
CAPTCHA, multimodal, backend, logic, algorithms). The list routes by domain, which almost every
coding task matches, so the category's head rung `gpt-6-astra` high served nearly all delegated work
and the `gpt-5.6-sol` medium rung under it was reachable only by provider absence.

The replacement routes by capability on two axes the caller can rate from the brief: how much context
the child must hold, and how hard its decisions are. Decision difficulty is the gate. `deep-low`
(`openai-codex/gpt-5.6-sol` medium) is the default lane; `deep-high` (`openai-codex/gpt-6-astra`
high) takes a goal whose central decision cannot be settled from evidence. `CATEGORY_FALLBACK_CHAINS`
gives each lane ONE rung and `requiresModel` gates each on its own model id, so the lanes never
substitute each other and a registry missing one lane drops it from `availableCategories` instead of
serving the other model under its name. The provider list inside a rung is unchanged, so a single
provider outage still fails over across `openai-codex` -> `github-copilot` -> `opencode`.

The domain list now lives only on the caller-facing `deep-low` description. The child appends lost it
(a child never picks its category) and gained the escalation contract: a `deep-low` child returns
`ESCALATE: deep-high` as the first line, with what it read and the decision it could not settle,
instead of guessing. `openai-categories.ts` therefore ships four deep appends (GPT and generic per
lane) resolved by `resolveDeepLowCategoryPromptAppend` / `resolveDeepHighCategoryPromptAppend`; the
GPT-5.5-specific deep append is gone, since both lanes ship GPT rungs only and the GPT-5.6 doctrine
(outcome, success criteria, escalation, stop rule) covers Sol and Astra alike.

`omo-senpi-gate-reviewer` routes `["deep-high", "unspecified-high"]`, `omo-senpi-qa-executor`
`["deep-low", "unspecified-low"]`. The telemetry `category_config` schema swaps `cat_deep` for
`cat_deep_low` / `cat_deep_high`; `delegation_completed.category` derives from
`BUILTIN_CATEGORY_DEFAULTS` and needed no edit. The `deep-work` model profile now deep-equals
`deep-high ++ deep-low` instead of the single old chain.

## `categories.deep` migrates once, and does nothing to configs that never used it

`omo-config-core` gains `canonicalizeLegacyCategoryNames`, which rewrites a retired category key
(`categories.deep`) and a retired category VALUE (`teams.*.members[].category`,
`memory.reflection.category`) through the base block, `[senpi]`/`[opencode]`/`[codex]`, and every
`profiles.*` and its harness sub-block. The loader runs it per layer before merge and reports a
`deprecated-keys` diagnostic, which `config-startup` already surfaces as a startup warning. That is
what keeps an override working when the file rewrite cannot run (locked batch, read-only project
file). When both `deep` and `deep-low` exist the canonical entry wins and the drop is reported.

The file rewrite is the new `2026-09-category-deep-split` plan in `config-migration`. Because the
reasoning-unification plan taught us that a `replace-target` plan writes a backup and a `_migrations`
marker even when the transform is a no-op, `MigrationPlan` gains `shouldRun`, a content gate that
`batch.ts` evaluates against the parsed target before the journal, the backup and the write. The new
plan passes `hasLegacyCategoryNames`, so a config that never named `deep` is left byte-identical with
no marker - asserted in `migration/should-run.test.ts` by `operations` carrying no write or rename.

The name also resolves at runtime: `validateTaskTarget` canonicalizes the spawn boundary (so the task
record, telemetry and renderers all carry the name that ran), and both edition resolvers accept the
retired name, so `task(category: "deep")` in a third-party skill or an AGENTS.md keeps working.

## Daemon-host QA gates observe product transitions, not parent timing

The single-parent control keeps its sixteen-session and single-daemon requirements but waits for
readiness with the loaded-host allowance. Detach/attach uses two release barriers and resumes the
original parent session; its gate checks child completion, a persisted resume response and no prompt
replay rather than requiring the resident parent process to exit within an observation window.
The second barrier keeps children mid-turn until reattachment, and the resumed parent waits for their
terminal records before ending its own turn.

Team QA follows the member's stored identity, matches its daemon context and checks delivery of the
specific mailbox message. Parking QA explicitly authorizes its new sender, checks the revival epoch
and waits for the same child transcript to contain both the message and its completed response.
Its acceptance evidence is the persisted `revived` tool result, not the sender process's exit timing.
The zombie scenario runs a finite workload and counts successful, distinct bash receipts from all
eight children, not how many remain running after the storm ends. Missing work, a dead daemon,
zombies, wrong identities and replay still fail their gates.

Self-tests cover healthy terminal states and fault controls. State waits subscribe before triggering
work. QA no longer reads real agent credentials for digest comparisons; child environments remain
isolated and each scenario records process and sandbox cleanup.

Fan-out fixtures keep the parent turn active until the cohort is observed. A/A1 still reject a
terminal aborted/error child transcript even if its store incorrectly appears active and the worker
count is sufficient. A separate diagnostic captures paired store/transcript snapshots and a bounded
convergence observation for the graceful-shutdown suspension behavior tracked in #8517; this harness
change does not change that product behavior.

The daemon lane now owns its mock provider. Its step cursor comes from each conversation's tool-call
receipts and the current script, so eight in-process children cannot consume one another's steps.
The shared `task-e2e-mock-provider.ts` is unchanged. An interleaved eight-child regression requires
all 200 steps and verifies that a replacement script starts at its first step.

Failed-task evidence retains the exact record, the last assistant entry, correlated provider abort
signals, `agent_end` abort fields, session shutdown events and the driver's teardown boundary.
An observed `toolUse` stop reason alone is not labeled an intrinsic engine failure.

## The fallback-architect nudge arms on any refusal-driven fallback

`detection.ts` no longer exports `isFableFiveModel`. The exact-id equality it provided was the arming gate
in `index.ts`, so only a session whose refusing model was literally `claude-fable-5` ever received the
directive, and `claude-fable-5-1` - the id the shipped architect category itself resolves to - missed it.
The `model_select` handler now arms on the refusal signal alone: `source === "fallback"`, a previous model
in the payload, and the refusal predicate on the preceding assistant message, behind the unchanged
architect-category gate and the unchanged `omo-senpi-fallback-architect-disabled` flag. A second refusal on
the fallback model therefore arms a fresh directive naming the new pair, which is what the reminder must
say once the session has moved twice.

Two consequences ride along. The active episode used to clear when the newly selected model was fable 5; it
now clears when the session returns to the selector that was refused, or on `source === "fallback-revert"`.
And `directive.ts` gained `isFableFiveSelector`, a copy-only predicate: the consultant is Fable 5 whoever
refused, but "the same model that just refused" holds only for a fable-family refusal, so that clause is
conditional now and the mirrored tip line no longer names Fable 5 as the refuser.

## Console-subsystem spawns are hidden on win32, and a gate keeps them that way

`memory-core`'s git exec and its process-start identity probe, plus the adapter's formatter, thread
worktree-root lookup, init-deep git plumbing and memory sandbox probe, now pass `windowsHide: true`.
memory-core carried none at all, so every memory auto-commit spawned a visible `git.exe` console and
every PowerShell start-time fallback spawned a visible `powershell.exe` console, both of which
Windows foregrounds. On a Node runtime that PowerShell fallback is the steady-state path, because
the kernel32 reader it falls back from is reached through `bun:ffi`.

The audit meant to catch this matched `spawn(` and `spawnSync(` over three hand-listed files under
`memory/worker`, so it could see neither the `exec*` family nor any file outside that list. Two
gates replace it: `packages/memory-core/src/windows-console-hide.test.ts` and the root gate
`packages/omo-senpi/src/windows-console-hide.test.ts`. Each resolves the child_process entry points
a file actually imports, aliases included, and walks its whole source tree. A foreground process
that must keep the user's console opts out with a `windowsHide-exempt:` comment at the call site,
which is how `install/local-launcher.ts` stays exempt without reopening the hole.

## Package-provided extensions reach process task children

The process task runner now carries the parent's loaded package extension paths into a child when
they are not already covered by argv extensions. It discovers configured package roots without
changing the existing argv extension base, so package-provided providers remain available to the
child while agent-directory and project extensions stay out of the child profile.

## `task-host-e2e.mjs`: live QA for daemon-hosted task children

`scripts/qa/task-host-e2e.mjs` drives a REAL compiled omo binary against a throwaway sandbox and asks
whether a `process` child actually lives as a session of `omo daemon`. It follows `task-rpc-e2e.mjs`'s
isolation model with two additions the compiled binary forces: all THREE agent-dir names are pointed at
the sandbox (the binary reads `OMO_` first, so setting only `SENPI_` hands it the real agent dir), and
`HOME` is a sandbox dir before the FIRST call, because the binary provisions its runtime under
`$HOME/.omo/binary-runtime/<ver>/`. The daemon loads extensions only from its launch spec, and the spec
refuses absolute paths, so the keyless mock provider is copied into the sandbox's provisioned plugin
root and added there - the repo and every real install are untouched.

Scenarios A (two parents x 16 children on one daemon), B (detach/attach), C/C2 (team members, parking),
D (DAG child toolset), E/E2/E3/E4 (generation handoff), F (zombie budget), G (CLI exit codes + a tmux
pty attach), H/H2 (a pre-wave-2 host, a fail-closed legacy client) and I (the default-mode rule) each
write a JSON result, a transcript and a cleanup receipt. A scenario whose input this machine does not
have - a second build of a newer epoch, a spec-less newer senpi, a pre-change engine CLI, a DAG-run
driver - reports `skipped` with the exact command that would run it, never a pass. `--baseline` records
what the current mainline omob does instead, and `--self-test` proves the harness itself without a
binary.

The busy-child fixture is load-bearing and easy to get wrong, so `--self-test` pins its contract.
Its step must call a tool the child can COMPLETE on this engine - `bash` is eval-only (a direct
call is refused instantly) and `eval` aborts at startup in a mock-provider child, so it is `read`
- against a file that does NOT carry the prompts, because a tool result echoing the child's own
prompt reads as a prompt replay. It must take TIME, which `step.delayMs` supplies rather than any
tool's own latency. And it must END with a text step: the mock provider repeats its LAST step, so
a script that ends on a tool call never frees its concurrency slot and the sessions the host
should accumulate never open. A child's transcripts live under `children/<id>/sessions/<id>/`;
the flat `sessions/<id>/` layout is older and is read only as a fallback.

## daemon-launch-spec.json ships in every payload

The task daemon's launch spec was generated at build time but reached only the source tree: the
native payload copies root-level files from an allowlist, the npm plugin publishes from `files`, and
neither listed it, so every installed `omo daemon run` exited 5 with "launch spec missing". It is on
both lists now and on `REQUIRED_PLUGIN_ARTIFACTS`, so a payload without it fails the build.

## 2026-09-19 - The daemon-host QA fixture matches the engine it drives again

### What changed

The busy-child fixture and the transcript readers, after four live matrix runs against a compiled
binary found four independent drifts (the contract is now stated at the top of this file and
pinned by `--self-test`): `CHILD_BUSY` called `bash` directly; it read the prompt-bearing
`mock-script.json`; it never terminated; and `childSessionFiles` / `childStartDiagnosis` read only
the flat session layout. `task-e2e-mock-provider.ts` gained `step.delayMs` (abort-aware).

### Why

`bash` is eval-only on this engine and the mock repeats its last step, so the child spun at 100%
of the host's single loop: every sibling `open_session` failed `host_unavailable`, the socket
stopped answering (`get_protocol_info` unanswered for 5 s while `daemon status` reported
`reachable:false` for a live host), and the run stalled for 13 minutes. With the flat-layout
reader, transcripts that had thousands of lines counted as 0, so every transcript assertion in A,
B and C was blind. The driver could not reach its own assertions.

### Impact

QA-only; nothing here ships to users. On the same binary the fixed harness shows one daemon
identity, no per-child `--mode rpc` process, zero zombies, 32 children admitted with zero errors,
and children still working - transcripts growing - after their parent is SIGKILLed.

## 2026-09-17 — Process children go to the shared daemon, and the plugin gates itself per session

`DEFAULT_RUNNER_FACTORIES.process` now builds an `RpcHostRunner` (children as sessions of the
machine-wide daemon) with the per-child `RpcProcessRunner` as its loud fallback. `process_runner:
"child-process"` and win32 keep the per-child runner; both inputs are injectable on
`RunnerBuildContext` (`platform`, `agentDir`, `env`, `onHostWarning`) so the selection is testable
without pretending to run on Windows.

`host-execution-mode.ts` owns this session's daemon wiring: the gate that answers
`default_execution_mode: "auto"` (ensure once, read the capabilities, fail closed to in-process) and
the deduped notice list the gate and the runner share. Each distinct `host_unavailable:<reason>` is
logged once and appears once in `task_output`, so the parent learns why its children are not daemon
sessions without reading a log file.

Session-role gating replaces the process-wide env checks: the task component registers nothing for a
`dag_child` (parity with the per-child launch, which drops omo's own `-e` entry for DAG children) or
a `member` session, the session-start process sweep skips any child session, and a memory run is
one-shot when the session says it is a child. Every one of them falls back to the old environment
variables for the per-child process runner.

## 2026-09-17 — the residency registry reads the runner's kind, not the pid

`components/task/residency-registry.ts` used to derive a resident's kind from `handle.pid`
(`undefined` meant in-process). A child that is a SESSION of the shared daemon also has no pid, so
it was classified in-process — and `terminate()` for an in-process resident is a deliberate no-op.
Cancel, eviction and the TTL sweep therefore left the daemon session running with nobody attached.
The kind now comes from `ManagedChildHandle.kind`, which the runner adapters set; a handle from
before that field shipped is in-process by construction.

## 2026-09-17 — the thread surface reads the shared task-daemon socket resolver

`components/thread/live-surface.ts` no longer spells out its own socket-name list. `THREAD_SOCKET_ENV_NAMES`
is now the list exported by `senpi-task`'s `runners/rpc-host/daemon.ts`, and `resolveThreadSocket`
delegates to `resolveTaskHostSocket(env, resolveAgentHome({ env }))`. Precedence and the
`<agentDir>/rpc/rpc.sock` fallback are unchanged; the point is that the thread tools and the shared
task daemon can no longer disagree about which socket the machine's engine host listens on.

## 2026-09-17 — the absent-path bwrap rebind is synchronous again, and exit-time containment blocks

Making the session-reachable probes async left two contracts of the memory component broken.

`defaultProbe` in `sandbox-platform.ts` became `async`, so it returned a Promise even for the
branch that deliberately spawns nothing: an executable a test's injected `which` resolved to a
path that does not exist on this machine. `buildPathSandboxTransform` reads the probe's
Promise-ness as "defer the verdict", so a Linux transform built over a runtime write dir that
does not exist yet stopped returning its `--bind` arguments and returned a Promise instead - the
rebind of the absent path was no longer in the built arguments at all. Only the branch that
actually spawns bwrap is async now; the existence gate answers synchronously, so a seam-resolved
executable keeps a synchronous transform while a real `/usr/bin/bwrap` is still probed off the
event loop.

The supervisor's hard termination lost its synchronous form, and with it the `process.once("exit")`
containment. `spawnTerminationCommand` in `worker/supervisor-process-identity.ts` takes
`synchronous` again and `runSupervisor` passes it from the exit handler alone. An exit handler
cannot await, and the "error" event of an async child is queued on a loop that never turns again:
measured on bun 1.4.2, a taskkill spawned there finishes only after the supervisor is gone, and one
that cannot be spawned at all (`ENOENT`) writes nothing anywhere. The blocking form finishes before
the supervisor exits and throws that `ENOENT` into the containment's own `catch`, which is what puts
it on the run's stderr. Every other caller - the signal handlers, the deadline hard kill, the
injected posix signal command - stays async. That branch is also the second spawn call
`worker/windows-console-hide.test.ts` audits for `windowsHide: true`; without it the audit had
nothing left to check in that file and would have passed on a chain with no taskkill spawn at all.


## 2026-09-17 - Defer plugin startup work past the first paint

### What changed

- `src/extension/startup-deferral.ts` (new): `createLazyValue` (construct on first use, with a
  `constructed` flag a test can assert on) and `createStartupDeferral` (queue work, retire it on
  session_shutdown), plus `createFirstPaintScheduler` and the `deferUntilAfterFirstPaint` call-site
  helper.
- `src/extension/compose.ts` / `types.ts`: compose builds one deferral per activation, hands it to
  every component as `ComponentContext.deferStartupWork`, and retires it on `session_shutdown`
  beside the idle coordinator.
- `src/components/lsp/index.ts`: the mutation formatter is a lazy accessor built on the first
  `tool_result`; the project-config notice moved onto the deferral. Tools, flags and all four hooks
  still register eagerly.
- `src/components/init-deep-advisor/component.ts`, `src/components/telemetry/omo-native-session.ts`:
  the `session_start` bodies moved onto the deferral; the telemetry one refuses to build a client
  once `session_shutdown` has landed.
- `src/components/telemetry/index.ts`: the legacy product config resolves the package version on
  first capture instead of at module scope.

### Why

- `session_start` is dispatched from inside the engine's `interactiveMode.init`, so everything a
  handler does synchronously is billed to the phase before the first paint. A plain
  `setTimeout(…, 0)` does NOT escape it — that phase awaits I/O, so the macrotask fires before init
  returns (measured: 0 ms saved, where a scheduler that never fired saved 34 ms). The gate opens on
  the first post-paint host edge or a 750 ms backstop instead.

### Why an extension could not handle it

- This IS the extension; the work is the plugin's own registration and session-binding path.

### Expected merge conflict zones

- LOW: `compose.ts`'s activation sequence (upstream edits the same block when adding seams) and the
  `ComponentContext` shape in `types.ts`.

## 2026-09-17 — ulw-execute continuation repairs a work its session abandoned

`findContinuableBoulderWork` reads `.omo/boulder.json` on every user input and on
`agent_settled`, and it used to accept whatever status it found there. A work whose
session ended abnormally kept `status: "active"` forever, because `completeBoulder`
is the only transition away from it and it runs only on an explicit completion
(#8413). The read now starts with `reconcileStaleWorks`, which demotes such a work
to `paused` and stamps `stale_since` once its last activity - the newest of its
sessions' transcript mtimes, `updated_at` and `started_at` - is six hours old
(`OMO_BOULDER_STALE_WORK_THRESHOLD_MS`). A healthy work is never rewritten, and the
continuation itself is unchanged: `active` and `paused` were both continuable
before this change and still are.

The transcripts are found through this package's own agent-home resolver, which
gained `resolveAgentSessionsDirectory(options)` beside `resolveAgentHome` and is now
reachable as the `@oh-my-opencode/omo-senpi/agent-home` subpath, so the OpenCode
ulw-execute hook resolves the same directory rather than re-deriving it.
`boulder-state` takes the directory as an option and resolves no home path itself.

## 2026-09-16 — Kibitzer nudges are reference-only

A recalled note used to arrive with no stated posture, and 54% of the hints
Kibitzer delivered this month were written as orders to the primary agent
("verify these before ...", "하지 말아야 합니다"), which is advice the agent did
not ask for and cannot audit. The injected block now names its sender and its
posture in the header itself - Kibitzer, a background memory advisor, surfaced
this stored note; it may or may not apply, reference only, the current task
stands - in English or Korean according to the hint
(`packages/memory-core/src/recall/render.ts`). The persona's sample block and the
renderer are pinned to each other byte for byte by `render.test.ts`, so the judge
is never shown a block the harness does not produce.

The persona asks for the other half of the contract: a hint states what the
stored note records ("the note records that ..."), and an instruction to the
agent joins commentary-only and topical-only nudges as a worked bad example
(`packages/memory-core/src/recall/assets/kibitzer-persona.md`).

The rule is enforced where nudges are admitted instead of being left to the
model. `describeInvalidHint` in `packages/memory-core/src/recall/gate.ts` answers
`addresses-agent` for a hint that carries the second person, opens with an
imperative or negated imperative, or ends in a Korean request form, next to the
existing `empty`, `too-long`, `multiline` and `decision-commentary` reasons.
`validateNudges` drops such a hint on the parent side and the sidecar's `nudge`
tool refuses it at call time with the reason and the fix - restate what the note
records as a plain observation - keeping the single correction the tool contract
allows. Only the opening of the sentence is scanned for imperatives, so an
observation that quotes a rule mid-sentence ("the release note records that
publish must follow the green-main guard") is still accepted, as are Korean
plain-form endings. `isValidHint` deliberately keeps its older shape-only
meaning: pending payloads and stored `omo-kibitzer:nudged` entries were admitted
under the contract of their own day, and replaying them must not retroactively
drop a nudge that is already on screen (#8355).

## 2026-09-16 — memory_notice reports only messages compacted out of the live context

`<memory_notice>` told every session that N previous messages had left the live context, with N read
off `sessionManager.getBranch().length`. The branch is the whole path to the leaf, not what the
compaction dropped, so a fresh session of fifteen entries and zero compactions announced that twelve
of its own live messages were gone. The count now comes from the branch's latest compaction entry:
the `message` entries positioned before its `firstKeptEntryId` - or before the compaction entry
itself when that id is no longer on the branch - are the ones senpi no longer sends. A branch that
never compacted counts zero, and a zero count prints no line at all.

The notice is now strictly session-volatile. When the compaction count is zero and there is no save
nudge and no soul update, the `before_agent_start` handler returns its `systemPrompt` with no message
at all, so an uncompacted session spends no tokens on a notice that has nothing to report.

The reason the old line existed survives where it belongs. That relevant stored memory arrives on its
own as `<recalled-memory>` blocks and that there is no recall tool to call are standing facts about
the toolset, not facts about this turn, so they are one sentence at the end of memory-core's compiled
REMINDER, present in every prompt whether or not anything compacted. Models still learn there is
nothing to search for, and they learn it from the block that is always there.

## 2026-09-13 — Project persisted reflection reports into TUI and RPC

Recap projection requires an explicit positive outcome attempt matching the
ledger. Two omitted attempt IDs are not proof of the same child execution;
legacy records without that evidence retain their operational notice.

Report and page reads use the existing resilient memory filesystem boundary.
An interrupted positional report read retries the same explicit offset, retaining
short-read and file-change checks; it does not become a missing report merely
because a child-reaping signal interrupted the syscall.

Bundle import normalization preserves `bun` and namespaced specifiers. Bun's
ambient builtin catalog includes its own modules; prefixing those with `node:`
made Bun-generated artifacts disagree with the Node-driven CI freshness check.
Both launchers must generate identical bytes without relaxing artifact checks.

Committed reflection results derive a bounded, attributed report from existing
run output and matching finalization artifacts. The completion file remains
unchanged; only the delivered custom entry carries the presentation projection.
The read-only `omo.memory.reflections` method pages relevant results without
consuming delivery state. Failed, unchanged and unmerged runs do not become
learned-memory recaps.

The TUI supports compact and expanded report content without flattening Markdown
whitespace. The real-runtime QA driver covers actual child commits, exclusions,
disconnection recovery and source/recipient session switching. Its readiness
signal is the existing memory binding entry, not an extension-event capability
that the stdio client did not negotiate.

## 2026-09-13 - Ship the agent toolkit as an eval SDK

Adds `plugin/runtime/agent-toolkit-sdk/sdk.js` at `OMO_AGENT_TOOLKIT_SDK_ROOT`. The SDK imports only Node builtins and binds each call synchronously from `PI_SESSION_ID`, `PI_SESSION_CWD`, and `PI_GOAL_STORE_FILE`; importing it performs no I/O. Missing session facts resolve as operation-tagged failure envelopes. Checkpoints and review blockers use the session's driver snapshot unless explicitly supplied, with authoritative `goal:null` stopping fallback reads. Invalid stores are advisory warnings and are never rewritten.

The host status reader uses the additive `#omo-agent-toolkit-sdk` import map. Build freshness, installer/payload allowlists, node-only input checks, and isolated worker tests cover the new artifact. Generic directory provisioning preserves DAG behavior. This increment retains the old tool registration, runtime alias, and sidecar; their removal is a separate change.

## 2026-09-12 — Drop the retired agent-name alias notices

The `omo-config:agent-alias-deprecated` startup warning is removed from `components/config-startup/index.ts` together with its `StartupNotice.kind` discriminator: with the alias gone from senpi-task, `agents.metis` / `agents.momus` are ordinary custom agent keys and there is nothing to deprecate. `components/task/dag-lint.ts` no longer warns on a retired `subagent_type`, and `components/telemetry/omo-native-tools.ts` reports the submitted subagent name (a retired id masks to `custom` like any other unknown name) instead of canonicalizing it first. `scripts/qa/plan-gated-agents-e2e.mjs`'s four alias scenarios become `retired-id` / `team-retired` / `dag-retired` / `retired-config`, each asserting the removal on a real senpi process: the retired id never reaches plan-reviewer, team_create names the submitted id, a workflow route keeps it verbatim, the config key defines a custom agent, and no surface prints a deprecation line.

## 2026-09-11 — Keep Kibitzer events captured during child startup

A hook event captured while the resident Kibitzer's child was still being started (between the seed envelope being built and `startChild` resolving) was drained together with the seed's own batch and never reached the child. The seed now cuts its payload from the event stream when the envelope is built, exactly as a followUp does, so an event that lands while the child boots opens the next batch and rides the next wake; a child that cannot be started carries that payload - its events and its candidates - into the retry seed after the backoff (`src/components/memory/kibitzer/sidecar-wake.ts`). No event is dropped at the seed boundary any more.

`sidecar.ts`, `observe.ts`, `events.ts` and `sidecar-prompt.ts` are split by responsibility into modules under the 250-line ceiling; every public name is still exported from the original module. The QA lane gains `scripts/qa/dependency-diff-check.mjs`, the supply-chain control the plan's final verification invokes: it diffs every tracked manifest and lockfile between two commits and exits 0 only when no dependency entry was added.

## 2026-09-11 — Persist resident Kibitzer observability

Every settled wake of a resident Kibitzer sidecar now appends one line to `recall/sidecars/<encoded-session>/wakes.ndjson`, next to the child's own session JSONL (`src/components/memory/kibitzer/observe.ts`). The line is a closed record - wake and child generation, status and cause, model, parent cursor span, tool calls, duration, machine-slot wait, provider usage summed over the turn, context estimate, delivered paths - and it is bounded before it is written: the failure reason is cut before any stack frame, masked by both the memory-core and the senpi secret vocabularies and capped like a gate reason, paths and model ids are capped, and the whole line has a hard bound. The directory name is the unpadded URL-safe base64 of the exact parent session id, so two sessions whose ids differ only in characters a sanitizer would fold still get distinct directories.

The `omo-kibitzer:gate` notice moves onto these outcomes with its policy unchanged: an isolated failure is silent (its ndjson line is the only trace), the third consecutive diagnostic failure of one main session appends exactly one actionable notice, and a normal completion or the session's shutdown resets the streak. The record keeps its one-shot fields (`runId` still renders for stored sessions) and gains the additive `wake`; the legacy `omo-memorian:*` renderers are untouched.

Retention is bounded: a sidecar directory idle for seven days is removed by a sweep that runs when an identity's first sidecar comes alive and at every session shutdown. A live session owns its directory through a memory-core lock (`locks/recall-sidecar.<encoded-session>.lock`) from sidecar creation to shutdown, so the sweep skips this process's live sessions by name, skips any directory whose owner lock is held by a live process, recovers a crashed owner only on pid/start-identity proof, and re-checks idleness under the lock before claiming the directory by rename.

## 2026-09-11 — Remove the one-shot Kibitzer machinery

The resident sidecar (`src/components/memory/kibitzer/`) is now the only Kibitzer engine. Each bound main session owns ONE read-only in-process child, created lazily on the first wake-eligible prompt or `tool_call` and disposed at session shutdown. Every prompt, tool call and tool result reaches it as a bounded event - secrets redacted before truncation, then capped by `memory.recall.event_caps`, the newest 20 kept verbatim and older ones folded into a one-line digest - and it spends a model turn only when a batch carries a memory path it has not judged in its lifetime. A wake takes one slot of the machine-wide `recall-wake` lease (`max_concurrent_wakes`, default 2; a busy machine buffers, never drops), may make `tool_budget` (default 8) tool calls within 90 seconds, and speaks through exactly five member-scoped read-only tools: `read`, `grep`, `session_entries`, `memory` (`search`/`read` only) and `nudge`. There is no memory-write tool, no shell and no file write. Past 60% of `sidecar_max_tokens` the child is replaced by a fresh one seeded with its delivered and rejected paths, task summary and last cursor; a failed child is disposed and recreated after a jittered exponential backoff (1 s to 5 min) with every buffered event kept. Automatic reflection failures back off too, in memory-core's reflection journal (`next_eligible_at`, 5 s doubling to 5 min; a manual `/reflect` bypasses it and a successful reflection resets it).

Deleted, with their tests and test-support files: `kibitzer-trigger.ts`, `kibitzer-runner.ts`, `kibitzer-runner.fallback-support.ts`, `kibitzer-judge-run.ts`, `kibitzer-judge-spec.ts`, `kibitzer-prompt.ts`, `kibitzer-concurrency.ts`, `kibitzer-lifecycle.ts`, `kibitzer-run-retention.ts` and `kibitzer-wiring.ts` - the per-launch judge, its candidate-set fingerprint, launch ceiling, trailing slot, process-wide `globalThis` judge slots and the per-run `recall/runs/<id>` directories with `outcome.json`, `candidates.json` and `transcript-window.txt`. `abortAndDispose`, which the facts child also used, now lives in `in-process-memory-child.ts`. The compaction epoch is gone from the pending-nudge file (`PendingNudges.write`/`take` take no epoch; a stored file that still carries `compactionEpoch` is consumed normally), from `recall-drain`/`recall-wiring` (`currentCompactionEpoch`) and from `kibitzer/delivery.accept`: a parent compaction retracts what delivery still holds and never invalidates the sidecar. `omo-kibitzer:gate`, `omo-kibitzer:nudged` and the legacy `omo-memorian:*` renderers stay registered so stored sessions render unchanged; the sidecar's audit trail is its own session JSONL under `recall/sidecars/<encoded-session>/`. `memory.recall.enabled: false` remains the only off switch; there is no legacy mode. Docs (`docs/guide/orchestration.md`, `docs/guide/overview.md`, `docs/reference/configuration.md`, `docs/reference/omo-json.md`), the memory `AGENTS.md` rows, `kibitzer/AGENTS.md` and the give-me-tips skill describe the resident design.

## 2026-09-10 — Model profiles pick the main session model without persisting it

`model_profile` in omo.json now selects the main session model at session start: a profile id (builtin `capable`, `simple-work`, `deep-work`, or a `model_profiles.<name>` chain) walks its rungs against the live registry with the same matcher category chains use; a literal `provider/model` value pins that model. The component (`src/components/model-profile/`) applies the pick through senpi's session-only setter, so `settings.json` `defaultProvider`/`defaultModel` are never rewritten and the profile keeps working on the next start. It runs after senpi's own `recommended-models` builtin and overrides its auto-switch; an unset `model_profile` changes nothing. Mid-session fallback still follows senpi's `retry.fallbackChains`, and the applied notice says so.

`scripts/qa/model-profile-e2e.mjs` proves this on a real senpi process in an isolated home: the tier's third rung is selected with the skipped rungs named, the literal pin applies, an unknown id yields one notice and no model change, no `model_profile` yields no notice, the tier beats the recommended-models auto-switch, and `<agentDir>/settings.json` is sha256-identical before and after every scenario (a bundle mutated to call `pi.setModel` changes the digest, which is the no-persist regression proof). The `--model` provenance scenario is asserted and documents a gap: the current senpi release never attaches `initialModelProvenance: "cli"` to `session_start` (its `main.ts` builds the value but does not pass it to `createAgentSessionFromServices`), so the component must treat an absent provenance as explicit user state to leave a `--model` session alone.

## 2026-09-10 — Name curated agents by role, keep the old ids for one release

The builtin curated agents `metis` and `momus` are now `plan-consultant` and `plan-reviewer`. The ulw-plan skill works as the Ultrawork Planner instead of a named persona, ulw-execute talks about the "ulw-plan work plan", and docs plus omo.dev describe every agent by what it does rather than by a myth name. The draft/plan frontmatter key `review.momus` becomes `review.plan_reviewer`, and telemetry `delegation_started.name` / `delegation_completed.agent_type` report the new ids, so dashboards that filter on `metis` or `momus` need updating.

The old ids still resolve for one release. `subagent_type: "metis"|"momus"`, `omo.json` `agents.metis|momus` and `allowed_subagents` entries naming them canonicalize through `senpi-task/src/agents/legacy-agent-names.ts` and emit a deprecation notice. That alias window ships in the first tagged publish containing this change (currently 5.0.0-beta.51 per package.json) and is removed in the next tagged publish; a test pins the alias table to exactly those two keys so nothing else slips in.

## 2026-09-10 — Hide question tools from task children

`TASK_CHILD_UI_ONLY_TOOL_NAMES` now lists `request_user_input` and `ask_user_question` next to `memory`, so in-process children do not inherit the parent-only question tools. RPC children get the matching `--no-ask-user` flag from senpi-task.

## 2026-09-10 — Route user questions in the ultrawork directive through the question tool

Three sentences in `skills/ultrawork/SKILL.md` told the model to stop, surface, or plainly "ask the user" when only the user could unblock the run: blockers left after two re-reviews, two identical failed attempts at one step, and the goal-waiting paragraph that had no user-decision case at all. With senpi's question tool (`request_user_input` / `ask_user_question`) available, ending the turn or marking the goal blocked is the wrong move. The re-review rule now asks through the question tool with the outstanding blockers as options; the retry rule asks through the question tool and continues on best judgment if the question times out; the goal-waiting paragraph gains one sentence stating that a decision only the user can make is asked through the question tool, waiting for the answer when the run cannot proceed without it, and is never recorded as blocked.

`src/components/ultrawork/generated-directive.ts` is regenerated from the source through `plugin/scripts/embed-directive.mjs`; the `--check` drift gate in `ultrawork.test.ts` failed against the edited source and passes after regeneration. The committed bundle `plugin/extensions/omo.js` is rebuilt on the CI-pinned Bun 1.4.0 so the reload test in `ultrawork-arming.test.ts` sees the same directive from the bundle and from the generated module. Heading count of SKILL.md is unchanged (27). The planned wording `wait_for_answer true` was not used because the embed script rejects any `wait_for` token as a non-senpi harness surface; the sentence says "waiting for the answer" instead.

## 2026-09-10 — Export claude-sdk-oauth as a known telemetry provider

`src/components/telemetry/model-vocabulary.ts` gains a `claude-sdk-oauth` key carrying the same ids as `anthropic`. The builtin Claude rungs in senpi-task now head with that lane (#8051), and without the key every delegated Claude turn on a Claude Pro/Max machine would have exported as `custom`, collapsing the category-model insight on exactly the lane the product routes to. The generated schema block in `docs/reference/senpi-telemetry.md` lists the new provider value; `product-identity.test.ts` pins the mask. The shipped `plugin/extensions/omo.js`, `omo-task.js`, and `omo-init-deep-advisor.js` bundles are regenerated so the plugin carries the new rung order and the model-core tie-break that no longer prefers a shorter provider name.

## 2026-09-10 — Stop failing Kibitzer fires for reasons that are not failures

`Kibitzer gate failed` kept appearing intermittently on beta.51 after the persona prime shipped, from three producers that were not real gate failures (#8052, #7963).

A judge that answers only through `nudge` and then stops without prose is a completed run. senpi's empty-assistant recovery retries one invisible stop and settles the second as `Model returned an empty response twice`, which the gate reported as `child_failed` even after accepted nudges. The nudge tool result now carries `terminate: true` once the run's `max_items` is reached (also on a rejection at the cap), so the agent loop ends the turn on the tool batch and the model never has to answer with nothing; as the floor for runs that stop below the cap, `classifyJudgeTurn` treats that settled message as `completed` when nudges were accepted and `empty` when none were. Accepted nudges are delivered in both cases.

Run-dir artifacts (`candidates.json`, `transcript-window.txt`) are auditable output the child never reads; a write that fails now logs `kibitzer gate run artifacts skipped` and the fire continues instead of ending as `session_create_failed`. A persona read that fails at fire time is reported as `persona_unavailable` with the asset filename in the reason. The `#omo-task-runtime` module is primed at memory-component registration beside the four personas (`omo-senpi memory boot asset unavailable` names a module that cannot load), and a fire awaits that same load instead of resolving the specifier against the install tree at fire time.

The notice policy is unchanged: one notice per session after three consecutive diagnostic failures (PR #8033), which beta users receive with the next release.

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

## Thread tools register unconditionally and gain rename, model, and reasoning control

The `thread` component used to register its tools only when a launch flag said the shared
multi-session host had been enabled. That flag recorded launch opt-in, not host presence. A session
hosted by a supervisor that never opted in (the desktop rpc child is the common case) got zero
`thread_*` tools, even though the socket it needed was right there. The gate is gone: `component.ts`
registers all nine tools every time, and `src/extension/component-list.ts` lists the component right
after `task`. Host absence is now a per-call failure, `{ kind: "error", error: { code:
"host_unavailable", ... } }`, returned as data when the socket path doesn't exist. Nothing throws,
and the tool surface no longer changes shape based on how the process was started.

Three tools join the family. `thread_rename` sets a peer's display label through
`set_session_name`; the id stays the address, and a label already used by another visible thread is
`name_conflict`. `thread_set_model` resolves `provider/id`, an exact id, or a case-insensitive
fragment against the target's own model catalog (`model_not_found` with the available list,
`model_ambiguous` with candidates) and applies the single match through `set_model`.
`thread_set_reasoning` applies one of `off|minimal|low|medium|high|xhigh|max` through
`set_thinking_level`, with `scope: "turn"` leaving the model's remembered level alone; a level the
active model rejects comes back as `thinking_level_unsupported` with the supported list and the
thread untouched. All three require a live owner and go through the same receipt admission as
`thread_send`.

Every tool now reads the caller's id per call from the execution context's
`sessionManager.getSessionId()`. Two addresses reach the caller's own thread: the literal `"self"`
and the caller's explicit durable id. Fuzzy resolution in `thread_handoff` excludes the caller's
entry before scoring, so a near-miss on your own name can't hand work back to yourself. Keep the
`host_unavailable` mapping in the tool wrapper rather than reintroducing a registration gate; the
tools must exist whenever the extension does.

The socket client under all of this (`live-surface.ts` `request()`) also stopped taking the first
JSONL line as the response. A multi-session host writes other lines on the same connection before
the reply: the `open_session` admission notice `{ type: "queued", for_request: <id> }`, which the
engine deliberately tags with the request id under `for_request` rather than the response id, and
connection-wide broadcasts such as `agent_start` and `session_opened`. Any of those used to fail
the pending call with "thread RPC request failed" before the real reply arrived. The client now
settles only on the frame whose `id` matches the request it sent and skips everything else; a
connection that closes first is a named error. Correlate by id, never by position.

Two more things had to be true before a created thread was usable at all. `open_session` answers
with the ROUTING id and a state carrying neither the durable id nor a name, while the address book
keys every entry by the DURABLE id - so `thread_create` returned an id that resolved to `not_found`
on the very next call, and its `name` parameter was silently dropped because the wire has no name
field on open. And `open_session.retain_on_disconnect` defaults to false: this client is one-shot,
so the connection that opens a session drops at once and the host moved the new session straight to
`closing`, answering `session_closing` from then on. `openSession` now applies the name through
`set_session_name`, sends `retain_on_disconnect: true`, and merges the entry the host reports in
`list_sessions` before returning. When QA'ing this surface, run the host from the engine this repo
pins: `retain_on_disconnect` landed in senpi 2026.9.20, and an older host ignores it in silence.
