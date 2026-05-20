# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.2.3] - 2026-05-20

### Added

- `packages/rules-core`: new workspace package extracting rule discovery, matching, caching, and nested AGENTS.md context utilities. Part of the ROADMAP multi-harness package layering refactor.
- `packages/ast-grep-mcp`: native `src/tools/ast-grep` removed and replaced with a package-backed MCP server. User-facing tool names `ast_grep_search` / `ast_grep_replace` are preserved via MCP namespacing (server `ast_grep` + tools `search`/`replace`). `disabled_tools` continues to honor the legacy names.
- Rules-injector transcript hydration: dedup cache is now seeded from the session transcript on context-recovery, preventing duplicate rule injections after compaction.
- Comment-checker now parses `apply_patch` tool payloads, detecting AI slop comments in patch-style edits (not just plain file writes).
- `setSisyphusRuleDeprecationLogger` export from `@oh-my-opencode/rules-core` lets the host inject its logger so the core package stays free of harness-source imports.
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

## [4.2.1] - Unreleased

### Fixed

- Relanded BLOCKER-4 delegated child-session empty-history fallback. Runtime fallback now consumes the captured bootstrap prompt when a delegated child session fails before history is persisted, while preserving delegated system prompts and tool permissions for the retry.
- Team Mode fresh-install diagnostics now log the resolved `team_mode` config and tool-registry team tool count, making #3893-style missing `team_*` registrations visible instead of silent.
- Added a regression test proving a fresh minimal user config with `{ "team_mode": { "enabled": true } }` registers all 12 `team_*` tools.
- Atlas boulder continuation now hard-stalls after three consecutive continuation turns with no successful bash/edit/write tool progress, preventing the #3446 runaway loop where text-only blocker reports kept the session alive for hours.
- Strengthened the boulder continuation prompt so externally blocked tasks must be marked in the plan as `- [~]` via an actual file edit before Atlas moves on.

### Documentation

- Marked the v4.2.0 BLOCKER-4 known issue as resolved in v4.2.1.
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

[4.2.3]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.2...HEAD
[4.2.1]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.2.0...HEAD
[4.2.0]: https://github.com/code-yeongyu/oh-my-openagent/compare/v4.1.2...v4.2.0
