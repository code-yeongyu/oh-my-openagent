# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New npm package `omo-ai` (beta channel only): the senpi-native edition. `npm i -g omo-ai@beta` installs the `omo` command, which launches the pinned senpi release with the full OMO extension loaded, and `omo setup` imports API credentials from sibling harnesses with consent. Channel contract: every version is a prerelease published with `--tag beta`, so a bare `npm i -g omo-ai` fails with ETARGET by design and `latest` never advances past the deprecated placeholder. Upgrade order: machines with oh-my-openagent/oh-my-opencode 4.19.4 or earlier must upgrade or uninstall that package first (it owns the old global `omo` bin), then install `omo-ai@beta`. See docs/reference/omo-ai-publishing.md.

- Unified `omo.jsonc` configuration surface across all three harnesses: `~/.omo/omo.jsonc` plus walked project `.omo/omo.jsonc` layers, VSCode-style `[opencode]` / `[senpi]` / `[codex]` harness blocks, opt-in `profiles` activated by `OMO_PROFILE` > `OCX_PROFILE` > `OPENCODE_CONFIG_DIR` tail, and a shared `models` catalog whose entries fill unset tuning while site tuning wins.
- Runtime legacy-config migration: a lock+journal engine imports `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` and `~/.omo/config.jsonc` into the unified file with no-clobber conflict diagnostics, `_migrations` markers, and resumable backups under `~/.omo/migration-backup-<UTC timestamp>-opencode-config/`; runs at plugin startup (OpenCode + Senpi), Codex startup (config.jsonc group only), install, and `oh-my-openagent config migrate` (`--dry-run` / `--json`).
- Reasoning unification: `reasoning` is now the canonical config field, `models` is the shared ordered chain, `provider_options` is the escape hatch for wire-specific knobs, model strings accept a `:level` suffix, and deprecated keys remain readable during the back-compat window while the migration rewrites persisted config to the unified schema.
- Doctor surfacing for deprecated reasoning keys now reports exact file and key paths so users can clean up stale config before the removal window closes.
- CodeGraph upgraded to 1.5.0; managed 1.0.1 and 1.4.1 runtimes re-provision automatically, while existing project stores remain compatible without a manual re-index.
- Opt-in CodeGraph shared daemon across all three adapters: `codegraph.daemon` config key (default false) on OpenCode and Codex, `OMO_CODEGRAPH_DAEMON=1` on Senpi, plus `codegraph.excluded_roots` parity. (PR #6251)
- Process hygiene: parent-liveness watchdogs exit MCP server processes when their parent dies, new lsp daemons reap older-version daemons at startup, and a startup family sweep removes orphaned codegraph and lsp processes on every adapter. (PR #6262)
- `omo doctor` reports stale orphaned engines: interactive senpi engine processes whose launcher died underneath them (reparented to pid 1) are listed with pid, age and tty. Terminating them is an explicit, per-pid opt-in - `omo doctor --reap <pid> [pid...]` - which refuses any pid that is not an orphaned interactive engine at the moment of the request (a live session, an `--mode` rpc/app-server engine, or anything that is not an engine at all). Nothing is ever matched and killed by pattern.

### Changed

- **OmO Native runs on bun wherever bun exists, no config needed.** The `omo` launcher used to hand itself to bun only for `bun add -g` installs; every other install stayed on node even on a machine with bun, so the JS eval kernel ran under node and the bundled `bun-1-4` skill never surfaced. Now any install (npm, project-local, `bunx`) probes the bun it finds (`$BUN_INSTALL/bin`, `~/.bun/bin`, PATH) once per node boot and re-execs under it when it is >= 1.4.0; bun-global installs keep trusting the bun that installed them without a probe. `OMO_RUNTIME=node` is still the way to stay on node, and `OMO_RUNTIME=bun` still forces bun without the version floor. See docs/reference/omo-ai-publishing.md, "Runtime selection".
- OmO Native beta.23 adopts Senpi 2026.8.27 and documents the JavaScript-first eval workflow: persistent state, `Promise.all` fan-out, bounded `parallel()`/`pipeline()` composition, idle-kernel continuation for detached work, literal-safe top-level persistence transforms, explicit detached-cell diagnostics, bounded eval telemetry, worker-crash recovery, and Node 24/Bun 1.4 compatibility. It intentionally describes telemetry and mechanisms without inventing an uncommitted percentage speedup.
- **Detailed eval runtime notes:** The first eval examples now use JavaScript to establish reusable state, then use `await Promise.all(...)` for independent tool calls, and finally demonstrate continuing in Python when JavaScript is busy with detached work. This is the documented fast path because eval kernels are persistent per session and per language; a value created in one JavaScript cell remains available to the next cell, while resetting Python does not reset JavaScript.
- **Safer persistence transforms:** JavaScript state capture now rewrites only top-level declarations, including destructuring and uninitialized bindings. Declaration-shaped text inside strings, comments, and nested function bodies is left unchanged. The result is safer reuse for templates, examples, regular expressions, and embedded snippets without weakening the state-carrying behavior.
- **Bounded parallel composition:** `parallel(thunks)` runs asynchronous thunks through a bounded pool with result-order preservation, and `pipeline(items, ...stages)` applies stage barriers while reusing the same bounded fan-out. The default pool width is four. The release describes the mechanism and its telemetry rather than promising a percentage improvement that has not been benchmarked and committed.
- **Busy-kernel recovery guidance:** A detached cell keeps its language kernel busy until terminal settlement. A competing request receives the occupied cell context and the list of idle enabled kernels, so the agent can continue in another language instead of abandoning the workflow or unnecessarily falling back to an external shell. When every enabled kernel is busy, the diagnostic does not fabricate an alternative.
- **Detached execution observability:** Detached cells retain explicit create/start/detach/complete/fail/stop/peek lifecycle states. Completion notifications are internal model-visible messages rather than synthetic user-input queue entries. Oversized output notices use plain absolute spill paths for the agent-facing read surface, while `local://` remains an in-cell artifact helper.
- **Bounded lifetime and bridge behavior:** The hard wall-clock limit remains active across detachment and host-tool bridge calls, with a default of 1800 seconds. A bridge call may use the configured pause grace, but a stuck or detached cell still reaches a bounded terminal outcome and releases the loop instead of remaining unbounded.
- **Tool orchestration and telemetry:** Eval cells dispatch nested tools through the session's real execution surface; reserved `agent`, `output`, and `tool_schema` helpers use their dedicated bridge path and recursive eval remains rejected. Each settled cell emits one bounded `senpi.eval.execution` record containing wall/kernel timing, terminal and detach status, nested call counts, and bounded per-tool aggregates. External projections omit prompts, arguments, call identifiers, errors, and result previews.
- **Failure recovery:** A JavaScript worker crash settles the active cell, retires the failed worker, and prepares a fresh worker for the next cell. Session-generation fencing prevents retired callbacks from emitting into a newer session. Subprocess-backed interpreters wait for readiness before their cell timeout begins, so startup under load is not mistaken for user-code failure.
- **Runtime compatibility:** JavaScript is available on supported Node runtimes without an optional interpreter. Python, Ruby, and Julia remain separately detected capability surfaces. The supported boundary remains Node `>=24`; the build and release toolchain is Bun 1.4, while the codemode package keeps a Node-compatible boundary and avoids depending on Bun-only APIs. Explicit `OMO_RUNTIME=node` and `OMO_RUNTIME=bun` selection remains supported by the launcher, with re-execution loop guards.
- **Migration and measurement:** This update replaces package files and does not reset settings, credentials, sessions, permissions, or extension enablement. The eval telemetry separates eval-only and non-eval waves, correlates cells to their owning sessions, rejects malformed or duplicate ownership, and reports modeled savings and round trips. No cross-version latency percentage is claimed because the repository contains no committed before/after benchmark.
- **Breaking**: the `/start-work` command and skill are renamed to `/ulw-execute` (hard cutover, no alias). Update scripts, prompts, and CI that reference the old name. The `start_work` config key is deprecated in favor of `ulw_execute`: the old key still loads for one release and emits a deprecation warning, and it will be removed next release; if both keys are set, `ulw_execute` wins. The `omo-senpi-start-work-continuation-disabled` flag is renamed to `omo-senpi-ulw-execute-continuation-disabled` following the component rename to `ulw-execute-continuation`. The telemetry `skill_loaded` known-skill value `start-work` is renamed to `ulw-execute`; update dashboards and queries that filter on the old value.
- **Breaking**: the `omo` command is renamed to `omo-agent-toolkit` on every edition, and the old name is removed in the same release. The `omo` npm bin entry and the Codex `~/.local/bin/omo` runtime wrapper are both gone; `omo-agent-toolkit` replaces them with identical behaviour. This is a major release because a published bin entry is removed. Migration: replace `omo ` with `omo-agent-toolkit ` in scripts, prompts, and CI. Migration is automatic for existing installs — an npm upgrade prunes the old `omo` bin link, and Codex installs delete the generated wrapper at the next session start or installer run (a user-owned `omo` file that the installer did not generate is left untouched). One-time caveat: an agent running at the moment of the Codex relink can see a single failed `omo ulw-loop` call and must re-issue it as `omo-agent-toolkit ulw-loop`. The `omo` name is reserved for the future native edition (npm `omo-ai`), which is not shipped in this release.
- **Breaking**: the OpenCode plugin, Senpi adapter, and Codex codegraph loader no longer read `oh-my-openagent.json[c]` / `oh-my-opencode.json[c]` or `~/.omo/config.jsonc` at runtime; the first startup migrates them into `~/.omo/omo.jsonc` (existing values win, skipped values become diagnostics) and moves the sources into the migration backup directory. Older strict config cores reject a newer `omo.jsonc` containing `models` / `profiles` / harness blocks; restore the legacy files from `~/.omo/migration-backup-*` when downgrading.
- **Breaking**: `shared/<name>` skill invocations and `disabled_skills: ["shared/<name>"]` entries no longer resolve. Skills from the shared catalog now register under their bare name (e.g. `ulw-plan`, `frontend`). Update configs and prompts to use bare names. (PR #6180)

### Post-beta.23 merge follow-ups

The following pull requests merged after the beta.23 release note was authored
and are recorded here so the changelog remains connected to the final `dev`
history:

- LSP formatting now flows through `lsp-core` and the daemon, with typed
  no-op/unavailable results and a default cap of six resident idle clients.
  (PR #7428, merge `f356d17816aad57eb248b42a2f30ec0f1b14fde8`)
- Senpi config-watch re-registration is deferred and coalesced, and duplicate
  extension instances stand down instead of recursively rebuilding watchers.
  (PR #7420, merge `8776e80252cbf91127b1b8c1865a11da10e8bb38`)
- Codex GPT-5.6 context-window contracts are aligned at 650k tokens across
  catalogs, migration fallbacks, post-compact budgeting, and installers.
  (PR #7429, merge `a5bb28c604c9fe57c5c59ac00968fe8514881cf4`)
- Windows DAP drive-letter paths and durable mailbox/receipt persistence are
  portable across the release path, including the merged beta.23 source-state
  release update. (PR #7432, merge `c6b1d190e6c52bc1689ba08b138f64e2e54712fb`;
  PR #7427, merge `b9631886e4ad8922324d3a0977274735b5729be9`)
- Senpi mutation handling now shares path extraction and single-flight state,
  uses daemon-first formatting with bounded fallback, and runs diagnostics
  before comment-checker feedback. (PR #7430, merge
  `5c2f56b997c13d056ad56c196be32b9e8e37a298`)

### Fixed

- Senpi engine pin `2026.8.28`: repairs the beta.23 shared interactive host regressions — Shift+Tab no longer prints `Thinking level: [object Promise]` and `/settings` thinking options render, user messages no longer render twice, resuming a session held by a live shared host attaches instead of failing with `session_path_in_use`, and the compiled JavaScript/Python eval kernels resolve their runtime assets again.

- Windows DAP script paths with drive letters are no longer misclassified as `host:port` endpoints, and thread mailbox/receipt persistence now tolerates the Windows `fsync` behavior while retaining atomic writes.
- The `omo` launcher no longer orphans the engine when it is signaled. Both spawn layers (`node bin/omo.js` -> engine, and the bun re-exec in between) waited in `spawnSync`, where no JS handler can run, so a `SIGTERM`ed launcher died instantly and left the engine reparented to pid 1 - where it kept running, held the terminal, and eventually accumulated as a zombie session. The launcher now waits asynchronously, forwards `SIGTERM`/`SIGHUP` to the child, gives it a bounded grace window (10s, `OMO_SIGNAL_GRACE_MS`) to run its own graceful shutdown, and re-raises the signal on itself if the child ignores it. `SIGINT` is deliberately not forwarded - the terminal already delivers it to the whole foreground process group - but the launcher still waits instead of dying under the engine. Exit fidelity is unchanged: the child's exit code passes through, and a child killed by a signal still makes the launcher die by that same signal.

## [4.14.0] - 2026-06-29

### Added

- Unified telemetry architecture across OpenCode and Codex editions. (PR #5668)
- Coding Agent Sessions shared skill for finding and reconstructing agent sessions across harnesses. (PR #5600)
- Atlas final-review verdict classification (approve/reject/missing). (PR #5605)
- Web terminal visual evidence helper for QA. (PR #5534)

### Changed

- Named plugin server export for easier integration. (PR #5717)
- Release prepublish size gates with documented exceptions. (PR #5718, #5722)
- QA evidence redaction for auth headers and terminal secrets.

### Fixed

- Atlas background output gate requires explicit gate for retrieval. (PR #5653)
- TeamMode leader patience: waits calmly instead of rushing members. (PR #5613)
- CodeGraph child process environment isolation. (PR #5667)
- Windows Codex desktop install discovery-first flow. (PR #5618)
- Context7 placeholder auth removed from Codex config. (PR #5593)
- ULW loop context pressure scan limited to tail.
- Visual QA CJK semantic line break detection. (PR #5522)

## [4.13.0] - 2026-06-23

### Added

- TeamMode v2 script-driven model (complete rewrite with cross-platform controller script and worktree automation). (PR #5416, #5421)
- Ultimate Browsing shared skill with tiered routing (insane-search, agent-reach, Chrome stealth). (PR #5469)
- CodeGraph auto-init config to skip automatic `.codegraph` creation. (PR #5456)
- Per-member thread titles in TeamMode named by role. (PR #5453)
- ULW loop research work-shape branch with ledger-backed dedup and hypotheses. (PR #5467)
- ULW loop quality gate schema rewrite with essential checkpoint criteria. (PR #5309)
- Lazycodex update release notes included in auto-update. (PR #5477)
- TeamMode members push constant updates by default. (PR #5487)
- Cross-platform teammode controller script and merge-commit integration.

### Changed

- Venice provider neutralized in Hephaestus and deep model chains. (PR #5523)
- Frontend design references materialized from submodules for DMCA compliance. (PR #5472)
- LazyCodex steering mode defaults to on at install. (PR #5531)
- CodeGraph cross-platform bundle and MCP handshake improvements. (PR #5475, #5496)
- Provider exhaustion fallback policy for background tasks. (PR #5508)

### Fixed

- Ultimate Browsing cookie handling, template warnings, and forged module detection. (PR #5498, #5503)
- TeamMode worktree-add idempotency on Windows 8.3 paths. (PR #5502)
- TeamMode duplicate member name rejection. (PR #5501)
- Runtime fallback timeout rearming after blocked escalation. (PR #5491)
- Delegate-task silent parent wake retry bounding. (PR #5488)
- Opencode run marker refresh after wake requeues. (PR #5500)
- Skill MCP servers resolved from runtime config without deadlock. (PR #5482)

### Removed

- AST-grep MCP server and `ast-grep-mcp/core` packages replaced with `sg` binary provisioning via shared resolver. (PR #5313)

## [4.12.1] - 2026-06-20

### Added

- Per-member thread titles named by role in TeamMode.

### Changed

- UltraResearch prefers cooperating team broadcasts.

### Fixed

- Codex thread title nudge shortened.
- CodeGraph bootstrap on Node 26.
- Thread title hook failures surfaced.
- Packaged skills synced during Codex cache install.

## [4.12.0] - 2026-06-20

### Added

- Skill rename: `frontend-ui-ux` to `frontend` (ported with full references and designpowers contract). (PR #5308)
- Skill rename: `ultraresearch` to `ulw-research`. (PR #5518)
- ULW plan becomes LLM-agnostic (collapsed per-LLM Prometheus prompts into one skill). (PR #5310)
- Monitor tool relocated into `omo-opencode` with background command monitoring and ReDoS hardening. (PR #5315)
- TUI sidebar panel with roster resolver, ULW loop reader, and runtime mirror manager. (PR #5325)
- CodeGraph MCP serve wrapper and session bootstrap for both OpenCode and Codex. (PR #5322)
- Shared agent setup/cleanup/qa-sandbox scripts for cross-harness dev env. (PR #5354)
- `qa-docker.sh` for containerized OpenCode and Codex QA.

### Changed

- CI upgraded to Node.js 24 runtimes across all workflows. (PR #5352)
- Master-targeting PRs auto-closed with friendly notice. (PR #5351)
- PR and issue auto-labeling reworked to per-package model.
- Build runs in parallel with checks.
- Package layering refactor continued: `telemetry-core`, `team-core`, `delegate-core`, `skills-loader-core`, `claude-code-compat-core`, `tmux-core`, `mcp-client-core`, `openclaw-core`, `mcp-stdio-core`, `lsp-core` extracted.

### Fixed

- TUI sidebar quality: redacted active goals, safe background task titles, canonicalized paths. (PR #5349)
- Prompt async gate virtualized waits in tests (watchdog, background wake, runtime fallback, todo continuation).
- Delegate-task sync completion gated on direct children only.
- Opencode plugin component load failures retried.
- TeamMode composition invariants enforced.
- ULW plan honors explicit ask and fork filter.
- Sisyphus prompt rebuild for runtime model family.

### Removed

- Native `ast_grep` MCP server and `ast-grep-mcp/core` packages; replaced with shared `sg` resolver and skill. (PR #5313)

## [4.11.1] - 2026-06-18

### Added

- GLM prompt variants and ultrawork GLM prompt routing.
- Claude Fable-5 and Mythos-5 context limit recognition.

### Changed

- Programming skill: restored hard LOC gate, replaced absolute rule with code-smell review triggers.
- Model-core normalizes non-Claude model version separators.

### Fixed

- Codex marketplace auto-update boundary preserved.
- CodeGraph MCP path stamped during bootstrap.
- CodeGraph startup hook output made valid.
- Start-work passes bare session id to SDK session.messages.
- Background-agent schedules re-flush for reply-required wake after activity window.
- Lazycodex codegraph missing binary provisioned during MCP serve.

## [4.11.0] - 2026-06-17

### Added

- CodeGraph initialization: bootstrap on session start, register MCP, shared resolver and provisioning. (PR #5322)
- TUI sidebar panel: state model, snapshot schema, roster resolver, ULW loop reader, mirror manager. (PR #5325)
- Monitor tool: background command monitoring with ReDoS hardening. (PR #5315)
- ULW plan LLM-agnostic skill. (PR #5310)
- Lazycodex agent series and executor verify hook component. (PR #5305)
- Frontend skill designpowers operating layer and web-ui-design skill. (PR #5541)
- Visual QA clone fidelity reviewer and dual-harness dispatch. (PR #5307)
- Shared agent setup/cleanup/qa-sandbox scripts for cross-harness dev env. (PR #5354)
- Devcontainer and cross-harness dev env wiring. (PR #5354)
- `default_mode` config auto-activates ultrawork and ralph loop without typing commands. (PR #4190)
- Toast i18n with English and Chinese locales, backed by plugin config. (PR #3884)
- `disabled_providers` config schema and helper. (PR #4031)
- `plan-format-validator` hook warns on malformed task labels in `.omo/plans/*.md`. (PR #4221)
- Prometheus gains spec-driven development framework awareness (OpenSpec, .specify). (PR #2307)
- Per-agent skill filtering with `restrictedAgents`. (PR #2827)
- `look_at` async refactor for non-blocking image analysis. (PR #4098)
- `keyword-detector.enabled_expansions` allowlist. (PR #4084)
- `taskCleanupDelayMs` configurable for background tasks. (PR #3241)
- Per-agent `displayName` for i18n. (PR #4081)
- Grok family models with `reasoningEffort` support. (PR #4186)
- CLI `setup` alias for `install`. (PR #4174)
- Codex CLI Light edition (`omo-codex`) with one-command install via `bunx oh-my-openagent install --platform=codex` or `lazycodex` bin entry. (PR #5354)
- New `--platform <opencode|codex|both>` install flag.
- New bin entries: `omo` (short alias) and `lazycodex` (auto-defaults `--platform=codex`).
- PostHog telemetry stream `omo_codex_daily_active` for Codex edition.
- Triple-publish to npm: `oh-my-opencode`, `oh-my-openagent`, and `lazycodex`.

### Changed

- Massive package layering refactor. Eight workspace packages extracted: `utils`, `hashline-core`, `model-core`, `rules-engine` (renamed from `rules-core`), `agents-md-core`, `ast-grep-core`, `comment-checker-core`, and `boulder-state`.
- `model-core` uses dependency injection, eliminating all `src/` back-imports from core packages.
- `prompt-async-gate` split from monolith into six focused sub-modules.
- Additive OpenCode config directory discovery. (PR #3875)
- `delegate_task` supplies sensible defaults for `run_in_background` and `load_skills`. (PR #4121)
- CI reworked with Node 24, parallel build, per-package labeling.
- Master-targeting PRs auto-closed.

### Fixed

- Background-agent session activity tracking and stale timeout. (PR #4226, #4228, #4235)
- Team-mode hard-rejects coordinator agents, surfaces member errors, port-0 fallback, Windows base directory init, atomic config writes, preserves membership across fallback, validates agents. (PR #4027, #3923, #3963, #4023, #3838, #3898, #3987)
- Runtime-fallback synthetic continuation, quota error recognition, OpenAI `server_error` retryable. (PR #3645, #3937, #3799)
- Windows Git Bash / MSYS2 shell detection, powershell syntax fallback, WSL binary detection. (PR #3370, #3499, #3607, #2991)
- Tmux-subagent terminal probe drain, session readiness wait, layout skip for isolated panes. (PR #2887, #0465, #4100)
- Skill-mcp-manager survives reloads and disconnections, trusts explicit env vars. (PR #4099, #3995)
- Slash-command duplicate injection removed. (PR #3724)
- Hyperplan no longer fires on `.hpp` C++ header paths. (PR #4215)
- Todo-continuation-enforcer stops looping after completion. (PR #4013)
- `tool.definition` handler wired for `todo-description-override`. (PR #3705)
- Model parsers guard against non-string input. (PR #4145)
- `mcp_` prefix stripped from tool names before dispatch.
- Shell `glob` and `grep` tolerate broken symlinks.
- `delegate-task` defaults and per-agent skill restrictions. (PR #4119, #4121)
- Process-cleanup graceful shutdown after `SIGTERM`. (PR #4026)

### Documentation

- Added `ROADMAP.md` describing the package layering refactor and multi-harness direction.
- PR merge policy documented: merge commits required, squash/rebase forbidden.
- `prompt-async-gate-rfc.md` updated with `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` 250 to 2000 rationale.

## [4.2.3] - 2026-05-20

### Added

- `packages/rules-engine`: new workspace package extracting rule discovery, matching, caching, and nested AGENTS.md context utilities. Part of the ROADMAP multi-harness package layering refactor.
- `packages/ast-grep-mcp`: native `packages/omo-opencode/src/tools/ast-grep` removed and replaced with a package-backed MCP server. User-facing tool names `ast_grep_search` / `ast_grep_replace` are preserved via MCP namespacing (server `ast_grep` + tools `search`/`replace`). `disabled_tools` continues to honor the legacy names.
- Rules-injector transcript hydration: dedup cache is now seeded from the session transcript on context-recovery, preventing duplicate rule injections after compaction.
- Comment-checker now parses `apply_patch` tool payloads, detecting AI slop comments in patch-style edits (not just plain file writes).
- `setSisyphusRuleDeprecationLogger` export from `@oh-my-opencode/rules-engine` lets the host inject its logger so the core package stays free of harness-source imports.
- `ROADMAP.md` documents the multi-harness package layering refactor and contribution flow (`ROADMAP` label).

### Changed

- `prompt-async-gate`: `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` default raised from 250 ms to 2_000 ms (8x) to absorb slower-provider `session.error` arrivals before reservation release. The constant remains a public export; callers can still override via `postDispatchHoldMs` per dispatch. [`docs/reference/prompt-async-gate-rfc.md`](docs/reference/prompt-async-gate-rfc.md) updated accordingly.
- `team-mode`: `team_send_message` ambiguous-failure path now releases the reservation, commits on success-path mark failures, preserves live delivery holds, and decouples resume history from session routing (BUG-A / BUG-B).
- `runtime-fallback`: recognises every OpenCode progress event shape (`message.part.updated`, `message.part.delta`, `message.updated`) and boolean/completed finish markers, preserves accepted pending retries, and detects finish-only tool waits (BUG-C / BUG-D).
- `background-agent`: parent-wake on same-source reservation now re-enqueues instead of dropping the wake (BUG-E).
- `rules-core`: `findRuleFiles` falls back to `workspaceDirectory` when no project root marker is found (BUG-F).
- `cli doctor`: lists all built-in MCP servers (`websearch`, `context7`, `grep_app`, `lsp`, `ast_grep`) and bootstraps the LSP MCP fallback script when no CLI binary is present.

### Fixed

- `rules-core` **security**: project rule files and directories can no longer escape the workspace via symlinks. `findRuleFilesRecursive` and the project-single-file path now require every realpath to remain within the scan boundary, blocking attacks where a hostile repo points `.github/copilot-instructions.md` (or any `.omo/rules` entry) at host secrets such as `~/.ssh/id_rsa`. Tests track the boundary contract in [`packages/rules-engine/src/index.test.ts`](packages/rules-engine/src/index.test.ts).
- `test-isolation`: rules-injector storage and fixture home isolated per-test; cross-suite leak diagnostic regression test added.
- `ast-grep-mcp`: absolute paths whose `realpath` stays inside the workspace are now accepted (covered by red test); `path` entries are normalized via `resolve` + `realpath` and rejected for null bytes, leading `-`, and out-of-workspace traversal.
- `runtime-fallback`: completion progress events (`message.part.updated`, deltas, finished markers) now correctly recognized, preventing false-negative retry triggers on sessions that are actually making progress.
- `context-recovery`: idle sessions are now handled during context recovery, avoiding stale state when compaction fires on an already-idle session.
- `rules-injector`: storage writes now retry after cleanup races, preventing transient ENOENT failures during concurrent compaction + rule injection.
- `plugin`: synthetic `status: idle` events now correctly trigger idle hooks, ensuring continuation and recovery hooks fire even when OpenCode emits synthetic idle after tool completion.
- `rules-core` **security** (additional): package fully isolated from harness imports; symlink escape blocking extended to cover rule directory scanning (not just individual files).

### Reverted Breaking Changes

- Restored `.sisyphus/rules` and `~/.sisyphus/rules` rule-source discovery that was silently removed in v4.2.2..HEAD. They now load with LOWEST priority among project rule sources and emit a deprecation warning. **Planned removal in v4.3.0**: migrate to `.omo/rules` and `~/.omo/rules`.

### Internal

- `packages/rules-engine` no longer imports `../../../src/shared/logger`. ROADMAP's "core has no harness dependencies" invariant is now upheld; the host injects its logger from `packages/omo-opencode/src/hooks/rules-injector/rule-file-finder.ts` as a module-level side effect.
- `README.ru.md` gains the OmO logo to match `README.md` / `README.ja.md` / `README.ko.md` / `README.zh-cn.md`.
- CLA signatures added for PR #4176, #4180, #4181, #4186.

### Known Limitations (deferred to v4.3.0)

- `packages/omo-opencode/src/shared/prompt-async-gate.ts` is 885 LOC, well past the 250-LOC architectural ceiling. Splitting it into `prompt-reservations`, `prompt-queue`, `prompt-message-state`, `prompt-dispatch-runner`, and a thin facade is queued with the broader multi-harness refactor.
- Root `package.json` still declares `@ast-grep/napi` and the doctor still checks the NAPI dependency even though the native tool is gone. Cleanup ships with the next ast-grep harness pass.

### Web

- Landing page decomposed from 832 LOC into 10 section components; manifesto page from 358 LOC into 9 section components.
- Design system tokens extracted into `DESIGN.md` with consistent spacing, color, and typography variables.
- Dynamic OG + Twitter card images via `next/og`, later switched to static PNG file convention for reliability.
- Hero "Get Started" CTA now links to `/docs#installation` (closes #3848).
- Nested `<main>` on manifesto page removed for WCAG 1.3.1 compliance.
- UX/accessibility polish pass + middleware metadata route fix.
- Responsive test matrix added: 6 viewports x 4 locales x 2 pages.
- CI/build pipeline optimized; dead dependencies removed.

### Documentation

- Added [`ROADMAP.md`](ROADMAP.md) describing the package layering refactor and multi-harness direction.
- Added OmO logo to [`README.ru.md`](README.ru.md) for parity with the other localized READMEs.
- PR merge policy documented: merge commits required, squash/rebase forbidden.
- `prompt-async-gate-rfc.md` updated with `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS` 250 -> 2000 rationale.

## [4.2.0] - 2026-05-15

### Added

- `createPluginModule` test seam moved out of public API surface to `packages/omo-opencode/src/testing/create-plugin-module.ts`. New public exports for the prompt-async-gate primitives: `dispatchInternalPrompt`, `releasePromptAsyncReservation`, `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS`, `DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS`.
- `ParentWakeNotifier` module (`packages/omo-opencode/src/features/background-agent/parent-wake-notifier.ts`) extracted from `BackgroundManager`. Background-agent parent-wake state now lives in its own narrow class with dependency-injected client, directory, and notification enqueue callback.

### Changed

- `prompt-async-gate` now uses a shared internal runner for both sync (`prompt`) and async (`promptAsync`) dispatch wrappers, deduplicating the reserve/settle/check/dispatch/hold/release flow.
- `releasePromptAsyncReservation` accepts `reservedByPrefix` only when the prefix ends in `:` (e.g., `model-fallback:`), preventing accidental release of sibling reservations whose source merely starts with the same identifier characters.
- Version bump from 4.1.2 to 4.2.0. Reason: added public exports for the gate primitives qualify as MINOR per semver. No removals or breaking signature changes.

### Fixed

- `prompt-async-gate`: dispatch timeout via `Promise.race` with a default 30s window. Previously a hung `promptAsync` deadlocked the gate for that sessionID until process restart. (BLOCKER-1)
- `prompt-async-gate`: post-dispatch failure now keeps the reservation hold regardless of whether `promptAsync` resolved or threw. AGENTS.md's documented race window ("returns before durably accepted, later failures arrive as `session.error`") is now covered. (BLOCKER-2)
- `prompt-async-gate.test.ts`: replaced `setTimeout`-based synchronization with event-driven patterns to comply with the new `.omo/rules/test-discipline.md` rule. (BLOCKER-3)
- `model-suggestion-retry`: releases the reservation before the suggested-model retry so the second attempt can dispatch immediately. Without this, BLOCKER-2's post-dispatch hold trapped the retry path.

### Internal

- `prompt-async-route-audit.test.ts` migrated to TypeScript compiler API for AST-based detection. Catches destructuring, bracket access, optional chaining, and type-cast aliasing bypass patterns. Two existing production callers are documented in `RAW_PROMPT_ALLOWLIST` with justifications: `packages/omo-opencode/src/plugin/event.ts` (team-idle-wake-hint client facade) and `packages/omo-opencode/src/hooks/session-recovery/recover-unavailable-tool.ts` (capability check before gate-routed dispatch). (HIGH-5)
- New `mock-module-lifecycle-audit.test.ts` enforces cleanup pairing for `mock.module(...)` calls in test files; existing offenders allowlisted with TODO references. (HIGH-10)
- `.omo/rules/test-discipline.md` added in this release window forbidding `setTimeout(resolve, N)` and `await sleep(N)` in test bodies unless time is the SUT. Several CI sharding commits earlier in the window were superseded by removing the sharded runner in favor of the rule.

### Known Issues

- **Delegated child-session early-failure fallback (BLOCKER-4)**: PR #3825's `fac90d69f` was reverted by PR #4044 because its own regression test failed on clean root `bun test`. The delegate-task fallback bug for empty session history remains unaddressed in v4.2.0. Reland targets v4.2.1 once the regression test is stabilized against post-#4032 schema and the new gate semantics. See `docs/reference/known-issues.md` for details and workaround.
- **First-prompt watchdog supersession history (L16)**: PR #3952 was superseded by PR #4051 (rebased over #4007/factory refactor with `internallyAbortedSessions` threading). The supersession represents conflict resolution, not a feature pivot. The final watchdog logic shipped via #4051 + `a130fa70d` covers subagent first-prompt silence past 90 seconds with cleanup via session.deleted.

[Unreleased]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.14.0...HEAD
[4.14.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.13.0...v4.14.0
[4.13.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.12.1...v4.13.0
[4.12.1]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.12.0...v4.12.1
[4.12.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.11.1...v4.12.0
[4.11.1]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.11.0...v4.11.1
[4.11.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.3...v4.11.0
[4.2.3]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.2...v4.2.3
[4.2.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.1.2...v4.2.0
