# omo-senpi

Native Senpi TypeScript extension adapter for oh-my-openagent.

This package is adapter-only. It may depend on harness-neutral core packages plus the Senpi-coupled `@oh-my-opencode/senpi-task` engine, but those packages must not import Senpi, Pi packages, or this adapter through their harness-neutral entrypoints. The Senpi runtime boundary stays here.

## Anatomy

| Path | Purpose |
|------|---------|
| `package.json` | Private workspace package `@oh-my-opencode/omo-senpi`; exports the adapter, extension, and local installer entrypoints. |
| `src/extension/` | Senpi ExtensionAPI composition layer. It validates the required API surface, registers global and per-component disable flags, and wires components defensively. |
| `src/components/` | Eleven live components: `config-startup`, `ultrawork`, `start-work-continuation`, `ulw-loop`, `fallback-architect`, `comment-checker`, `telemetry`, `lsp`, `codegraph`, `task`, and `config-watch`, plus the `config-resolution` loader helper. |
| `src/install/` | Local Senpi installer and uninstaller helpers. They add or remove the absolute plugin path in `SENPI_CODING_AGENT_DIR` or `~/.senpi/agent` settings. |
| `scripts/qa/` | Live Senpi QA drivers, continuation probe, and mock provider used by task 13 validation. |
| `skills/` | Native Senpi skills authored directly against the Senpi tool surface (not ported from Codex or the shared pool); currently `hyperplan`, `ultrawork`, `ulw-loop`, and `ulw-research`. `sync-skills.mjs` ships them verbatim. |
| `plugin/` | The single Pi package `@code-yeongyu/omo-senpi`. It contains generated `extensions/omo.js`, generated skills, package metadata, and plugin-local build scripts. |

The v1 install surface is local-path only. Install the built Pi package from `packages/omo-senpi/plugin`; do not document npm, git, or marketplace distribution for this adapter until that exists in code.

## Components

- `config-startup`: runs the shared lock+journal migration engine (`runSenpiStartupMigration`, both legacy groups: `2026-07-opencode-config-unification` for `oh-my-*` files and `2026-07-codex-config-jsonc` for `~/.omo/config.jsonc`) before Senpi reads its unified configuration, then loads the profile-selected `[senpi]` view through `config-resolution` (`loadSenpiOmoConfig`: `loadOmoConfig` with `harness: "senpi"` plus `resolveModelReferences` catalog expansion). Migration results and config diagnostics surface once on the first `session_start` via the host notification UI (falling back to the logger).

- `ultrawork`: injects the Senpi ultrawork directive on matching input as a hidden custom message (`pi.sendMessage({customType: 'omo-ultrawork:directive', content: DIRECTIVE, display: false})` followed by `{action: 'continue'}`), backed by `src/components/ultrawork/generated-directive.ts`. On the idle path the user's typed text is never modified; senpi converts the custom message into `role: 'user'` conversation context, so the directive reaches the model but is not rendered in the TUI. A prompt QUEUED mid-stream (the input event carries `streamingBehavior`) instead gets the directive appended inside that one message: senpi drains steering and follow-up queues one message at a time by default and answers each drained message, so a separate hidden message would burn its own turn before the user's ask arrived. Appending rather than prepending is what keeps `/skill:` expansion working on that path. All guards are preserved: the `/(?:ultrawork|ulw(?!-))/i` trigger, the `omo-senpi-ultrawork-disabled` flag, skipping `source === 'extension'` inputs, skipping `ulw-` skill names (`ulw-plan`, `ulw-loop`, `ulw-research`), and skipping inputs that already carry a matched `<ultrawork-mode>`...`</ultrawork-mode>` tag pair (a lone open-tag mention still arms). For `/skill:` commands on the idle path there is no prepend/append distinction because text is not rewritten: `/skill:ultrawork` passes through untouched (expansion already inlines the directive), a trigger that appears only in the skill NAME does not arm, and senpi's native skill expansion can no longer be disturbed by the hook. The directive is authored senpi-native at `skills/ultrawork/SKILL.md` and ships verbatim; `plugin/scripts/embed-directive.mjs` embeds its body into `src/components/ultrawork/generated-directive.ts` and fails the build when non-senpi harness tokens (multi_agent, update_plan, codex, ...) appear in the source.
- `start-work-continuation`: reads `.omo/boulder.json` on `agent_end` (the Senpi analog of Codex's Stop hook) and injects a continuation directive when the current session owns an active or paused Prometheus work plan. It uses `senpi:<session_id>` state produced by the `start-work` skill, suppresses repeats by a `work_id:updated_at:completed/total` signature, and caps consecutive continuations at 8 (reset on user input). It registers before `ulw-loop` so active boulder work takes precedence over ulw-loop continuation.
- `ulw-loop`: detects active `omo ulw-loop` state and injects continuation guidance when the cwd has an incomplete run. It explicitly defers to `start-work-continuation` when boulder state is continuable for the same session.
- `fallback-architect`: when senpi's retry-fallback controller moves the session off `claude-fable-5` because the model refused or the provider rejected the request under Anthropic's Usage Policy, it injects one hidden `omo-fallback-architect:directive` message telling the weaker active model to decompose the problem and consult `task(category: "architect")` with self-contained per-part queries. Detection uses only the extension surface: `message_end` supplies the refusal signal and `model_select` with `source: "fallback"` supplies the switch, with the refusal predicate in `detection.ts` mirroring senpi `isClassifierRefusal` (`packages/ai/src/utils/stop-details.ts`) including its stop-reason-first ordering. It fires only when `loadOmoConfig` reports an enabled `architect` category, and a compact reminder then rides on each later user prompt until fable 5 is active again. The reminder is ALWAYS a hidden custom message (`display: false`) and the typed text is never rewritten: on the mid-stream path senpi steers a custom message into the running turn (`sendCustomMessage` -> `agent.steer`), so hiding it costs no extra assistant turn for queued prompts either — the old transform-append leaked the reminder into the user's own bubble in the TUI. Arming also emits one user-VISIBLE `omo-fallback-architect:notice` custom message (`display: true`, structured `details: { from, to }`) framing the switch as an upgrade (the fallback model drives execution while Fable-5-grade reasoning stays reachable through the architect lane); `notice.ts` owns the copy plus a registered TUI message renderer, and the stable customType + details ride senpi's session/event stream so GUI surfaces (omo-desktop-app) can render the same event later without senpi core changes. Gated by `omo-senpi-fallback-architect-disabled`.
- `comment-checker`: runs the shared comment-checker flow after write-like tool results when a resolver finds the binary.
- `telemetry`: sends the anonymous once-per-UTC-day `omo_senpi_daily_active` event, with product-specific opt-outs.
- `lsp`: registers direct LSP tools and optional post-edit diagnostics through the packaged shared LSP daemon runtime. The Senpi adapter owns only descriptors, schemas, renderers, path extraction, and project-config migration warnings.
- `codegraph`: registers the CodeGraph MCP server (stdio, eager lifecycle) when the resolver finds a supported runtime, and skips registration inside senpi-task RPC children. It reads `codegraph.daemon` from `omo.json` at component registration; daemon mode is on by default and omits `CODEGRAPH_NO_DAEMON`, while `daemon: false` pins `CODEGRAPH_NO_DAEMON=1`. `OMO_CODEGRAPH_DAEMON` overrides config (`1`/`true`/`yes` enable; `0`/`false`/`no` disable), so precedence is env > config > default. `registerMcpServer` provides no child handle or unregister surface, so Senpi owns the registered stdio lifecycle.
- `task`: loads the unified `omo.jsonc` view at register (via `config-resolution`), composes the task engine over `@oh-my-opencode/senpi-task`, and registers the 4 task tools (`task`, `task_send`, `task_cancel`, `task_output`) plus the 6 lead-only team tools (`team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`).
  The engine overlays four builtin curated read-only subagents (`explore`, `librarian`, `metis`, `momus`) under the omo.json `agents` record, so any session can delegate via `task(subagent_type: "<name>")` with zero configuration; omo.json `agents.<name>` replaces individual builtin fields field-level while unset fields keep the builtin, and `disable: true` hides one from the task tool description and spawn resolution even when a request supplies an explicit model. Curated agents are pinned to in-process execution (their `execution_mode` override is ignored) and are rejected as team members because process-mode member spawns drop the persona prompt and tool policy. Their nine-name tool surface replaces Senpi's general `bash` with a structured read-only GitHub/HTTPS broker and excludes direct edit/write plus mutating LSP tools. Team sends are durable file-only writes. The adapter owns one 1-second lead poller per team led by the current session; process members load the scoped member extension with only `task_send` and receive lead mail steered into the resident member's running turn. It wires the ordered session-start recovery chain (process reattach, member/lead reservation reclaim, failed-notification retry, owned-lead poll), transition suspension, shutdown teardown, a completion-message renderer, the `/tasks` and `/task-kill` slash commands, and the status-UI footer. Gated by the `--no-omo-task` flag and skipped when required ExtensionAPI capabilities are missing.
- `config-watch`: registers the resolved user and project `.omo` configuration chain with Senpi's optional `config-watch` event protocol. Its dry-run validation rejects new config diagnostics before the host reloads the extension; it safely skips with a warning on older Senpi APIs without the optional events capability. The user config directory is `~/.omo`; when it does not yet exist, its only parent is `$HOME`. Whenever the senpi agent dir sits under `$HOME` — including the default `~/.senpi/agent` — the bare-`$HOME` creation target is dropped by the protected-path filter below, so `userConfigCreationDiscovery` reports `reload_required` and later user-scope creation is discovered on the next session start. With `SENPI_CODING_AGENT_DIR` pointed outside `$HOME` the target survives and creation stays watched. Either way the flag is derived from the surviving targets rather than from directory existence, so it never claims a watch the host never received. Targets that cover the senpi agent dir's protected paths (`auth.json`, `sessions/`, `logs/` under `SENPI_CODING_AGENT_DIR`, default `~/.senpi/agent`) are filtered out of the resolution because the host rejects them deterministically — practically this drops the bare-`$HOME` ancestor target, so a NEW `.omo` created directly in the `$HOME` root is discovered only on the next session start. Rejections are never re-registered synchronously (the host rejects on the REGISTER stack, so a sync re-emit recurses until stack overflow): the refresh is deferred via `setTimeout(0)` and capped at 3 retries per registration-payload fingerprint, resetting when the payload changes.

`packages/omo-opencode` is a separate build that still uses its prior task/team names; cross-edition parity is a deliberate follow-up outside this adapter.

Rules are intentionally not a Senpi component. Senpi has builtin rules, so this adapter must not add a `rules` component just to mirror Codex or OpenCode.

### Dependencies

The adapter depends on `@oh-my-opencode/senpi-task` (task engine + tool factories), `@oh-my-opencode/omo-config-core` (`loadOmoConfig` + `resolveModelReferences` + the migration engine), `@oh-my-opencode/omo-opencode/config-migration` (dependency-clean legacy discovery + transform consumed by `config-startup`), `@oh-my-opencode/delegate-core`, `@oh-my-opencode/team-core`, `@oh-my-opencode/boulder-state` (Boulder work-plan state for `start-work-continuation`), `@oh-my-opencode/comment-checker-core`, `@oh-my-opencode/telemetry-core`, `@oh-my-opencode/prompts-core`, `@oh-my-opencode/lsp-core`, `@code-yeongyu/lsp-daemon`, and `@oh-my-opencode/utils`, with `@code-yeongyu/senpi` as an optional peer (`package.json`).

## Build And Packaging

Build outputs under `plugin/extensions/` and `plugin/skills/` are generated. Do not hand-edit them.

- `node packages/omo-senpi/plugin/scripts/build-extension.mjs` builds `plugin/extensions/omo.js`.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` verifies the generated extension is current.
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` syncs Senpi-ready skills into `plugin/skills/` from three pools: component-owned native sources shipped verbatim (`ulw-loop`), native `skills/` sources shipped verbatim (`hyperplan`, `ultrawork`, `ulw-research`), and the repo `shared-skills` pool (start-work gets a `codex:`->`senpi:` overlay; ulw-plan gets a senpi overlay adding a momus-only review override plus architect/ultrabrain advisory consultation lanes; shared skills get a Senpi tool-compatibility banner).
- `node packages/omo-senpi/plugin/scripts/embed-directive.mjs --check` verifies the generated ultrawork directive is current.
- `bun run test:senpi` runs the package gate: build the shared daemon, stage the plugin artifacts, typecheck, then `bun test packages/omo-senpi`.

Peer-external build rule: the extension build must externalize the Senpi peer/import family so shared core packages stay harness-neutral and Senpi resolves those peers from the installed Senpi runtime. Keep `SENPI_LOADER_ALIASES` in `plugin/scripts/build-extension.mjs` aligned with `src/bundle-purity.test.ts`, including `@code-yeongyu/senpi`, `@earendil-works/pi-*`, and `@mariozechner/pi-*` imports. The current build also externalizes the TypeBox aliases required by Senpi's loader and Node builtins.

## QA

For adapter code changes, run the narrowest relevant unit tests plus the Senpi package gate:

```sh
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
bun run test:senpi
```

Task live QA scripts:

```sh
node packages/omo-senpi/scripts/qa/drive.mjs --self-test
node packages/omo-senpi/scripts/qa/drive.mjs
node packages/omo-senpi/scripts/qa/probe-continuation.mjs
SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs
SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/team-e2e.mjs
node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test
```

`drive.mjs` and the task/team live drivers create isolated Senpi agent directories and ignore caller `SENPI_CODING_AGENT_DIR`. If the Senpi binary is unavailable, the live drivers report `SKIP` or `FAIL` in final JSON instead of touching the real `~/.senpi/agent`.

Task-component QA in this package: `packages/omo-senpi/scripts/qa/task-13.test.ts` exercises the task engine wiring, `task-e2e.mjs` covers single and batch task lifecycles, `team-e2e.mjs` covers injection-driven delivery, shutdown-via-`task_send`, stale-reservation reclaim, member-liveness events, and kill/restart exactly-once recovery, and `task-rpc-e2e.mjs --self-test` pins the RPC driver scripts. The `@oh-my-opencode/senpi-task` unit + chaos suites (`bun test packages/senpi-task`) cover the state machine, runners, and completion invariants. The task engine's own standalone manual drivers live under `packages/senpi-task/scripts/` (see [`packages/senpi-task/AGENTS.md`](../senpi-task/AGENTS.md)).

## Evidence Rules

Live Senpi QA evidence goes under `.omo/evidence/omo-senpi-adapter/`, one subdirectory per change or task. Record:

- what command or manual action was run;
- what behavior it was meant to prove;
- the observed result, including final JSON from the QA driver when present;
- isolation proof, especially the sandbox `SENPI_CODING_AGENT_DIR` and whether the real Senpi agent dir stayed untouched;
- omitted or redacted material, especially raw logs that could contain secrets.

Do not claim live Senpi QA from unit tests alone. `bun run test:senpi` is the package gate; the scripts in `scripts/qa/` are the real harness proof.
