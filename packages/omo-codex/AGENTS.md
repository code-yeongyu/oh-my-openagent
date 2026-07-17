# packages/omo-codex/ - Codex CLI Light Edition (lazycodex)

**Generated:** 2026-07-03

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

### Dev dogfood (real `~/.codex`, distinct from the isolated QA flow above)

`bun run install:codex-dev` swaps your real install for this repo's local build stamped as version `dev` (env `LAZYCODEX_DEV_VERSION`, default `dev`). Everywhere the plugin version shows — cache dir `.../omo/dev/`, `plugin.json`, and the per-turn `(OmO dev)` hook prefix — reads `dev`, so you can SEE which build is loaded. This is dogfooding on your REAL home; it is NOT a substitute for the mandatory isolated-`CODEX_HOME` QA above. Impl: `resolveLazyCodexPluginVersion` `versionOverride` (`src/install/lazycodex-version-stamp.ts`) fed from `env.LAZYCODEX_DEV_VERSION` in `runCodexInstaller`; display in `get-local-version` (`dev` status on a non-semver stamp).


## OVERVIEW

`@oh-my-opencode/omo-codex` (private, v4.18.1): the Codex harness adapter = the **Light Edition** (omo for the OpenAI Codex CLI). Vendors a Codex plugin namespace `omo` + a TypeScript installer + telemetry. Public distribution = the live `lazycodex-ai` npm package/bin alias. `lazycodex` remains a root bin alias and the [`code-yeongyu/lazycodex`](https://github.com/code-yeongyu/lazycodex) repository identity, but is not an npm package. Codex marketplace identity = `sisyphuslabs` / plugin `omo` (`omo@sisyphuslabs`). Full identity + the publish/deploy pipeline live in the root [`AGENTS.md`](../../AGENTS.md) "CODEX LIGHT EDITION" section.

## LAYOUT

| Path | Purpose |
|------|---------|
| `package.json` | `@oh-my-opencode/omo-codex` (private). Deps: `@oh-my-opencode/utils`. Scripts: `typecheck`, `test`, `build:plugin`, `sync:skills`. |
| `marketplace.json` | Codex marketplace manifest. Declares marketplace `sisyphuslabs`, single installable plugin `omo`. |
| `MARKETPLACE.md` | Native Codex marketplace notes for `sisyphuslabs` / `omo`. |
| `index.d.ts` | Type barrel re-exporting `src/`. |
| `plugin/` | Vendored Codex plugin namespace `omo`; pkg `@sisyphuslabs/omo-codex-plugin` (dep `@oh-my-opencode/shared-skills`). Holds `.codex-plugin/plugin.json` (brandColor `#7C3AED`), `hooks/hooks.json` (aggregate event wiring), `components/` (11 workspaces + bootstrap + test-support), generated aggregate `skills/` (gitignored, built by sync-skills), `.mcp.json`. |
| `scripts/` | Generated/bundled Node ESM install entrypoints and parity tests. Published paths such as `scripts/install-local.mjs` stay stable while source lives in `src/install/`. |
| `src/` | TypeScript runtime consumed by the CLI: `install/` (Codex cache install, config mutation, agent links, local marketplace snapshot, cleanup, routing) + `telemetry/`. |
| `tsconfig.json` | Bun-targeted strict config; included in root `typecheck:packages`. |

## COMPONENTS (11 live workspaces + 2 special dirs)

Per `plugin/package.json` `workspaces[]`: `codegraph`, `comment-checker`, `git-bash`, `lazycodex-executor-verify`, `lsp`, `rules`, `start-work-continuation`, `teammode`, `telemetry`, `ultrawork`, `ulw-loop`. Special cases: `bootstrap` (runtime provisioner with its own package.json, deliberately OUTSIDE the workspaces array — built standalone by `plugin/scripts/build-components.mjs`) and `test-support` (test helper dir, no package.json, not a component). `workflow-selector` was removed 2026-06-29 (only an untracked `dist/` residue may linger locally). Each component is an isolated workspace under `plugin/components/<name>/` with its own `AGENTS.md` + `hooks/hooks.json` when it owns hook behavior. Wired to Codex lifecycle events `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PostCompact` / `Stop` / `SubagentStop`. Older components originate from `code-yeongyu/codex-{rules,comment-checker,lsp,ultrawork,ulw-loop,start-work-continuation}`; `codegraph`, `teammode`, `bootstrap`, `lazycodex-executor-verify` are repo-native.

**sync-skills pipeline** (`plugin/scripts/sync-skills.mjs`, run by the plugin build): wipes `plugin/skills/` → copies 10 COMPONENT skills first (`comment-checker`, `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor`, `lsp`, `rules`, `teammode`, `ulw-loop`, `ulw-plan`, `ultrawork` from `plugin/components/*/skills/*`; same-named shared skills are skipped) → copies remaining shared skills → `adaptSkillForCodex()` inserts Codex Harness Tool Compatibility guidance, applies overlays (`start-work` / `review-work`), and writes `agents/openai.yaml` display metadata with the `(OmO) ` prefix.

**Ultrawork skill pointer:** the ultrawork `UserPromptSubmit` hook injects a compact `<ultrawork-mode>` pointer (<4096 bytes; Codex App truncates large hook output) directing the model to read the full directive from the bundled `ultrawork` skill; full-directive fallback when the skills tree is absent. Mirror copy in `ulw-loop/src/ultrawork-skill-pointer.ts`; byte-identity pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`.

## INSTALL (mechanics)

Source entry: `src/install/install-codex.ts` plus `src/install/install-local-cli.ts`; generated Node entrypoints live at `packages/omo-codex/scripts/install*.mjs` for stable published paths. Targets: plugin cache `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`; local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`; durable agent TOML copies under `~/.codex/agents/`; enables `omo@sisyphuslabs` in `~/.codex/config.toml`; component CLIs into `~/.local/bin`. Windows: Git Bash preflight discovers `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, then PATH; if missing, it prints manual install guidance and stops without running `winget`. Non-Windows keeps the `git_bash` MCP manifest bundled but writes `enabled = false`.

## CONFIG MIGRATION (SessionStart)

The plugin `SessionStart` hook (matcher `^startup$`) runs `plugin/scripts/auto-update.mjs` → `migrateCodexConfig()` over `~/.codex/config.toml` + any project `.codex/config.toml`, before the update throttle. Healthy marketplace-managed installs still skip npx self-update and point users at `codex plugin marketplace upgrade sisyphuslabs`; stale local marketplace cache/bin state is the exception, and starts the npx installer as a local repair when the cached marketplace manifest or managed component bins point at missing OMO payloads. Beyond syncing the managed reasoning profile from `plugin/model-catalog.json`, it runs a **model-aware** MultiAgentV2 guard via `forceDisableMultiAgentV2()` (`plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`):

- If the selected root `model` (or SessionStart hook `model`, which wins when present) resolves to `multi_agent_version: "v2"` in `CODEX_HOME/models_cache.json` (GPT-5.6 terra/sol family) — or the catalog is unavailable but the effective session model is `gpt-5.6*` (`prefersMultiAgentV2()`) — the guard **clears** managed `enabled = false` / `#26753` comments **and** any `hide_spawn_agent_metadata = false` (written by OMO installers <= 4.15.x; it re-adds agent_type/model properties to spawn_agent and mismatches the reserved schema, 400 on codex-cli 0.144.1), leaving V2 unset so Codex can follow the reserved `collaboration.spawn_agent` schema (lazycodex#118 / oh-my-openagent#6002). On that same V2-preferred signal `ensureSubagentConcurrencyLimit()` also removes `agents.max_threads` (invalid while V2 is active) while still writing `max_concurrent_threads_per_session`.
- On the SessionStart hook CLI path, if the active session model cannot be read from stdin, the guard **skips** force-disable instead of assuming the config.toml default (so `codex -m gpt-5.6-terra` cannot be broken by a stale default model line).
- Otherwise it keeps the openai/codex#26753 force-disable path: write `[features.multi_agent_v2] enabled = false` and flip `enabled = true`.
- On **every** path (including the skip paths above) the guard first removes the `[features]` boolean shorthand `multi_agent_v2 = true|false`: a boolean key plus the same-name table that `ensureSubagentConcurrencyLimit()` appends would be invalid TOML.

The installer (`src/install/codex-multi-agent-v2-config.ts`) mirrors the migration's model awareness via `resolveCodexMultiAgentVersion()` (root `model` against `models_cache.json` next to config.toml; `gpt-5.6*` counts as V2 when the catalog is missing): it always sets `max_concurrent_threads_per_session` and never enables V2; on V1/unknown models it writes `agents.max_threads = 1000` and converts a `multi_agent_v2 = false` shorthand into table-form `enabled = false`; on V2-preferred models it skips/removes `agents.max_threads` and does NOT materialize the disable (a config-level disable 400s the reserved collaboration.spawn_agent schema, #6008). Entry guards for all plugin CLI scripts go through `scripts/entry-guard.mjs` `isCliEntry()` — the plain `pathToFileURL(process.argv[1])` comparison silently no-ops the whole hook when the plugin cache is reached through a symlink. Opt-out: `LAZYCODEX_CONFIG_MIGRATION_DISABLED=1` / `OMO_CODEX_CONFIG_MIGRATION_DISABLED=1`. The hook also emits restart notifications: when an update starts it persists `pendingNotice` ({fromVersion, toVersion, startedAt}) in the auto-update state, and once a later startup runs at >= toVersion it emits an update-completed notice (checked before the throttle, so throttled startups still notify). Non-empty notices are printed as a single stdout JSON line (`hookSpecificOutput.additionalContext`, SessionStart) and audited as `notified` events in the update log; pinned by `plugin/test/auto-update-restart-notice.test.mjs`. Pinned by `plugin/test/migrate-codex-config.test.mjs` (part of `bun run test:codex`).

## TELEMETRY

Event `omo_codex_daily_active`, at most once per UTC day per machine. Two sources: install (`install_completed`) + plugin `SessionStart` (`session_start`). Id `sha256("omo-codex:" + hostname)`; dedup state `~/.local/share/omo-codex/posthog-activity.json`; PostHog person profiles disabled. Opt-out: `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global `OMO_*` flags also disable). Parity with the main plugin pinned by `src/telemetry/cross-package-equivalence.test.ts`.

## DEPLOY (sync script)

`script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>` copies `marketplace.json` to `.agents/plugins/marketplace.json` and `plugin/` to `plugins/omo/`, bundles LSP/Git Bash MCP runtime dists into `plugins/omo/components/*/dist/`, bundles root CLI runtimes into `plugins/omo/dist/cli` and `plugins/omo/dist/cli-node`, rewrites `.mcp.json` paths, then validates via `script/lazycodex-marketplace-validation.ts`. Mechanism = file copy + commit push, NOT a git subtree. The triggering `publish.yml` behavior (`publish_lazycodex` input + automatic stable-release Codex marketplace sync gated on empty `dist_tag`) is documented in the root `AGENTS.md`.

## NOTES

- `@sisyphuslabs/omo-codex-plugin` (the shipped Codex plugin bundle) is distinct from `@oh-my-opencode/omo-codex` (this adapter package).
- Codex marketplace name is `sisyphuslabs`, never `lazycodex`.
- `@oh-my-opencode/omo-codex` is private (not published to npm on its own); its assets ship via the root `package.json` `files` array.
- `bunfig.toml` excludes `packages/omo-codex/plugin/**` from the root `bun test`; the plugin carries its own `node --test` suite. Full Codex suite: `bun run test:codex`.
- Per-component detail lives in `plugin/components/*/AGENTS.md`; do not duplicate it here.
