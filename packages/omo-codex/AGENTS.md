# packages/omo-codex/ - Codex CLI Light Edition (lazycodex)

**Generated:** 2026-05-31

## STOP. THIS IS THE CODEX EDITION. QA IS MANDATORY. EVERY SINGLE TIME. INSTALL THE LOCAL BUILD INTO AN ISOLATED `CODEX_HOME`.

> **IF YOU CHANGE ANY CODEX-CONNECTED COMPONENT (the vendored `plugin/`, a component under `plugin/components/`, the installer in `scripts/` or `src/install/`, config migration, telemetry, or hook wiring), YOU MUST QA IT AGAINST A REAL, LOCALLY-INSTALLED, ISOLATED CODEX. ALWAYS. EVERY SINGLE TIME. NO EXCEPTIONS.**

**"It typechecks" is NOT QA. "`bun test` is green" is NOT QA.** YOU MUST INSTALL THE LOCAL BUILD AND DRIVE REAL CODEX, then RECORD THE EVIDENCE TO DISK. NO EVIDENCE == NO QA == NO COMMIT == NO PUSH.

### ISOLATE THE INSTALL. USE THE LOCAL BUILD. NEVER THE PUBLISHED PACKAGE. NEVER YOUR REAL `~/.codex`.

1. **POINT `CODEX_HOME` AT A THROWAWAY DIR AND INSTALL THIS REPO'S LOCAL BUILD INTO IT.** LOCAL build. ISOLATED home. Every time.
   ```bash
   export CODEX_HOME="$(mktemp -d)/codex"
   node packages/omo-codex/scripts/install-local.mjs install   # installs the LOCAL repo build into the isolated CODEX_HOME
   ```
   The installer reads `CODEX_HOME` (and `OMO_CODEX_PROJECT` for project scope), so an isolated home keeps the real `~/.codex/{config.toml,plugins,agents}` UNTOUCHED.
2. **RUN THE CODEX GATE:** `bun run test:codex` (installer + config migration + plugin component suite; the canonical Codex compatibility gate, ubuntu/macos/windows in CI).
3. **DRIVE CODEX UNDER tmux** in that isolated `CODEX_HOME`: confirm the plugin loads, `omo@sisyphuslabs` is enabled in the sandbox `config.toml`, and the hooks actually fire (`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PostCompact` / `Stop` / `SubagentStop`). **CONFIRM YOUR REAL `~/.codex/config.toml` WAS NOT TOUCHED.**

**RECORD THE EVIDENCE UNDER `.omo/evidence/<YYYYMMDD>-<short-slug>/`** (one organized subfolder per change): WHY THERE IS NO REGRESSION (the isolated-install transcript, before/after of the real `~/.codex` proving it is untouched, exact commands and output) and PROOF THAT EVERY INTENDED CHANGE LANDED (the new behavior observed inside the isolated Codex). See the root [`AGENTS.md`](../../AGENTS.md) "STOP. QA IS MANDATORY" section for the full cross-harness mandate.

**ALWAYS. EVERY TIME. NO EXCEPTIONS.**

## OVERVIEW

`@oh-my-opencode/omo-codex` (private, v0.1.0): the Codex harness adapter = the **Light Edition** (omo for the OpenAI Codex CLI). Vendors a Codex plugin namespace `omo` + a TypeScript installer + telemetry. Public distribution = the `lazycodex` bin/npm alias and the [`code-yeongyu/lazycodex`](https://github.com/code-yeongyu/lazycodex) marketplace repo. Codex marketplace identity = `sisyphuslabs` / plugin `omo` (`omo@sisyphuslabs`); `lazycodex` is the alias only. Full identity + the publish/deploy pipeline live in the root [`AGENTS.md`](../../AGENTS.md) "CODEX LIGHT EDITION" section.

## LAYOUT

| Path | Purpose |
|------|---------|
| `package.json` | `@oh-my-opencode/omo-codex` (private). Deps: `@oh-my-opencode/utils`. Scripts: `typecheck`, `test`, `build:plugin`, `sync:skills`. |
| `marketplace.json` | Codex marketplace manifest. Declares marketplace `sisyphuslabs`, single installable plugin `omo`. |
| `MARKETPLACE.md` | Native Codex marketplace notes for `sisyphuslabs` / `omo`. |
| `index.d.ts` | Type barrel re-exporting `src/`. |
| `plugin/` | Vendored Codex plugin namespace `omo`; pkg `@sisyphuslabs/omo-codex-plugin` (dep `@oh-my-opencode/shared-skills`). Holds `.codex-plugin/plugin.json` (brandColor `#7C3AED`), `hooks/hooks.json` (aggregate event wiring), `components/` (8 workspaces), generated aggregate `skills/`, `.mcp.json`. |
| `scripts/` | Generated/bundled Node ESM install entrypoints and parity tests. Published paths such as `scripts/install-local.mjs` stay stable while source lives in `src/install/`. |
| `src/` | TypeScript runtime consumed by the CLI: `install/` (Codex cache install, config mutation, agent links, local marketplace snapshot, cleanup, routing) + `telemetry/`. |
| `tsconfig.json` | Bun-targeted strict config; included in root `typecheck:packages`. |

## COMPONENTS (8)

`comment-checker`, `git-bash`, `lsp`, `rules`, `start-work-continuation`, `telemetry`, `ultrawork`, `ulw-loop`. Each is an isolated workspace under `plugin/components/<name>/` with its own `AGENTS.md` + `hooks/hooks.json` when it owns hook behavior. The root plugin build runs `plugin/scripts/sync-skills.mjs` to generate the aggregate `plugin/skills/` directory from shared skills plus component-local skills. Wired to Codex lifecycle events `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PostCompact` / `Stop` / `SubagentStop`. Implementations originate from `code-yeongyu/codex-{rules,comment-checker,lsp,ultrawork,ulw-loop,start-work-continuation}`.

## INSTALL (mechanics)

Source entry: `src/install/install-codex.ts` plus `src/install/install-local-cli.ts`; generated Node entrypoints live at `packages/omo-codex/scripts/install*.mjs` for stable published paths. Targets: plugin cache `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`; local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`; durable agent TOML copies under `~/.codex/agents/`; enables `omo@sisyphuslabs` in `~/.codex/config.toml`; component CLIs into `~/.local/bin`. Windows: Git Bash preflight (`winget install --id Git.Git`); override `OMO_CODEX_GIT_BASH_PATH`, skip auto-install with `OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL=1`. Non-Windows keeps the `git_bash` MCP manifest bundled but writes `enabled = false`.

## CONFIG MIGRATION (SessionStart)

The plugin `SessionStart` hook (matcher `^startup$`) runs `plugin/scripts/auto-update.mjs` → `migrateCodexConfig()` over `~/.codex/config.toml` + any project `.codex/config.toml`, before the update throttle. Beyond syncing the managed reasoning profile from `plugin/model-catalog.json`, it enforces a policy decision (2026-06-10): **multi_agent_v2 is force-disabled on every startup** via `forceDisableMultiAgentV2()` (`plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`). Basis: [openai/codex#26753](https://github.com/openai/codex/issues/26753) — the flag alone makes every turn 400 ("encrypted parameters … not configured for encrypted tool use"), and OpenAI closed it NOT_PLANNED stating V2 is under development, not recommended, and bug reports are not accepted (same failure class still reported in [#27205](https://github.com/openai/codex/issues/27205)). The guard writes `[features.multi_agent_v2]` with `enabled = false` even when the section or key is absent, flips `enabled = true`, and removes the `[features]` boolean shorthand `multi_agent_v2 = true` (a boolean key and a sub-table of the same name are conflicting TOML). The installer (`scripts/install/multi-agent-v2-config.mjs`) stays orthogonal: it only sets `max_concurrent_threads_per_session` and never writes `enabled`. Opt-out: `LAZYCODEX_CONFIG_MIGRATION_DISABLED=1` / `OMO_CODEX_CONFIG_MIGRATION_DISABLED=1`. The hook also emits restart notifications: when an update starts it persists `pendingNotice` ({fromVersion, toVersion, startedAt}) in the auto-update state, and once a later startup runs at >= toVersion it emits an update-completed notice (checked before the throttle, so throttled startups still notify). Non-empty notices are printed as a single stdout JSON line (`hookSpecificOutput.additionalContext`, SessionStart) and audited as `notified` events in the update log; pinned by `plugin/test/auto-update-restart-notice.test.mjs`. Pinned by `plugin/test/migrate-codex-config.test.mjs` (part of `bun run test:codex`).

## TELEMETRY

Event `omo_codex_daily_active`, at most once per UTC day per machine. Two sources: install (`install_completed`) + plugin `SessionStart` (`session_start`). Id `sha256("omo-codex:" + hostname)`; dedup state `~/.local/share/omo-codex/posthog-activity.json`; PostHog person profiles disabled. Opt-out: `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global `OMO_*` flags also disable). Parity with the main plugin pinned by `src/telemetry/cross-package-equivalence.test.ts`.

## DEPLOY (sync script)

`script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>` copies `marketplace.json` to `.agents/plugins/marketplace.json` and `plugin/` to `plugins/omo/`, bundles LSP/Git Bash MCP runtime dists into `plugins/omo/components/*/dist/`, rewrites `.mcp.json` paths, then validates via `script/lazycodex-marketplace-validation.ts`. Mechanism = file copy + commit push, NOT a git subtree. The triggering `publish.yml` behavior (`publish_lazycodex` input + automatic stable-release Codex marketplace sync gated on empty `dist_tag`) is documented in the root `AGENTS.md`.

## NOTES

- `@sisyphuslabs/omo-codex-plugin` (the shipped Codex plugin bundle) is distinct from `@oh-my-opencode/omo-codex` (this adapter package).
- Codex marketplace name is `sisyphuslabs`, never `lazycodex`.
- `@oh-my-opencode/omo-codex` is private (not published to npm on its own); its assets ship via the root `package.json` `files` array.
- `bunfig.toml` excludes `packages/omo-codex/plugin/**` from the root `bun test`; the plugin carries its own `node --test` suite. Full Codex suite: `bun run test:codex`.
- Per-component detail lives in `plugin/components/*/AGENTS.md`; do not duplicate it here.
