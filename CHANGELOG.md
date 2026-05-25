# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] (next-minor or 4.3.0)

### Added

- `default_mode` config auto-activates ultrawork and ralph loop without typing commands. Set it once in your plugin config and every new session starts in high-agency mode. (PR #4190)
- Toast i18n with English and Chinese locales, backed by plugin config. UI messages now respect your language setting. (PR #3884)
- `disabled_providers` config schema and helper. Block providers you do not use from appearing in model resolution and fallback chains. (PR #4031)
- `plan-format-validator` hook warns when task labels in `.omo/plans/*.md` are malformed, catching plan syntax errors before execution. (PR #4221)
- Prometheus gains spec-driven development framework awareness (OpenSpec, .specify). The planner now reads specification files and factors them into interview questions and task breakdowns. (PR #2307)
- Per-agent skill filtering. Skills can declare `restrictedAgents` so only eligible agents see them in prompts and tool descriptions. (PR #2827)
- `look_at` async refactor. Image analysis dispatches non-blocking and returns when ready, keeping the session responsive during multimodal work. (PR #4098)
- `keyword-detector.enabled_expansions` config gives allowlist control over which keyword expansions fire. (PR #4084)
- `doctor` CLI now warns when `oh-my-openagent/tui` is missing from `tui.json`, catching incomplete installs. (PR #4048)
- `taskCleanupDelayMs` configurable for background tasks. Tune how long finished background task artifacts linger before cleanup. (PR #3241)
- Per-agent `displayName` for i18n. Agents can present localized names in UI and logs. (PR #4081)
- Grok family models registered with `reasoningEffort` support. (PR #4186)
- CLI `setup` alias for `install`. Either command runs the interactive setup wizard. (PR #4174)

### Changed

- Massive package layering refactor. Eight workspace packages extracted: `utils`, `hashline-core`, `model-core`, `rules-engine` (renamed from `rules-core`), `agents-md-core`, `ast-grep-core`, `comment-checker-core`, and `boulder-state`. This is the foundation for the multi-harness roadmap.
- `model-core` now uses dependency injection, eliminating all `src/` back-imports from core packages. The host harness injects its snapshot fetcher, suggestion parser, and context-limit resolver.
- `prompt-async-gate` split from a 779-line monolith into six focused sub-modules: reservations, queue, message state, dispatch runner, and a thin facade.
- Additive OpenCode config directory discovery. The plugin now loads global agents and walks configs from both default and custom OpenCode config roots. (PR #3875)
- `delegate_task` now supplies sensible defaults for `run_in_background` and `load_skills` instead of throwing when they are omitted. (PR #4121)

### Fixed

- Background-agent session activity tracking and stale timeout. Missed polls are preserved on lookup errors, session stream activity is forwarded, and stale cancellation is deferred when activity is detected. (PR #4226, #4228, #4235)
- Team-mode hard-rejects coordinator agents as subagent targets, preventing invalid team composition. (PR #4027)
- Team-mode member errors now surface to the main agent instead of being swallowed. (PR #3923)
- Team-mode port-0 fallback and silent layout skip resolved. (PR #3963)
- Team-mode base directory initialization no longer crashes on Windows with `EPERM` / `ENOTSUP` / `EINVAL` from `chmod`. (PR #4023)
- Team-mode config writes are now atomic through writable handles. (PR #3838)
- Team-mode preserves team membership across model fallback switches. (PR #3898)
- Team-mode `team_create` now validates hard-reject agents before accepting the request. (PR #3987)
- Runtime-fallback synthetic continuation when session messages are empty, preventing silent failure on Git operations and other empty-history retries. (PR #3645)
- Runtime-fallback recognizes more provider quota error names and patterns. (PR #3937)
- Runtime-fallback marks OpenAI `server_error` patterns as retryable. (PR #3799)
- Windows Git Bash / MSYS2 shell detection now runs before `PSModulePath` checks. (PR #3370)
- Windows interceptor auth injection binding fixed. (PR #3499)
- Windows powershell syntax fallback for non-interactive environments regardless of `SHELL` / `MSYSTEM`. (PR #3607)
- WSL opencode binary detection in `doctor` now resolves the correct path. (PR #2991)
- Tmux-subagent drains terminal probe replies during delegated pane startup. (PR #2887)
- Tmux-subagent waits for session readiness before spawning the attach pane. (PR #0465)
- Tmux-subagent skips layout enforcement when closing an isolated container pane. (PR #4100)
- Skill-mcp-manager survives MCP reloads and disconnections. (PR #4099)
- Skill-mcp-manager trusts explicit skill MCP environment variables. (PR #3995)
- Slash-commands inject command content exactly once, removing duplicate injection. (PR #3724)
- Hyperplan no longer fires on `.hpp` C++ header paths. (PR #4215)
- Todo-continuation-enforcer stops looping after all todos are complete. (PR #4013)
- `tool.definition` handler is now wired so `todo-description-override` actually fires. (PR #3705)
- Model parsers guard against non-string input, preventing crashes on malformed capability data. (PR #4145)
- `mcp_` prefix stripped from tool names before dispatch, fixing namespaced tool routing.
- `prometheus-md-only` replaced the `SYSTEM DIRECTIVE` marker with an XML tag in external prompts. (PR #4036)
- Shell `glob` and `grep` tolerate broken symlinks and non-fatal I/O warnings.
- `chat-message` refreshes stale session-agent cache from explicit `input.agent`.
- `delegate-task` defaults `run_in_background` and `load_skills` when omitted. (PR #4119)
- Skill-loader supports unambiguous short skill names. (PR #4146)
- Process-cleanup calls `process.exit()` after `SIGTERM` cleanup, ensuring graceful shutdown. (PR #4026)

### Fixed in this release gate

- Notepad-write-guard wired and extended to `.omo/notepads`, preventing accidental overwrites in the new workspace layout.
- i18n `initI18n()` is now called in production startup, so locale settings actually take effect.
- `start-work` session-plan-affinity now matches `.omo/plans/` correctly.
- `default_mode` ultrawork + ralph loop initial turn now receives the ultrawork system prompt.
- Multimodal-looker prompt tool allowlist is now consistent with the runtime tool allowlist.
- `delegate-task` enforces per-agent skill restrictions declared by skills.
- `model-core` restored OpenAI `server_error` retryable patterns, fixing a regression introduced during package extraction.

## [4.2.3] - 2026-05-20

### Added

- `packages/rules-core`: new workspace package extracting rule discovery, matching, caching, and nested AGENTS.md context utilities. Part of the ROADMAP multi-harness package layering refactor.
- `packages/ast-grep-mcp`: native `src/tools/ast-grep` removed and replaced with a package-backed MCP server. User-facing tool names `ast_grep_search` / `ast_grep_replace` are preserved via MCP namespacing (server `ast_grep` + tools `search`/`replace`). `disabled_tools` continues to honor the legacy names.
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

- `rules-core` **security**: project rule files and directories can no longer escape the workspace via symlinks. `findRuleFilesRecursive` and the project-single-file path now require every realpath to remain within the scan boundary, blocking attacks where a hostile repo points `.github/copilot-instructions.md` (or any `.omo/rules` entry) at host secrets such as `~/.ssh/id_rsa`. Tests track the boundary contract in [`packages/rules-core/src/index.test.ts`](packages/rules-core/src/index.test.ts).
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

- `packages/rules-core` no longer imports `../../../src/shared/logger`. ROADMAP's "core has no harness dependencies" invariant is now upheld; the host injects its logger from `src/hooks/rules-injector/rule-file-finder.ts` as a module-level side effect.
- `README.ru.md` gains the OmO logo to match `README.md` / `README.ja.md` / `README.ko.md` / `README.zh-cn.md`.
- CLA signatures added for PR #4176, #4180, #4181, #4186.

### Known Limitations (deferred to v4.3.0)

- `src/shared/prompt-async-gate.ts` is 885 LOC, well past the 250-LOC architectural ceiling. Splitting it into `prompt-reservations`, `prompt-queue`, `prompt-message-state`, `prompt-dispatch-runner`, and a thin facade is queued with the broader multi-harness refactor.
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

- `createPluginModule` test seam moved out of public API surface to `src/testing/create-plugin-module.ts`. New public exports for the prompt-async-gate primitives: `dispatchInternalPrompt`, `releasePromptAsyncReservation`, `DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS`, `DEFAULT_PROMPT_DISPATCH_TIMEOUT_MS`.
- `ParentWakeNotifier` module (`src/features/background-agent/parent-wake-notifier.ts`) extracted from `BackgroundManager`. Background-agent parent-wake state now lives in its own narrow class with dependency-injected client, directory, and notification enqueue callback.

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

- `prompt-async-route-audit.test.ts` migrated to TypeScript compiler API for AST-based detection. Catches destructuring, bracket access, optional chaining, and type-cast aliasing bypass patterns. Two existing production callers are documented in `RAW_PROMPT_ALLOWLIST` with justifications: `src/plugin/event.ts` (team-idle-wake-hint client facade) and `src/hooks/session-recovery/recover-unavailable-tool.ts` (capability check before gate-routed dispatch). (HIGH-5)
- New `mock-module-lifecycle-audit.test.ts` enforces cleanup pairing for `mock.module(...)` calls in test files; existing offenders allowlisted with TODO references. (HIGH-10)
- `.omo/rules/test-discipline.md` added in this release window forbidding `setTimeout(resolve, N)` and `await sleep(N)` in test bodies unless time is the SUT. Several CI sharding commits earlier in the window were superseded by removing the sharded runner in favor of the rule.

### Known Issues

- **Delegated child-session early-failure fallback (BLOCKER-4)**: PR #3825's `fac90d69f` was reverted by PR #4044 because its own regression test failed on clean root `bun test`. The delegate-task fallback bug for empty session history remains unaddressed in v4.2.0. Reland targets v4.2.1 once the regression test is stabilized against post-#4032 schema and the new gate semantics. See `docs/reference/known-issues.md` for details and workaround.
- **First-prompt watchdog supersession history (L16)**: PR #3952 was superseded by PR #4051 (rebased over #4007/factory refactor with `internallyAbortedSessions` threading). The supersession represents conflict resolution, not a feature pivot. The final watchdog logic shipped via #4051 + `a130fa70d` covers subagent first-prompt silence past 90 seconds with cleanup via session.deleted.

[Unreleased]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.3...HEAD
[4.2.3]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.2...v4.2.3
[4.2.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.1.2...v4.2.0
