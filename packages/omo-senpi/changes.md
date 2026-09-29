## 2026-10-01 - In-process task children honor the caller's settings (#9353)

- `components/task/runtime-context.ts` captures the parent session's project-trust decision, and `engine-runners.ts` passes it to every in-process child, so the child's settings include the project layer exactly when the parent's do. `plugin/extensions/omo-task.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change.

## 2026-10-01 - Windows RPC kills tolerate repeated Bun startup advisories (#9228)

- The task bundle treats any number of known Bun child-reaper advisory lines as advisory-only stderr for Windows code-1/no-signal exits. Any different stderr line remains a crash diagnostic.

## 2026-10-01 - Windows task-child parity regression (#9274, #6709)

- The parity regression now reloads the in-process child loader beside the process child's builtin loader policy and pins equal platform-specific builtin names plus `web_search`, avoiding Windows CLI cold starts while the existing surface tests retain shared-parent and session-default coverage.

## 2026-09-30 - Task children keep senpi builtin tools in the default in-process mode (#9274, #6709)

- The task extension bundle now gives in-process children senpi's builtin-only extension surface while continuing to suppress the parent's path-loaded extensions. The parent tool-capture wrapper stops after omo component registration, so builtin factories senpi loads later are not re-injected as raw custom tools. A mock-provider integration test compares the actual in-process and process child tool payloads and requires `web_search`.
- `plugin/extensions/omo.js` and `omo-task.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change; the extension freshness checks pass.

## 2026-10-01 - Geeky lanes: Astra at high, GPT-6.1 Sol Fast leads Geeky · Normal (#9372)

- `src/components/model-profile/builtin-profiles.ts`: `geeky-heavy` runs `gpt-6-astra` at `high` (was `xhigh`). `geeky-normal`
  leads with `gpt-6.1-sol-fast` (medium, `chatgpt-subscription|openai`), then plain `gpt-6.1-sol` (medium, same lanes), then the
  unchanged `gpt-5.6-sol` (medium, all four GPT lanes). Plain 6.1 Sol stays behind the Fast tier so a registry without
  `gpt-6.1-sol-fast` still lands on 6.1 Sol rather than dropping to 5.6 Sol.
- `scripts/qa/model-profile-e2e-scenarios.mjs`: both geeky-heavy scenarios expect thinking `high`; new `geeky-normal-sol-fast`
  serves 5.6 Sol, 6.1 Sol and 6.1 Sol Fast and expects the Fast tier at medium.
- Tests: `index.test.ts` starts a session on each geeky-normal registry shape (Fast served -> Fast medium; Fast absent ->
  plain 6.1 Sol medium) and geeky-heavy (Astra high); removing the Fast rung fails the Fast case.

## 2026-09-30 - claude-code: acquire before the auth check, from the provisioned runtime, with progress (#9276)

- `src/components/claude-code/index.ts`: the component now also runs on `input`, which senpi's `prompt()` emits
  before `checkAuth` (`emitInput`, then `checkAuth`, then `emitBeforeAgentStart`), so a prompt from a
  `claude login`-only user downloads the executable before the ambient auth probe needs it. `before_agent_start` stays
  for turns an extension starts (they skip `input`), registered `previewSafe` and skipping the prompt-cache preview.
  The pin and cache root come from `claudeCodeRuntimeDir` (`OMO_PACKAGE_DIR`, else `dirname(execPath)`), since the
  compiled launcher pins the provisioned runtime there while `execPath` can still be the downloaded binary.
  A progress status (`omo-claude-code`: `Downloading Claude Code <version>: N% of M MB`, every 10%) shows while the
  tarball streams (`acquire.ts` `onProgress`). New `applyCachedClaudeCode` lets the compiled launcher point the engine
  at an already-downloaded copy before it starts.
- Limit: on the launch that downloads, the startup ambient probe may already have cached "not signed in" for 30 s
  (`availability.ts` `AMBIENT_STATUS_TTL_MS`); the next prompt after that window, and every later launch, resolve it.

## 2026-09-30 - model-profile e2e: lane-beats-recommended-models proves a real recommended-models switch (#9238)

- `scripts/qa/model-profile-e2e-scenarios.mjs`: `lane-beats-recommended-models` serves `mock-1`, `glm-5.3` and
  `gpt-6-astra` on `chatgpt-subscription` + `opencode-go`, so no provider serves its engine provider default
  (`gpt-6.1-sol`, `kimi-k3`). The session starts first-available on off-ladder `mock-1`, senpi's recommended-models
  builtin switches to `chatgpt-subscription/gpt-6-astra`, and Daily · Normal still wins with `opencode-go/glm-5.3` max.
  The old fixture's
  only `gpt-6-sol` entry was the engine's initial provider-default record, which senpi#2393 moved to `gpt-6.1-sol`;
  the builtin never switched there. `gpt-6-astra` keeps its ladder rung across senpi#2394's Sol-slot move.
- `scripts/qa/model-profile-e2e.mjs`: that scenario's checks skip the initial-model record. `started_off_recommended_ladder`
  requires the first `model_change` to be `mock-1`, and `recommended_models_switched_first` requires the builtin's
  `chatgpt-subscription/gpt-6-astra` change to come after it and before the lane's `opencode-go/glm-5.3`.

## 2026-09-30 - model-profile: Recommended leads its GPT-6 Sol slot with gpt-6.1-sol medium, gpt-6-sol behind it (senpi#2394)

- `src/components/model-profile/builtin-profiles.ts`: `recommended` replaces its `gpt-6-sol` (medium) rung with
  `gpt-6.1-sol` (medium) on `GPT_6_1_PROVIDERS` (`chatgpt-subscription|openai`), immediately followed by `gpt-6-sol`
  (medium) on the shared `GPT_PROVIDERS` ranking, so Copilot and OpenCode Zen, which do not serve 6.1 Sol, still resolve
  GPT-6 Sol. senpi#2394 makes the same switch in `RECOMMENDED_DEFAULT_MODELS`; OmO keeps the extra `gpt-6-sol` rung, and
  the header comment says so. The lanes are unchanged. Telemetry already carries `gpt-6.1-sol` (#9214).
- Tests: `builtin-profiles.test.ts` pins the seven-rung chain and the providers of both Sol rungs; `resolve.test.ts`
  resolves `chatgpt-subscription/gpt-6.1-sol` medium when the subscription serves it next to `gpt-6-sol`, and
  `github-copilot/gpt-6-sol` medium on a Copilot-only registry; `index.test.ts` applies both at session start.
  `scripts/qa/model-profile-e2e-scenarios.mjs` adds `unset-gpt-6-1-sol` and `unset-copilot-gpt-6-sol`.
- Docs: the Recommended ladder in `docs/guide/agent-model-matching.md`, `docs/guide/overview.md`,
  `docs/guide/installation.md` and `docs/reference/omo-json.md`.
- `plugin/extensions/` bundles regenerated on linux/amd64 (node 24, bun 1.4.2) for the chain change.

## 2026-09-30 - lsp: post-edit install nudges stay inside projects and appear once per server (#9223)

- `components/lsp/post-edit-outcome.ts` (moved out of `index.ts`) turns a daemon `not_installed` availability into the structured post-edit outcome, carrying `serverId`, `installDecisionTool` and a recorded decision.
- `components/lsp/index.ts` `handlePostEditDiagnosticsToolResult` classifies each edited file against the session cwd and the engine-resolved agent dir (`resolveSessionAgentDir`, else `resolveAgentHome`): files outside a project, in the agent dir, or in a temp dir get no nudge, and each server is nudged once per session (reset on compaction).
- `plugin/extensions/omo.js` regenerated on linux for the change above.

## 2026-09-30 - memory/kibitzer: connected-first sidecar model order (#9216)

- `components/memory/kibitzer/sidecar-connected-order.ts` (new) `orderKibitzerCandidatesByConnection`: with a known, non-empty availability list the first connected candidate leads and unconnected ones trail; none connected returns the providers to connect.
- `components/memory/kibitzer/sidecar-model.ts` `resolveKibitzerSidecarModel` applies it to category-sourced resolutions and returns `category_unavailable` when nothing is connected. The `task` tool path is untouched.
- `plugin/extensions/omo.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for the change above; `build-extension.mjs --check` and `build-install.mjs --check` pass on the regenerated tree.

## 2026-09-30 - model-profile: Geeky · Normal leads with gpt-6.1-sol medium; telemetry knows the 6.1 Sol ids (#9214)

- `src/components/model-profile/builtin-profiles.ts`: `geeky-normal` is `gpt-6.1-sol` (medium) on `chatgpt-subscription|openai`
  (the new `GPT_6_1_PROVIDERS`: Copilot and OpenCode Zen do not serve 6.1 Sol, and every builtin rung must name a pair the
  product knows), then `gpt-5.6-sol` (medium) on the shared `GPT_PROVIDERS` ranking. The `recommended` row and every other
  profile are unchanged.
- `src/components/telemetry/model-vocabulary.ts`: `gpt-6.1-sol` and `gpt-6.1-sol-fast` join the `chatgpt-subscription`,
  `openai` and `openai-codex` vocabularies and `gpt-6.1-sol` the `vercel` one, so the new deep-low rungs export as themselves
  instead of `custom`; `docs/reference/senpi-telemetry.md` is regenerated from the schemas.
- Tests: `builtin-profiles.test.ts` pins the two-rung chain, `resolve.test.ts` resolves `chatgpt-subscription/gpt-6.1-sol`
  medium when the subscription serves both, and `index.test.ts` applies it at session start; the Copilot-only and GPT-6-only
  cases still resolve 5.6 Sol and report unavailable. `scripts/qa/model-profile-e2e-scenarios.mjs` `geeky-normal-sol` serves
  `gpt-6.1-sol` next to `gpt-5.6-sol` and expects 6.1 Sol.
- `plugin/extensions/omo.js`, `omo-task.js`, `omo-init-deep-advisor.js` regenerated on linux/amd64 (node 24, bun 1.4.2) for
  the chain, profile and vocabulary changes; `omo-member.js`, `memory-run-supervisor.mjs` and `omo-computer-use.js` rebuilt
  byte-identical, so they are unchanged.

## 2026-09-30 - thread_send and thread_handoff always deliver through the session gateway; the mailbox and file receipts are gone (#9143)

With senpi 2026.9.29-4 adopted (wake, admitExternalMessage, terminal control endpoints), the send switch flipped and then went away: `THREAD_SENDS_THROUGH_GATEWAY`, the `sendThroughGateway` option, the mailbox branch and the terminal-unsupported guard in `tools.ts` `deliver` are deleted, and so are `mailbox.ts`, `mailbox-journal.ts`, `mailbox-journal-codec.ts`, the mailbox-era file receipts in `receipts.ts` and their tests. A send is now always a durable gateway row with its own receipt: a terminal target is queued for its own inbox and woken instead of answering `unsupported`, and a send to the caller itself is refused `loop_detected` (`self_send`). The endpoint, terminal and self-resolution tests assert that (queued row, a `wake` to the owning endpoint, no `prompt`/`get_state`). The task-14 QA drivers that exercised only the deleted modules (`queued-resume`, `uncertain-operation` and its child) are retired, and the three cross-surface drivers deliver with the QA-only `deliverAuto` in `scripts/qa/thread-tools/lib/harness.mjs`. `gateway/legacy-mailbox.ts`, which reads a pre-gateway mailbox for the store's import, stays.

## 2026-09-29 - plugin bundles carry the typed launch_spec_insecure start failure (#9208)

- `plugin/extensions/omo-task.js`, `omo-member.js`, `omo.js` (source-digest marker only) and `plugin/runtime/rollback-migrate.js`
  regenerated on linux/amd64 (node 24, bun 1.4.2) for the senpi-task change: a task host that refuses a group- or
  world-writable launch spec now fails the start typed `launch_spec_insecure` with the spec path and `chmod 644 <path>`,
  and rollback strips the new reason like every post-R0 reason. No adapter source changed.

## memory, telemetry: Kibitzer recall runs on a Z.ai-only or Xiaomi-only machine (#9202)

- `memory/kibitzer/sidecar-model.test.ts`: with only `zai` or only `xiaomi` logged in and no quick config, the sidecar
  resolves `zai/glm-5.3-flash` or `xiaomi/mimo-v2.6-flash` at `low`. On dev both refused with `beyond_category`,
  because the quick chain had no rung for them. The chain change is in senpi-task.
- `telemetry/model-vocabulary.ts`: adds `glm-5.3-flash` under `zai` and `zai-coding-cn`, and `mimo-v2.6-flash` under
  `xiaomi`, so the new rungs export by name. `docs/reference/senpi-telemetry.md` is regenerated.

## thread, task: agent state stays out of the user's repository (#9201, DESKTOP-31)

- `components/thread/live-surface.ts` `defaultThreadStateDirectory`: the thread tools' mailbox and receipts move from
  `<project>/.omo/thread-tools` to the same per-project folder as the task state
  (`@oh-my-opencode/senpi-task` `resolveProjectStateDirectory`); a pre-existing in-project folder keeps being used.
- `components/task/engine-state-dir.test.ts`: a fresh project stays empty after the engine persists task state, a
  pre-existing `.omo/senpi-task` is kept, and `task.state_dir` wins.
- Root `test-setup.ts` drops an inherited `OMO_`/`SENPI_`/`PI_CODING_AGENT_DIR`, so a test run started inside a live
  session resolves agent-dir state under the hermetic HOME, as in CI.

## skill-commands, skills: argument-taking skills wait for their arguments in the slash picker (#9168)

- `skills/{hyperplan,init-deep,mass-ulw,ulw-loop,ulw-plan,ulw-research}/SKILL.md` and the shared-pool
  `ulw-execute`, `refactor` and `remove-ai-slops` declare `argument-hint`. From senpi#2258 on, the picker reads it
  (`Skill.argumentHint`) and Enter on a `skill:<name>` row fills `/skill:<name> ` and waits instead of submitting the
  skill empty. Skills that take no arguments stay hint-less and still submit on one Enter.
- `components/skill-commands/autocomplete.ts`: a bare alias row mirrors its own `skill:<name>` row on the same page,
  taking its description (which carries the hint) and `awaitsArguments`, so `/ulw-execute` waits exactly when
  `/skill:ulw-execute` does. `pi.getCommands()` carries no hint, so the page row is the source. Without the skill row
  the alias falls back to the command description and submits as before.
- `components/skill-commands/argument-hints.test.ts` parses every shipped SKILL.md with the engine's own
  `parseFrontmatter` (native copy over the shared one, as `sync-skills.mjs` ships them) and pins the set of hinted
  skills.

## computer-use, x-search: a feature skill yields to a loaded same-name skill and honors disabled_skills (#9160)

- `components/bundled-skills/contributed-skill.ts`: `resolveContributedSkill` decides one `resources_discover` pass for a
  skill a component contributes on its own. `disabled_skills` hides it (`readDisabledSkills`, now shared with the
  bundled-skills component). A `skill:<name>` entry in `pi.getCommands()` whose `sourceInfo.path` is not ours means
  senpi already loaded a same-name skill, which wins first-path either way, so ours is withheld instead of becoming a
  "Skill conflicts" collision. Our own path left over from an earlier pass still contributes.
- `components/computer-use/index.ts`: the `computer-use` skill goes through it; `/computer status` adds
  `skill: your own computer-use skill is active in place of the built-in guide (<path>)` when it yielded. New `env`
  option for the config read.
- `components/x-search/index.ts`: the conditional `x-search` skill goes through it. Both tools stay registered.
- `extension/types.ts`: `getCommands()` entries carry the optional `sourceInfo.path` senpi already reports.

## thread: AGENTS documents endpoint kinds, the delivery table, budgets, binding invariants, the outbox contract and completion arms

`src/components/thread/AGENTS.md` gains the `rpc_host`/`tui` endpoint kinds, the 15-cell `decideDelivery` table (the gateway's `auto` queues as a follow-up and never steers, unlike the mailbox path), every fixed budget with its constant (250 ms settle wait, the lock wait that gives up at about 25 s and never past 30 s, the retry on `lock_wait_exceeded`, the loop guards and rate limits), the binding invariants, the outbox contract, the completion arm lifecycle including the settle race, and the QA commands for the CLI, adopt and the built SDK. The live-surface row no longer says `omo daemon attach` sessions live on the legacy socket, and the package `AGENTS.md` names `omo daemon run` and `adopt` for `rpc.sock`. Docs only.

## thread: script-callable SDK (`plugin/runtime/thread-sdk/sdk.js`) for the `omo thread` CLI and connectors

- `components/thread/sdk.ts` (exported from the component barrel): `createThreadSdk({ agentDir, cwd, uid, user,
  engineStatusAll? })` runs every thread operation without an agent session as `cli:<uid>`: `list`, `read`, `send`
  (bindingless = the engine's `cli` sender; with `binding_id` = the connector inbound path, the idempotency key as the
  event id), `bind`/`unbind`/`rebind`/`bindings`/`report`/`outbox`/`ack`/`answer`, `locate` and `release` (senpi
  `release_session` for `omo daemon adopt`). Refusals and transport failures come back as data.
- `tools/gateway-services.ts` and `tools/read-ops.ts`: the store/engine/relay composition and the `thread_list` /
  `thread_read` bodies moved out of `tools.ts`, shared by the tools and the SDK (tool behavior unchanged).
- `gateway/store.ts`: `workerModuleUrl` option (where the worker sidecar is resolved from outside `omo.js`).
  Its worker no longer inherits `--input-type` (node refuses it for a file worker), so an inline
  `node --input-type=module -e` connector script can open the store.
- `live-surface.ts` takes `resolveTaskHostSocket` from `daemon-contract.ts` and `memory/worker/senpi-command.ts` takes
  the launcher helpers from `@oh-my-opencode/senpi-task/rpc-spawn`: the standalone SDK bundle no longer pulls the
  task engine (the full barrel made `bun build --outfile` emit assets and fail).
- Build: new entry `src/extension/thread-sdk.ts` -> `plugin/runtime/thread-sdk/sdk.js` (node builtins only external),
  in `--check`, the installer's required artifacts and the omo-ai payload verifier.
- `sdk.dispose()` cancels the relay's background answer-release retries before closing the store, as the component's
  `session_shutdown` does.
- A completion armed from outside the session reaches a running session: after `report` answers `armed: true`, the
  SDK wakes the session's endpoint (`wake` with no delivery ids, best effort), and the component reads the durable arm
  on that `wake` command edge (`registration.ts` `onCommandWake`, the same lock-free `pendingCompletionArms` read as
  the `session_start` pickup) and writes it at the next settle. An ordinary settle still makes no store call.

## thread: chat-thread bindings, report/outbox/answer relay tools, SQLite tool receipts, gateway send path behind a switch

- `components/thread/tools/relay-tools.ts`, `contracts/`, `metadata.ts`: eight new tools - `thread_bind`,
  `thread_unbind`, `thread_rebind`, `thread_bindings`, `thread_report`, `thread_outbox`, `thread_outbox_ack`,
  `thread_answer` - over the gateway store. A binding attaches a session to one external conversation thread
  (`platform` discord|telegram|slack|herdr|custom, `account_id`, `chat_id`, `thread_id`); one thread has at most one
  active binding (`binding_conflict` names the holder), unbind/rebind are CAS on the revision (`stale_revision`), a
  rebind never extends the TTL (default one week) and refuses work queued under the old revision (`binding_closed`).
  `thread_report` writes only through the calling session's own binding (the originating one by default); a question
  returns an HMAC reply token, and `thread_answer` is refused `binding_mismatch` unless the answer arrives through the
  binding that asked, `stale_token` after a rebind, expiry or session restart, `already_answered` on a replay.
  Completions are armed by `thread_report` and written only when the session settles, with the real outcome. A
  session that armed nothing never opens the gateway store when it settles, and an armed write never holds the settle
  for more than 250 ms: it finishes in the background, retried with the run's own outcome while another process holds
  the store's lock, and an arm made before a restart is written at the session's next settle. Relay text is capped at 32 KiB of
  UTF-8 bytes and refused as `message_too_large`.
- `components/thread/errors.ts`: six new codes (`binding_conflict`, `binding_mismatch`, `binding_inactive`,
  `stale_revision`, `stale_token`, `already_answered`); `loop_detected` now tells the model to answer through
  `thread_read` / `thread_report` / `thread_answer` instead of replying directly.
- `components/thread/tools.ts`: the tools' idempotency receipts move from files under the thread state directory to
  the gateway store's `receipts` table, with the same replay / conflict / in-progress / uncertain behavior.
  `thread_send` / `thread_handoff` can deliver through the gateway engine (results add `delivery_id`,
  `effective_mode`, `endpoint.kind`; new outcome `queued_offline`); that path stays off
  (`THREAD_SENDS_THROUGH_GATEWAY = false` in `component.ts`) until the senpi release with `wake` and
  `admitExternalMessage` is adopted.
- `components/thread/gateway/drain.ts`, `provenance.ts`: a delivery waiting behind the running turn or the user's
  draft shows one notice in the session ("remote message from <actor> queued (<delivery_id>)"); the provenance header
  names the binding and its revision for a delivery that came through one.
- `components/thread/gateway/schema.ts`, `store-ops.ts`, `store-worker.ts`: schema v2 (additive: session
  incarnation, outbox question/answer/outcome columns, per-binding ack cursors, completion arms). Opening a current
  store takes no write lock, and two processes opening a brand-new store at once no longer fail on the WAL switch or
  apply a migration twice. A store operation waits at most 30 s in total for the write lock, so a suspended process
  holding it can no longer stall every store call indefinitely; a session's inbox drain that gives up there retries on
  its own every 5 s until the delivery gets through, and a failed answer hand-off is always returned to pending. A tool
  call whose receipt could not be recorded answers `idempotency_uncertain` on retry instead of `idempotency_in_progress`.

## thread: address book over terminal endpoints with real names/timestamps; sessions drain their gateway inbox

- `components/thread/endpoint-registry.ts`: new. Reads senpi's endpoint registry
  (`<agentDir>/rpc-host-daemon/<16hex>/endpoint.json`, layout 2) without writing or connecting: `endpoint_kind`
  `tui`/`rpc_host` (a record without `registry_version`/`endpoint_kind` reads as `rpc_host`), the directory accepted only
  when the socket's canonical path hashes to it. Used to classify a socket's kind, and to enumerate when the engine's
  `host status --all` cannot.
- `components/thread/live-surface.ts`: `host status --all` rows keep `endpoint_kind`, `alive`/`reason` and a terminal
  owner's session path. A terminal control endpoint (`t-<16hex>.sock`) is reached with its 32-byte secret first and
  only with `get_protocol_info`, `list_sessions`, `get_state`, `get_messages`, `set_session_name`, `wake`, `subscribe`,
  `extension_ui_response`; anything else is refused as `unsupported` before a connection opens, and is answered as
  data by the tools. A terminal the engine reports not alive is not dialed; it is listed from its session file with
  `error_note: "live_unresponsive"`. The surface also exposes the gateway's sender port (`wake`, host-only
  `release_session`, liveness) - a delivery is announced with `wake`, never `prompt`.
- `components/thread/address-book.ts`, `session-facts.ts`, `tools/internals.ts`: every thread carries `endpoint`
  (`kind`, `socket`, `routing_id`), `surface` (`tui` | `desktop` | `child` | `daemon`) and `alive`; its name is the
  session's `/name` (else the first 60 characters of its first user message, never the durable id) and its
  `created_at`/`updated_at` come from the session header and last entry (read from the first and last 64 KiB of the
  file) instead of 1970.
- `components/thread/tools.ts`: `thread_send`/`thread_handoff` to a terminal session answer `unsupported` (a terminal
  takes messages only through its gateway inbox), as do interrupt, model and reasoning changes.
- `components/thread/gateway/registration.ts`, `component.ts`: on an engine that exposes `pi.session`
  (`registerControlEndpoint`, `admissionGate`, `admitExternalMessage`, `listAdmittedDeliveries`, `persistHeaderNow`),
  the thread component persists the session header and registers the session's control endpoint with the gateway
  inbox drain; shutdown disposes the endpoint before the store. On today's engine nothing is registered.
- `components/thread/gateway/store.ts`, `plugin/scripts/build-extension-core.mjs`, `check-extension-current.mjs`,
  `src/install/plugin-artifacts.ts`: the gateway store's worker thread ships as its own build output,
  `extensions/gateway-store-worker.mjs`, beside `omo.js` (a bundler cannot inline a `Worker` entry). The store
  resolves it from its own module location and falls back to `store-worker.ts` in source; `build-extension --check`
  and the installer's required-artifact list include it. Without it the built extension's inbox drain could not open
  its store (`MODULE_NOT_FOUND`).
- `components/thread/gateway/registration.ts`: the store is stamped with `pi.sessionContext.host_instance`, so a host
  `release_session` settles only its own runtime's claims.
- `components/thread/live-surface.ts`: a terminal endpoint whose socket is gone is reported `dead` instead of a raw
  `host_unavailable:<path>`.

## thread: gateway store and delivery engine (SQLite, receipts, causal loop guard)

- `components/thread/gateway/`: new, not wired into the tools yet. One SQLite store at `<agentDir>/gateway/gateway.sqlite`,
  owned by a worker thread so no store call blocks a session loop, holds every cross-session delivery (`deliveries`),
  its idempotency receipt, the causal graph and the rate buckets, plus the `bindings`/`outbox` tables the binding
  tools use. A send writes its row and the target's inbox marker in one `BEGIN IMMEDIATE` transaction; the target's
  own drain is the only path out of `queued` and marks a row `applied` only after the runtime wrote its transcript
  entry. Loop guards (cycle refusal per causal root, 4 hops, 8-burst/5 s pair bucket, 16 targets per turn, 64
  deliveries per root, 7-day roots, 24 h queue TTL) and a lost-ACK rule (`idempotency_uncertain`, never a resend)
  are enforced in that transaction. The first open migrates a legacy `<cwd>/.omo/thread-tools/mailbox` journal once.
- `components/thread/errors.ts`: new code `loop_detected`.
- `components/thread/gateway/store-ops.ts`: a row claimed by a live host that since released the session
  (`session_released { host_instance, released_at }` in the transcript, naming the claim's own host generation, claimed
  at or before `released_at`) is settled by the disk-token rule like a dead claimant's, instead of reading
  `dual_runtime` forever. A claim by any other runtime, or made after the release, stays `dual_runtime`.
- `components/thread/gateway/adapter.ts`: provisional senpi types aligned with the branches (registration union,
  `release_session` request/refusal shape, drain result mapping).
- `omo-native/test/sqlite-import-discipline.test.ts`: covers the gateway; only `store-worker.ts` imports `node:sqlite`,
  lazily.

## memory: a late Kibitzer verdict no longer steers an extra turn after the final answer

- `components/memory/kibitzer/delivery.ts`: an accepted verdict steers at once only while the running session has a
  tool call executing. The host reads its steering queue after every turn, so a steer queued once the final answer
  was streaming or streamed started one more assistant turn after it; a headless `senpi -p` consumer that posts only
  the last assistant text then lost the real answer (observed as `answer -> omo-kibitzer:recall -> "NO_REPLY"`). Such a
  verdict is now held for the next `tool_result` steer or the next prompt's drain, like any other held nudge.
- `components/memory/kibitzer/hooks.ts`: `tool_call` / `tool_result` report the executing call ids to delivery, and a
  new `turn_end` hook clears them so a call that never reports a result (blocked, aborted) cannot outlive its turn.

## model-profile, task: builtin lanes and the category notice never route to an unlisted gateway (#9146)

- `components/model-profile/resolve.ts`: every builtin rung, in `recommended` and in the `daily-*`/`geeky-*` lanes, is
  served only by its listed providers, so a lane never lands the session on a gateway's copy of its model
  (`opengateway/anthropic/claude-opus-5-5`). A lane no listed provider serves is `unavailable` and keeps the session
  model with the existing one-line notice. A user's bare model id, which names no provider, still matches anywhere.
  `rankedProvidersOnly` is gone: it was the only builtin that had the listed-only rule, which is now the rule.
- `components/task/category-unavailable-warning.ts`: when only an unlisted provider serves a hidden category's chain,
  the one notice per session names it and the exact opt-in line
  (`categories.<name>.model = "<gateway>/<model>"`); `details.unlisted_provider_model` carries it for remote clients.

