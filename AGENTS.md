# oh-my-opencode — OpenCode Plugin

> **HOLD THE FUCK UP. THIS ENTIRE GODDAMN CODEBASE IS BEING RIPPED APART AND REBUILT RIGHT NOW. A MASSIVE MULTI-HARNESS AGENT OS REFACTOR IS IN PROGRESS — WE ARE RESTRUCTURING EVERYTHING TO SUPPORT MULTIPLE AGENT HARNESSES (OPENCODE, CODEX, PI, AND OTHERS). DO NOT TRUST THE STRUCTURE BELOW AS STABLE. READ THE [ROADMAP](./ROADMAP.md) BEFORE YOU TOUCH ANYTHING OR SO HELP ME GOD.**

**Generated:** 2026-07-14 | **Source snapshot:** 80c3c81eb | **Branch:** dev | **Release:** v4.18.1

## STOP. QA IS MANDATORY. NON-NEGOTIABLE. EVERY SINGLE TIME YOU TOUCH AN OPENCODE- OR CODEX-CONNECTED COMPONENT.

> **IF YOUR CHANGE TOUCHES ANYTHING WIRED INTO OPENCODE OR INTO THE CODEX LIGHT EDITION, YOU MUST QA IT. ALWAYS. EVERY SINGLE TIME. NO EXCEPTIONS. THERE IS NO "TOO SMALL TO SKIP". THERE IS NO "IT OBVIOUSLY WORKS".**

**"It typechecks" is NOT QA. "`bun test` is green" is NOT QA.** YOU MUST DRIVE THE REAL HARNESS, and then **YOU MUST WRITE THE EVIDENCE TO DISK.** If there is no evidence file, **the QA DID NOT HAPPEN**, and **YOU ARE NOT ALLOWED TO COMMIT OR PUSH.**

This is repeated on purpose, because it is the single most ignored rule in this repo. **CHANGE A HOOK, A TOOL, AN AGENT, A FEATURE, A CONFIG SCHEMA, AN MCP, A CLI COMMAND, AN INSTALLER, A PROMPT, OR ANYTHING ELSE THAT REACHES OPENCODE OR CODEX, THEN: RUN QA, THEN RECORD EVIDENCE.** Always. Every time. No exceptions.

### OPENCODE side (`packages/omo-opencode/`): ALWAYS run the `opencode-qa` skill

1. **ALWAYS RUN THE `opencode-qa` SKILL** (`.agents/skills/opencode-qa/`) to map the EXPECTED IMPACT and the FULL CHANGE SCOPE of your edit BEFORE and AFTER. Pick the right case: CLI (`opencode run --format json`), server + SSE hook proof, TUI smoke, or DB inspection.
2. **ISOLATE EVERYTHING.** Any QA that SPAWNS opencode MUST run in an isolated XDG sandbox (`XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME` pointed at temp dirs). The bundled scripts already do this. **NEVER pollute the real `~/.local/share/opencode/opencode.db`.** PROVE isolation by comparing `SELECT count(*) FROM session` before and after.
3. **USE tmux** for the TUI smoke (`scripts/tui-smoke.sh`) and for any interactive driving. tmux is for SMOKE (did it boot, render, accept a key); assert REAL behavior via `opencode run --format json` or the server API + SSE.
4. **PROVE THE HOOK FIRED.** If you changed a lifecycle hook, prove the matching event hit the wire (`scripts/sse-hook-probe.sh --event <name>`). Seeing the event proves the hook would fire.

### CODEX side (`packages/omo-codex/`): ALWAYS run the `codex-qa` skill

1. **ALWAYS RUN THE `codex-qa` SKILL** (`.agents/skills/codex-qa/`) to map the EXPECTED IMPACT and the FULL CHANGE SCOPE of your edit BEFORE and AFTER. It exercises ONLY our plugin in strict isolation — an isolated `CODEX_HOME` + a LOCAL mock model (no real API call) — so the real `~/.codex` is NEVER read or written. NEVER QA against your real `~/.codex`; NEVER the published package.
2. **PROVE THE HOOK FIRED, FIRST-PARTY.** The skill drives the real `codex app-server` and asserts `hook/started` / `hook/completed` notifications for our components (`scripts/app-server-drive.sh --plugin`). Deterministic per-component checks: `scripts/hook-unit-probe.sh`. Installer + `config.toml` landing: `scripts/install-verify.sh`. tmux TUI smoke: `scripts/tui-smoke.sh`. Each script ships a `--self-test`.
3. **RUN THE CODEX GATE:** `bun run test:codex` (installer + config migration + plugin component suite). This is the hermetic UNIT gate; it does NOT prove a live session — the `codex-qa` skill does.
4. **CONFIRM THE REAL `~/.codex/config.toml` WAS NOT TOUCHED** — every `codex-qa` script asserts this automatically (shasum before/after).

### EVIDENCE: record it under `.omo/evidence/` or it DID NOT HAPPEN

**WRITE EVERY QA ARTIFACT TO `.omo/evidence/<YYYYMMDD>-<short-slug>/`** (the existing evidence dir; one subfolder per change, keep it ORGANIZED). For EVERY change you MUST record reviewer-readable plain files:
- **WHAT WAS TESTED:** the command or manual action, the surface driven, and the behavior it was meant to prove.
- **WHAT WAS OBSERVED:** the before/after or new behavior, isolation proof such as unchanged session counts, and the artifact path for the exact captured output.
- **WHY IT IS ENOUGH:** how the evidence covers the intended behavior and remaining regression risk.
- **WHAT WAS OMITTED:** redact or summarize raw secret-bearing logs, env dumps, tokens, auth headers, and private credentials instead of copying them.

**NO EVIDENCE FILE == NO QA == NO COMMIT == NO PUSH.** ALWAYS. EVERY TIME. NO EXCEPTIONS.

## DEFAULT WORKFLOW — how to take on any task

Unless the user EXPLICITLY says otherwise, or the task is an urgent must-fix-now hotfix, deliver every change through the **`work-with-pr`** skill: it works in an isolated git worktree, implements with evidence-bound manual QA, opens a reviewer-readable English PR (what changed, why, observed behavior, QA/evidence, residual risk), runs the verification loop, and merges. Do NOT hand-commit normal work straight to `dev`.

- **QA is the evidence gate, scoped to what you touched.** A change under `packages/omo-opencode/` MUST run the **`opencode-qa`** skill; a change under `packages/omo-codex/` (lazycodex) MUST run the **`codex-qa`** skill (see the QA section above for each). Run the matching skill, and treat its captured output (written under `.omo/evidence/`) as the QA evidence `work-with-pr` requires. A change touching both runs both.
- **Conflicts → `smart-rebase`.** If the worktree branch conflicts with its base, resolve it with the **`smart-rebase`** skill, then re-run the scoped QA. Never hand-resolve by force-pushing shared history.
- **Merge → merge commit, ALWAYS.** Land the PR with a merge commit per **PR MERGE POLICY** below. NEVER squash-merge or rebase-merge, even if a generic workflow, skill, or GitHub default suggests it.

## OVERVIEW

OpenCode plugin (npm: `oh-my-opencode`, dual-published as `oh-my-openagent` during the rename transition) extending OpenCode with 11 agents, 54-62 lifecycle hooks (base / +monitor / +team-mode) across 61 dirs, 12-35 registry tools (gated by config flags including team-mode; 8 `lsp_*` aliases served via the built-in lsp MCP), 3-tier MCP system (built-in + .mcp.json + skill-embedded), Hashline LINE#ID edit tool, IntentGate keyword detector, Team Mode (parallel multi-agent coordination, OFF by default), Boulder feature (boulder-state work tracking + cli/boulder subcommand), configurable agent ordering, and Claude Code compatibility.

**The package layering refactor moved the entire plugin out of root `src/` into [`packages/omo-opencode/src/`](packages/omo-opencode/src/AGENTS.md)** (a 100% git rename — there is NO root `src/` anymore). That adapter tree is now the OpenCode-facing shim over 19 Core packages + 3 MCP packages + the Codex adapter. Build entry: `packages/omo-opencode/src/index.ts`, a thin wrapper that delegates to `packages/omo-opencode/src/testing/create-plugin-module.ts` `createPluginModule()` → staged plugin init (see INITIALIZATION FLOW). Ships in two editions of one product: **Ultimate** (omo for OpenCode, this plugin = `packages/omo-opencode/`) and **Light** (omo for Codex CLI = [`packages/omo-codex/`](packages/omo-codex/AGENTS.md), with `lazycodex` as the repository/bin identity and `lazycodex-ai` as the live npm alias; see CODEX LIGHT EDITION below).

## STRUCTURE

```
oh-my-opencode/                      # workspace root (no root src/ — it moved into packages/omo-opencode)
├── packages/                        # 42 sibling packages across Core/MCP/Skills/Adapters/Platform/Web. See packages/AGENTS.md
│   ├── omo-opencode/                # ★ THE OpenCode plugin adapter (formerly root src/). Build entry: src/index.ts
│   │   └── src/                     # plugin source and OpenCode-facing adapter shims. Full breakdown → packages/omo-opencode/src/AGENTS.md
│   │       ├── index.ts             # Plugin entry; thin wrapper re-exporting createPluginModule() from src/testing/
│   │       ├── plugin-interface.ts  # 12 OpenCode hook handlers (+2 wired in testing/create-plugin-module.ts)
│   │       ├── create-{managers,tools,hooks}.ts  # 4 managers / ToolRegistry / 5-tier hook composition
│   │       ├── agents/              # 11 agents, 10 createXXXAgent factories (Prometheus special-cased via plugin-handlers/prometheus-agent-config-builder.ts)
│   │       ├── hooks/               # 54-62 lifecycle hooks across 61 dirs (incl. 5 zauc-* mock dirs + shared/ + team-session-events/)
│   │       ├── tools/               # 14 native tool dirs; LSP served via a built-in MCP, ast-grep via the bundled skill
│   │       ├── features/            # 23 feature modules (team-mode, background-agent, skill-mcp-manager, opencode-skill-loader, mcp-oauth, claude-code-plugin-loader, boulder-state, …)
│   │       ├── shared/              # cross-cutting utilities; logger → oh-my-opencode.log in os.tmpdir() (50 MB cap, .1/.2 backups)
│   │       ├── config/             # Zod v4 schema system (36 schema files)
│   │       ├── cli/                 # Commander.js CLI, 10 commands: install(setup), run, doctor, cleanup(uninstall), version, get-local-version, refresh-model-capabilities, boulder, ulw-loop, mcp (oauth login/logout/status)
│   │       ├── mcp/                 # 5 built-in MCPs (3 remote + local stdio lsp + codegraph)
│   │       ├── plugin/ plugin-handlers/  # OpenCode hook handlers + 6-phase config loading pipeline
│   │       ├── openclaw/            # Bidirectional Discord/Telegram/HTTP/shell integration + reply listener daemon
│   │       └── generated/ help/ locales/ testing/ __tests__/  # model-capabilities, CLI help schemas, i18n, test factory, perf benchmarks
│   ├── omo-codex/                   # Codex CLI Light edition; vendored Codex plugin `omo` + TS installer + telemetry (`lazycodex` repo/bin identity, `lazycodex-ai` live npm alias)
│   ├── omo-senpi/                   # Senpi native TS extension adapter (local-path Pi package); 6 components incl. task (drives senpi-task + omo-config-core)
│   ├── senpi-task/                  # Senpi-coupled task engine: state machine, store, in-process/RPC runners, lifecycle, completion, teams, 7 task + 12 team tools
│   ├── pi-goal/ pi-webfetch/        # Standalone Pi adapters: Codex-style goal tracking + bounded URL retrieval
│   ├── utils/ model-core/ prompts-core/ rules-engine/ agents-md-core/ comment-checker-core/ hashline-core/ boulder-state/ telemetry-core/ lsp-core/ mcp-stdio-core/ tmux-core/ claude-code-compat-core/ skills-loader-core/ mcp-client-core/ openclaw-core/ team-core/ delegate-core/ omo-config-core/   # 19 Core (pure-TS) pkgs
│   ├── lsp-tools-mcp/ git-bash-mcp/ lsp-daemon/   # 3 MCP-layer pkgs (stdio); LSP packages consume lsp-core + mcp-stdio-core
│   ├── shared-skills/               # Cross-harness SKILL.md bundle shared by OpenCode + Codex
│   ├── web/                         # Marketing site (Next.js 15 + Cloudflare Workers); own bun.lock; only @/* alias zone in the repo
│   └── oh-my-opencode-<os>-<arch>[-variant]/   # 12 platform launcher packages (bin/ + package.json only; generated, never hand-edited)
├── bin/                             # Platform-detection JS shim; 5 public aliases. See bin/AGENTS.md
├── script/                          # Bun/TS build/publish automation (singular). See script/AGENTS.md
├── scripts/                         # Node ESM third-party-notice helpers. See scripts/AGENTS.md
├── docs/                            # User-facing docs (guide/, reference/, examples/, legal/, manifesto.md, troubleshooting/)
├── assets/                          # Generated config/help schemas. See assets/AGENTS.md
├── test-support/ tests/             # Shared helpers + repo-level integration tests. See tests/AGENTS.md
├── signatures/                      # CLA signature registry (cla.json)
├── postinstall.mjs                  # Verifies platform binary + OpenCode version
├── test-setup.ts                    # Bun test preload (resets state between tests)
├── .opencode/  .agents/             # Project-scope skills + commands (.agents/ is the recent migration target)
├── .omo/                            # AI agent workspace (rules/, plans/, tasks/, teams/, ulw-loop/, notepads/)
└── .local-ignore/                   # Dev-only test fixtures + PR worktrees (NOT part of the real AGENTS.md hierarchy)
```

## INITIALIZATION FLOW

```
pluginModule.server(input, options)   # serverPlugin() in packages/omo-opencode/src/testing/create-plugin-module.ts
  ├─→ installAgentSortShim()          # patches Array.prototype.{toSorted,sort} for canonical agent ordering
  ├─→ initConfigContext()             # opencode-vs-openagent layout flag
  ├─→ logLegacyPluginStartupWarning() # warn if loaded under the legacy oh-my-opencode entry
  ├─→ migrateLegacyWorkspaceDirectory() # copy .sisyphus/ state forward to .omo/ on first load
  ├─→ detectDuplicateOmoPlugin()      # early-exit if a duplicate omo/openagent plugin is detected
  ├─→ detectExternalSkillPlugin()     # warn on conflicts
  ├─→ injectServerAuthIntoClient()    # auth headers into shared SDK client
  ├─→ loadPluginConfig()              # JSONC parse → user/project merge → Zod validate → migrate
  ├─→ recordPluginTelemetry()         # plugin-load telemetry
  ├─→ ensureTuiPluginEntry()          # if tui.sidebar.enabled !== false
  ├─→ initLiveServerRoute() + setLiveParentWakeRoutingDisabled() + warmLiveServerProbe()  # live-listener wake routing
  ├─→ selectRuntimeSecuritySkills() + createRuntimeSkillSourceServer()  # runtime security-skill source
  ├─→ initI18n()                      # load locale strings (packages/omo-opencode/src/locales/)
  ├─→ setAgentSortOrder()             # apply configured agent_order
  ├─→ initializeOpenClaw()            # if openclaw config present
  ├─→ checkTeamModeDependencies()     # if team_mode.enabled (try/catch → disabled-skills warning)
  ├─→ startTmuxCheck()                # if tmux integration enabled
  ├─→ createManagers()                # + createModelCacheState / createRuntimeTmuxConfig / first-message gate
  ├─→ createTools()                   # SkillContext + AvailableCategories + ToolRegistry
  ├─→ createHooks()                   # 5-tier: Session + ToolGuard + Transform + Continuation + Skill
  ├─→ createPluginInterface()         # 12 OpenCode hook handlers → PluginInterface
  └─→ createPluginDispose()           # final pluginHooks adds session.compacting + compaction.autocontinue + dispose
```

## 14 OPENCODE HOOK HANDLERS

12 wired in [`packages/omo-opencode/src/plugin-interface.ts`](packages/omo-opencode/src/plugin-interface.ts) + 2 wired directly in [`packages/omo-opencode/src/testing/create-plugin-module.ts`](packages/omo-opencode/src/testing/create-plugin-module.ts) (`experimental.session.compacting` + `experimental.compaction.autocontinue`).

| Handler | OpenCode Hook | Purpose |
|---------|---------------|---------|
| `config` | `config` | 6-phase pipeline: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | `tool` | 12–35 registered tools (config-gated: team-mode +12, monitor +4, task system +4, hashline +1, interactive_bash +1, look_at +1) |
| `tool.definition` | `tool.definition` | Per-tool definition transform (applies `todo-description-override`) |
| `chat.message` | `chat.message` | First-message variant, session setup, keyword detection (ultrawork/search/analyze/team) |
| `chat.params` | `chat.params` | Anthropic effort, think mode, runtime fallback override |
| `chat.headers` | `chat.headers` | Copilot `x-initiator` header injection |
| `command.execute.before` | `command.execute.before` | Pre-command guards (slash-command interception, etc.) |
| `event` | `event` | Session lifecycle (created/deleted/idle/error), openclaw dispatch, runtime fallback |
| `tool.execute.before` | `tool.execute.before` | Pre-tool guards (write-existing-guard, label-truncator, rules-injector, prometheus-md-only, …) |
| `tool.execute.after` | `tool.execute.after` | Post-tool hooks (output truncator, comment-checker, hashline read-enhancer, json-error-recovery, …) |
| `experimental.chat.messages.transform` | `experimental.chat.messages.transform` | Context injection, thinking-block validation, tool-pair validation, keyword detection |
| `experimental.chat.system.transform` | `experimental.chat.system.transform` | System-message-level transforms |
| `experimental.session.compacting` | `experimental.session.compacting` | Context + todo preservation across compaction |
| `experimental.compaction.autocontinue` | `experimental.compaction.autocontinue` | Auto-resume after compaction completes |

## TOOL CATALOG (config-gated)

**Always on (12 registry tools):** `grep`, `glob`, `session_list`, `session_read`, `session_search`, `session_info`, `background_output`, `background_cancel`, `call_omo_agent`, `task` (delegate), `skill`, `skill_mcp`.

> Note: the 8 LSP aliases (`lsp_status`, `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_install_decision`) are NOT registry registrations — they are served by the built-in `lsp` MCP via `packages/lsp-tools-mcp`. Structural search and rewrite is provided by the `ast-grep` skill using `sg`.

**Conditional (up to 35 total):** `look_at` (+1, multimodal-looker not disabled), `interactive_bash` (+1, `tmux` binary available on PATH via `isInteractiveBashEnabled()`), `monitor_start`/`monitor_stop`/`monitor_list`/`monitor_output` (+4, `monitor.enabled`), `task_create`/`task_get`/`task_list`/`task_update` (+4, `experimental.task_system`), `edit` (+1, `hashline_edit`), `team_create`/`team_delete`/`team_shutdown_request`/`team_approve_shutdown`/`team_reject_shutdown`/`team_send_message`/`team_task_create`/`team_task_list`/`team_task_update`/`team_task_get`/`team_status`/`team_list` (+12, `team_mode.enabled`).

## TEAM MODE

OFF by default. Parallel multi-agent coordination, modeled after Claude Code Agent Teams. Enable via `team_mode.enabled` in `.opencode/oh-my-opencode.jsonc` or user config; restart OpenCode after change.

Full schema in [`packages/omo-opencode/src/config/schema/team-mode.ts`](packages/omo-opencode/src/config/schema/team-mode.ts) (11 fields):

```jsonc
{
  "team_mode": {
    "enabled": true,
    "tmux_visualization": false,
    "max_parallel_members": 4,            // 1..8
    "max_members": 8,                     // 1..8 hard cap
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "base_dir": null,                     // override default ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,   // ≥1024
    "recipient_unread_max_bytes": 262144, // ≥1024
    "mailbox_poll_interval_ms": 3000      // ≥500
  }
}
```

Teams live as directories under `~/.omo/teams/{name}/config.json` (user) or `<project>/.omo/teams/{name}/config.json` (project; project beats user on collisions). Members declared as `kind: "subagent_type"` (direct agent) or `kind: "category"` (routed through `sisyphus-junior`).

**Member eligibility** (from [`AGENT_ELIGIBILITY_REGISTRY`](packages/omo-opencode/src/features/team-mode/types.ts)):
- `eligible`: sisyphus, atlas, sisyphus-junior
- `conditional`: hephaestus (lacks `teammate: "allow"` permission by default — apply D-36 in `tool-config-handler.ts` or use `subagent_type: "sisyphus"` instead)
- `hard-reject`: oracle, librarian, explore, multimodal-looker, metis, momus, prometheus (rejected at parse — use `task`/delegate-task)

**Storage layout** (`~/.omo/teams/{name}/`): `config.json` (spec), `state.json` (runtime), `mailbox/` (messages), `tasklist.jsonl` (tasks), `worktrees/` (per-member git worktrees).

**Implementation:** [`packages/omo-opencode/src/features/team-mode/`](packages/omo-opencode/src/features/team-mode/AGENTS.md). User docs: [`docs/guide/team-mode.md`](docs/guide/team-mode.md).

## CODEX LIGHT EDITION (omo-codex / lazycodex)

oh-my-openagent ships in two editions of one product. **Ultimate** = this OpenCode plugin (omo for OpenCode = `packages/omo-opencode/`). **Light** = omo for the OpenAI Codex CLI, vendored under [`packages/omo-codex/`](packages/omo-codex/AGENTS.md). "omo in Codex" / "omo for Codex" = **lazycodex**, and the public GitHub repo [`code-yeongyu/lazycodex`](https://github.com/code-yeongyu/lazycodex) is the thin marketplace/distribution layer over `omo-codex`; `lazycodex-ai` is the live npm alias and `lazycodex` is the repository/bin identity.

- **Package:** `@oh-my-opencode/omo-codex` (private, versioned with the repo): "Codex harness adapter. Vendored Codex plugin namespace `omo` + TypeScript installer + telemetry." Plugin bundle pkg = `@sisyphuslabs/omo-codex-plugin`. Reuses `@oh-my-opencode/utils`, shared Core packages, and generated SKILL.md outputs from `@oh-my-opencode/shared-skills` plus component-local skills.
- **Marketplace identity (precision):** Codex sees marketplace `sisyphuslabs`, plugin `omo`, enabled as `omo@sisyphuslabs`. `lazycodex-ai` is the live npm alias; `lazycodex` is the repository/bin identity, never the marketplace name.
- **Alias mechanics:** root `package.json` maps `lazycodex-ai` to `bin/oh-my-opencode.js` (1 of 5 bin aliases: `oh-my-opencode`, `oh-my-openagent`, `omo`, `lazycodex`, `lazycodex-ai`, all the same CLI launcher). `bunx lazycodex-ai install` is exactly `bunx oh-my-openagent install --platform=codex`. Routing: `packages/omo-opencode/src/cli/cli-program.ts` (`lazycodex`/`lazycodex-ai` default platform to codex), `bin/platform.js` (both resolve the `oh-my-openagent` platform family). `packages/omo-opencode/src/cli/star-request.ts` stars both repos.
- **Disambiguation:** `publish.yml` republishes this repo's CLI under the live npm alias `lazycodex-ai` (name/version rewrite). Bare `lazycodex` is only the `code-yeongyu/lazycodex` repository/bin identity, not an npm package.
- **Components (11 live workspaces):** `codegraph`, `comment-checker`, `git-bash`, `lazycodex-executor-verify`, `lsp`, `rules`, `start-work-continuation`, `teammode`, `telemetry`, `ultrawork`, `ulw-loop` (per `plugin/package.json` `workspaces[]`), wired to Codex events `SessionStart`/`UserPromptSubmit`/`PreToolUse`/`PostToolUse`/`PostCompact`/`Stop`/`SubagentStop`. Plus `bootstrap` (runtime provisioner with its own package.json, deliberately outside the workspaces array) and `test-support` (test helper dir, not a component). `workflow-selector` was removed 2026-06-29. No `team_*` tools (teammode is script+skill driven), no hashline; stdio MCPs = lsp + codegraph + git-bash.
- **Ultrawork skill pointer (truncation-safe):** Codex App truncates large `UserPromptSubmit` hook output, so the ultrawork hook injects a compact `<ultrawork-mode>` skill pointer (<4096 bytes, pinned by `plugin/test/ultrawork-skill-pointer.test.mjs`) that instructs the model to `create_goal` then READ the full directive from the bundled `ultrawork` skill (`ultrawork/src/skill-pointer.ts`); falls back to the full inline directive when the plugin skills tree is absent. `ulw-loop/src/ultrawork-skill-pointer.ts` is a byte-identical mirror for the standalone `--with-ultrawork` path.
- **Install:** `bunx oh-my-openagent install --platform=codex` (or `bunx lazycodex-ai install`, or `--platform=both`) copies the plugin to `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`, writes a local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`, copies bundled agent TOMLs into `~/.codex/agents/`, enables `omo@sisyphuslabs` in `~/.codex/config.toml`, links the root `omo` runtime wrapper plus component CLIs into `~/.local/bin`. Windows: Git Bash preflight (`winget install --id Git.Git`). Installer source lives in [`packages/omo-codex/src/install/`](packages/omo-codex/src/install/); `packages/omo-codex/scripts/install*.mjs` are generated/bundled Node entrypoints that keep the published CLI paths stable.
- **Deploy / publish** ([`.github/workflows/publish.yml`](.github/workflows/publish.yml), manual dispatch):
  - `publish_lazycodex` (default **true**) publishes the npm alias `lazycodex-ai`: rewrites root `package.json` name to `lazycodex-ai` + version to the release + optionalDeps `oh-my-opencode-*` to `oh-my-openagent-*`, skips when `registry.npmjs.org/lazycodex-ai/${VERSION}` exists, publishes `--access public --provenance --tag latest`, then restores `package.json`. (The bare `lazycodex` npm name was unpublished 2026-05-30; `lazycodex-ai` is the live package.)
- Codex marketplace sync is **automatic for every stable release** (no manual toggle; the old `sync_lazycodex_marketplace` input was removed). The release-job steps are gated on `needs.release-metadata.outputs.dist_tag == ''` (stable only; prereleases skip) and require secret `LAZYCODEX_SYNC_TOKEN` (enforced up-front by the `preflight-trust` token check, also gated on stable). They check out `code-yeongyu/lazycodex`, build the plugin + lsp-tools-mcp + lsp-daemon + git-bash-mcp, run [`script/sync-lazycodex-marketplace.ts`](script/sync-lazycodex-marketplace.ts) `<source-root> <lazycodex-root>`, then `git push origin HEAD:main`.
- **Sync mechanism is file copy + commit push, NOT a git subtree:** `marketplace.json` to `.agents/plugins/marketplace.json`; `plugin/` to `plugins/omo/`; bundles LSP/Git Bash MCP runtime dists to `plugins/omo/components/*/dist/`; bundles root CLI runtimes to `plugins/omo/dist/cli` and `plugins/omo/dist/cli-node`; rewrites `.mcp.json` paths; validates via `script/lazycodex-marketplace-validation.ts`. Root `package.json` `files` ships `dist/cli`, `dist/cli-node`, and `packages/omo-codex/{marketplace.json,plugin,plugin/.codex-plugin,scripts}`. First-publish playbook: [`docs/reference/lazycodex-npm-reservation.md`](docs/reference/lazycodex-npm-reservation.md). CI gate: `bun run test:codex` (ci.yml `codex-compatibility`, ubuntu/macos/windows).
- **Telemetry:** event `omo_codex_daily_active` (once per UTC day per machine, id `sha256("omo-codex:"+hostname)`); opt-out `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global flags also disable). Full internals: [`packages/omo-codex/AGENTS.md`](packages/omo-codex/AGENTS.md).

## MULTI-LEVEL CONFIG

```
Walked configs (closer wins): <pwd up to $HOME>/.opencode/oh-my-openagent.json[c]   (legacy: oh-my-opencode.json[c])
                            ↓ merged onto
User config:               ~/.config/opencode/oh-my-openagent.json[c]   (Windows: %APPDATA%\opencode\)
                            ↓ falls back to
Defaults                   (Zod safeParse fills omitted fields)
```

- `agents`, `categories`, `claude_code`: deep merged recursively (prototype-pollution safe)
- `disabled_*` arrays: Set union (concatenated + deduplicated)
- All other fields: override replaces base value
- `mcp_env_allowlist`: **user-only** for security; walked configs cannot extend it
- `migrateConfigFile()` rewrites legacy keys (idempotent via `_migrations` tracking + timestamped backups)

Schema autocomplete: `"$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"`

## THREE-TIER MCP SYSTEM

| Tier | Source | Loader | Mechanism |
|------|--------|--------|-----------|
| 1. Built-in | `packages/omo-opencode/src/mcp/` | `createBuiltinMcps()` | 3 remote HTTP + 2 local stdio MCPs (`lsp`, `codegraph`) |
| 2. Claude Code | `.mcp.json` (project + user) | `claude-code-mcp-loader` | `${VAR}` env expansion (allowlist via `mcp_env_allowlist`) |
| 3. Skill-embedded | SKILL.md YAML frontmatter | `SkillMcpManager` (per-session) | stdio + HTTP, OAuth 2.0 + PKCE + DCR step-up |

## WHERE TO LOOK

> All plugin paths below are relative to [`packages/omo-opencode/`](packages/omo-opencode/src/AGENTS.md) (the OpenCode adapter). Core/MCP logic lives in sibling `packages/*`.

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `packages/omo-opencode/src/agents/` + `agents/builtin-agents/` | `createXXXAgent` factory + `mode: "primary" \| "subagent" \| "all"` |
| Add new hook | `packages/omo-opencode/src/hooks/{name}/` + register in `src/plugin/hooks/create-*-hooks.ts` | Pick the right tier (Session/ToolGuard/Transform/Continuation/Skill) |
| Add new tool | `packages/omo-opencode/src/tools/{name}/` + register in `src/plugin/tool-registry.ts` | Factory `createXXXTool` (most) or direct `ToolDefinition` (interactive_bash) |
| Add new feature module | `packages/omo-opencode/src/features/{name}/` | Standalone module wired into `plugin/` layer |
| Add new MCP (tier 1) | `packages/omo-opencode/src/mcp/` + register in `createBuiltinMcps()` | Remote HTTP or local stdio |
| Add new built-in skill | `packages/omo-opencode/src/features/builtin-skills/skills/{name}.ts` + register in `skills.ts` | Implement `BuiltinSkill` interface |
| Add new command | `packages/omo-opencode/src/features/builtin-commands/` | Templates in `templates/` |
| Modify ultrawork prompts | `packages/prompts-core/prompts/ultrawork/*.md` | `packages/omo-opencode/src/hooks/keyword-detector/ultrawork/*.ts` are loader shims; keep `index.ts` and `source-detector.ts` routing stable |
| Add new CLI subcommand | `packages/omo-opencode/src/cli/cli-program.ts` | Commander.js subcommand |
| Add new doctor check | `packages/omo-opencode/src/cli/doctor/checks/` | Register in `checks/index.ts` |
| Modify config schema | `packages/omo-opencode/src/config/schema/` + add to `OhMyOpenCodeConfigSchema` | Zod v4; auto-included in `assets/oh-my-opencode.schema.json` after `bun run build:schema` |
| Add new category | `packages/omo-opencode/src/tools/delegate-task/constants.ts` | `DEFAULT_CATEGORIES` + `CATEGORY_MODEL_REQUIREMENTS` |
| Add new team-mode tool | `packages/omo-opencode/src/features/team-mode/tools/` + register in `src/plugin/tool-registry.ts` `teamModeToolsRecord` | Gated on `team_mode.enabled` |
| Reactive provider error recovery | `packages/omo-opencode/src/hooks/runtime-fallback/` | Distinct from `model-fallback` (proactive, chat.params) |
| External notifications | `packages/omo-opencode/src/openclaw/` | Bidirectional: outbound (event → HTTP/shell), inbound (Discord/Telegram daemon → tmux send-keys) |
| Skill-embedded MCP | `packages/omo-opencode/src/features/skill-mcp-manager/` | Tier-3 MCPs (per-session, stdio + HTTP) |
| Shared per-user LSP daemon (Codex) | `packages/lsp-daemon/` | Unix-socket / named-pipe daemon + stdio MCP proxy consuming `packages/lsp-core/` + `packages/mcp-stdio-core/` |

## ARCHITECTURE INVARIANTS

- **Canonical agent order:** Sisyphus → Hephaestus → Prometheus → Atlas. Enforced by `installAgentSortShim()` (patches `Array.prototype.toSorted`/`.sort` narrowly when the array contains ≥2 canonical core agents). See [`packages/omo-opencode/src/plugin-handlers/AGENTS.md`](packages/omo-opencode/src/plugin-handlers/AGENTS.md) for the full history of why this exists.
- **Hashline edit + read pairing:** Every `Read` tool output is tagged with `LINE#ID` content hashes; `hashline_edit` validates the hash before applying. Stale hash → reject.
- **5-tier hook composition:** Session (24) + ToolGuard (18) + Transform (7) + Continuation (7) + Skill (2) = 58 composed hook slots. 4 of those slots are config-gated null by default: `team-tool-gating` (ToolGuard) + `team-mode-status-injector`/`team-mailbox-injector` (Transform) via `team_mode.enabled`, and `monitor-status-injector` (Transform) via `monitor.enabled` → **54 active on default config**. Team mode also adds +4 direct event handlers in `packages/omo-opencode/src/plugin/event.ts` (`team-session-events/*`) → 62 max. Composed by `createCoreHooks()` + `createContinuationHooks()` + `createSkillHooks()`; the Transform tier also pulls `contextInjectorMessagesTransform` from `features/context-injector` (not a `hooks/` dir).
- **Per-session MCP isolation:** Tier-3 MCP clients keyed by `${sessionID}:${skillName}:${serverName}` so the same skill in two sessions does not share state.
- **Two fallback systems:** `model-fallback` (proactive, chat.params) vs `runtime-fallback` (reactive, session.error). They operate independently — no direct integration.
- **OpenClaw bidirectional:** Outbound dispatchers fire on session events; inbound daemon polls Discord/Telegram and `send-keys` replies into the tracked tmux pane.
- **Internal message injection is dangerous:** OpenCode의 stupid한 설계로 플러그인이 `session.prompt` / `session.promptAsync` 같은 메인 세션 메시지 API를 통해 메인 시스템을 망가뜨릴 수 있다.
  - Root cause to remember: OpenCode `promptAsync` returns before the prompt is durably accepted, and later failures can arrive as `session.error`. Multiple OMO hooks/tools can observe the same idle/error/completion edge and inject the same internal message into a live parent session.
- Treat every `session.prompt` / `session.promptAsync` call as a write to shared session state. Production code may call them only inside `packages/omo-opencode/src/shared/prompt-async-gate.ts`; all other routes must use `dispatchInternalPrompt({ mode: "async" | "sync", ... })` or a proven equivalent gate.
  - Required gate semantics: reserve per session before dispatch, check active session state, keep a short post-dispatch hold, release only on intentional abort/recovery paths, and restore optimistic task/loop state when dispatch is skipped or fails later.
  - Forbidden patterns: raw prompt calls outside the shared gate, `postDispatchHoldMs: 0`, no-session fallback to raw prompt, and new internal message routes without duplicate-injection regression tests.
  - Tests must pin both the shared invariant and the route behavior: update the static raw-prompt audit, then add route-specific tests proving concurrent/live/idle/error triggers collapse to one dispatch. Cover background completion wakes, fallback retries, team mailbox live delivery, recovery continuations, CLI run resumes, Claude Code hook injections, and sync/background subagent prompts.

## CONVENTIONS

- **Runtime:** Bun only (1.3.12 in CI). Never npm/yarn/pnpm. (Exceptions: `packages/lsp-tools-mcp` + `packages/lsp-daemon` are Node-targeted, vendored, and built with `npm` + vitest/biome.)
- **TypeScript:** strict mode, ESNext, bundler moduleResolution, `bun-types` (never `@types/node`).
- **Tests:** Bun test (`bun:test`), co-located `*.test.ts`, given/when/then style — nested `describe` with `#given`/`#when`/`#then` prefixes, or inline `// given` / `// when` / `// then` comments. Never Arrange-Act-Assert comments.
- **CI tests:** plain `bun test` runs the root Bun suite in one process; no sharding or split isolation runner.
- **Test setup:** `test-setup.ts` preloaded via `bunfig.toml` resets session/cache state between tests.
- **Factory pattern:** `createXXX()` for all tools, hooks, agents.
- **File naming:** kebab-case for files and directories.
- **Module structure:** `index.ts` barrel exports, **no catch-all files** (`utils.ts`, `helpers.ts`, `service.ts` banned), 200 LOC soft limit per file.
- **Imports:** relative within a module, barrel imports across modules (`import { log } from "./shared"`). **No path aliases inside package `src/`** — never `@/`. `packages/web/` is the only exception: it uses `@/*` (Next.js convention) and has its own tsconfig.
- **Config format:** JSONC with comments + trailing commas, Zod v4 validation, snake_case keys.
- **Dual package:** `oh-my-opencode` + `oh-my-openagent` published simultaneously during the rename transition.
- **Comments:** AI slop comment patterns blocked by `comment-checker` hook (binary: `@code-yeongyu/comment-checker`). Use `// @allow` to bypass single line, `// comment-checker-disable-file` at file top to bypass file. Sparingly.

## ANTI-PATTERNS (BLOCKING)

- Never `as any`, `@ts-ignore`, `@ts-expect-error`.
- Never suppress lint/type errors.
- Never add emojis to code/comments unless user explicitly asks.
- Never commit unless explicitly requested.
- Never run `bun publish` directly — use the GitHub Actions workflow.
- Never modify `package.json` `version` locally — handled by publish workflow.
- Never write to existing files without reading them first (`write-existing-file-guard`).
- Never use `background_cancel(all=true)` — cancel by `taskId` individually.
- Never delete a failing test to make a build green. Fix the code.
- Never em dashes / en dashes / AI filler ("simply", "obviously", "clearly", "moreover", "furthermore") in generated content.
- Never create catch-all files (`utils.ts`, `helpers.ts`, `service.ts`).
- Never empty catch blocks `catch(e) {}`.
- Never test with Arrange-Act-Assert comments — use given/when/then.
- Never dump business logic into `index.ts` — barrel exports only.
- Prometheus may ONLY edit `.md` files (enforced by `prometheus-md-only` hook); FORBIDDEN paths: `packages/*/src/`, `package.json`, config files.

## COMMANDS

```bash
bun test                          # Root Bun test suite in one process
bun run test:codex                # Codex Light gate: git-bash-mcp + lsp-tools-mcp + lsp-daemon + codegraph + omo-codex plugin + third-party notices (no ast-grep — that MCP was removed)
bun run build                     # Build plugin (ESM bundle ← packages/omo-opencode/src/index.ts + .d.ts + cli bundle + schema)
bun run build:all                 # Build + 12 generated platform launchers
bun run build:binaries            # 12 generated platform launchers only (script/build-binaries.ts)
bun run build:lsp-tools-mcp       # npm ci + build the vendored LSP MCP package
bun run build:lsp-daemon          # npm ci + build the vendored per-user LSP daemon package
bun run build:schema              # Regenerate assets/oh-my-opencode.schema.json
bun run build:model-capabilities  # Refresh shared/model-capabilities cache from models.dev
bun run typecheck                 # tsgo --noEmit + typecheck:script + typecheck:packages (NOT tsc; @typescript/native-preview)
bun run typecheck:packages        # tsgo per workspace package
bun run clean                     # rm -rf dist
bunx oh-my-opencode install       # Interactive setup wizard
bunx oh-my-opencode doctor        # Health diagnostics (4 categories: System / Config / Tools / Models)
bunx oh-my-opencode run <message> # Non-interactive session (auto-completes when todos done + no bg tasks)
bunx oh-my-opencode mcp oauth login <server-name> # Tier-3 MCP OAuth (PKCE + DCR); top-level command is `mcp` with nested `oauth login|logout|status`
```

## DEVELOPMENT ENVIRONMENT

Cross-harness, one-command dev setup. The **single source of truth** is [`script/agent/setup.sh`](script/agent/setup.sh): it verifies the toolchain (bun/node/git, warns if tmux is missing), runs `bun install`, and runs `bun run build` only when `dist/index.js` is missing or `OMO_AGENT_FORCE_BUILD=1` (cheap to re-run). [`script/agent/cleanup.sh`](script/agent/cleanup.sh) removes regenerable transients by default and takes `--deep` to also drop `dist/`, vendored `packages/*/dist/`, and `node_modules/`. [`script/agent/cleanup-hook.sh`](script/agent/cleanup-hook.sh) is the non-blocking Claude Code SessionEnd launcher for that cleanup worker. Every harness below delegates to those scripts, so there is exactly one place to maintain. Claude Code reads [`CLAUDE.md`](CLAUDE.md) (a symlink to this AGENTS.md) and OpenCode reads this file, so every harness shares one infra.

| Harness | Committed wiring | Runs |
|---------|------------------|------|
| GitHub Codespaces / VS Code Dev Containers | [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) + [`.devcontainer/Dockerfile`](.devcontainer/Dockerfile) (Node 24 + Bun 1.3.12 + tmux) | `postCreateCommand` runs `setup.sh` on container create |
| Plain Docker | [`script/agent/docker-dev.sh`](script/agent/docker-dev.sh) | builds the same Dockerfile, opens a shell |
| Cursor cloud agents | [`.cursor/environment.json`](.cursor/environment.json) | `install` runs `setup.sh` on environment creation |
| Claude Code | [`.claude/settings.json`](.claude/settings.json) | `SessionStart` runs `setup.sh`, `SessionEnd` launches `cleanup-hook.sh` |
| Codex App (local environments) | [`.codex/setup.sh`](.codex/setup.sh) | committable setup script Codex runs at project root on worktree creation |
| Codex Cloud / Codex CLI | no committable hook | Cloud: paste the `setup.sh` commands into the web-UI Setup script field. CLI: AGENTS.md only. |
| OpenCode (this plugin's own harness) | root [`AGENTS.md`](AGENTS.md) + [`CLAUDE.md`](CLAUDE.md) symlink | no worktree hook; run `script/agent/setup.sh` (Claude Code auto-runs it via `.claude/settings.json`) |

**Credentials and isolation.** [`.env.example`](.env.example) is the committed injection point: copy it to `.env` (gitignored) ONCE and fill in keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, optionally `OPENCODE_SERVER_PASSWORD`). `setup.sh` and `qa-sandbox.sh` auto-source `.env`, so credentials are set once per machine and never prompted again. For QA, `source` [`script/agent/qa-sandbox.sh`](script/agent/qa-sandbox.sh): it exports an isolated, throwaway environment (its own `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`/`XDG_STATE_HOME` and a fresh `CODEX_HOME` under a `mktemp` dir, plus `OPENCODE_DISABLE_AUTOUPDATE`/`OPENCODE_DISABLE_MODELS_FETCH`) so QA NEVER reads or writes the host's real `~/.config/opencode` or `~/.codex`. Mirrors the `opencode-qa` and `codex-qa` skill conventions. For containerized environments, [`.devcontainer/README.md`](.devcontainer/README.md) documents how to inject provider credentials and your `~/.codex`, `~/.claude`, and `~/.config/opencode` config into the container.

**MAINTENANCE - KEEP THIS IN SYNC.** `script/agent/setup.sh`, `script/agent/cleanup.sh`, and harness launchers such as `script/agent/cleanup-hook.sh` are the contract. Whenever a setup dependency or configuration is added, breaks, or changes (a new build step, a pinned tool version in the Dockerfile, a new env var or credential, a new harness wiring file), you MUST, in the SAME change, update: this section; the matching "Development Environment" / "Credentials & Isolation" sections in [`CONTRIBUTING.md`](CONTRIBUTING.md); [`.devcontainer/README.md`](.devcontainer/README.md) if container config injection changed; and the matching skill (`opencode-qa` for the OpenCode side, `codex-qa` for the Codex side) whose isolation conventions `qa-sandbox.sh` mirrors. Keep `script/agent-env.test.ts`, `script/agent-harness-wiring.test.ts`, and `script/agents-md-dev-env.test.ts` green. `CLAUDE.md` is a symlink to this file, so the Claude side stays in sync automatically. The scripts, the docs, and the skills must never drift out of sync.

## CI/CD

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to master/dev | Tests, typecheck, build, codex-compatibility (`bun run test:codex`, ubuntu/macos/windows), auto-commit schema on master push, draft "next" release on dev push (blocks master-targeting PRs) |
| `publish.yml` | manual dispatch | Test, typecheck, preflight-trust (OIDC verify workspace packages), dual npm publish (`oh-my-opencode` + `oh-my-openagent`) + `lazycodex-ai` npm alias (`publish_lazycodex`, default on) + automatic Codex marketplace sync to `code-yeongyu/lazycodex` on every **stable** release (no toggle; gated on empty `dist_tag`, needs `LAZYCODEX_SYNC_TOKEN`), 12 platform launcher packages, GitHub release, merge to master |
| `publish-platform.yml` | called by publish.yml | 12 generated Node launcher packages for darwin/linux/windows |
| `sisyphus-agent.yml` | @mention or manual dispatch | AI agent handles issues/PRs |
| `refresh-model-capabilities.yml` | weekly cron / dispatch | Refresh model capabilities from models.dev API |
| `cla.yml` | issue_comment / PR | CLA assistant for contributors |
| `lint-workflows.yml` | push/PR touching `.github/workflows/**` | actionlint only (`shellcheck=""` disables shellcheck) |
| `web-ci.yml` | push/PR to master/dev touching `packages/web/**`, `docs/**`, or the workflow file itself | format-check, lint, type-check, next build, opennextjs-cloudflare build |
| `web-deploy.yml` | push to master/dev touching `packages/web/**`, `docs/**`, or the workflow file itself, OR manual dispatch | Cloudflare Workers deploy via `cloudflare/wrangler-action@v3` (requires `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets) |
| `package-labels.yml` | issues opened/edited + pull_request_target | Auto-applies package labels (`opencode` / `lazycodex` / `lazycodex-generated`) |
| `stats.yml` | weekly cron (Sun) / dispatch | Runs `script/stats.ts` (npm + GitHub-release download counts) |

## PR MERGE POLICY

- **PRs into `dev` MUST use merge commits.**
- Use `gh pr merge <number> --merge --delete-branch` after CI, review-work, and Cubic pass.
- **NEVER squash merge or rebase merge** PRs in this repository, even if a generic workflow, skill, or GitHub default suggests it.
- If another instruction says `--squash` or `--rebase`, this repo-level rule overrides it.

## NOTES

- **Logger:** writes `oh-my-opencode.log` to the OS temp dir (`/tmp` on Linux, `/var/folders/.../T/` on macOS, `%TEMP%` on Windows — i.e. Node's `os.tmpdir()`). Rotated at 50 MB; previous segments live at `.1` and `.2` (oldest dropped).
- **Background tasks:** 5 concurrent per `${providerID}/${modelID}` key by default (configurable via `background_task.modelConcurrency` / `providerConcurrency`); FIFO queue when slots full.
- **Plugin load timeout:** 10s for Claude Code plugin discovery.
- **Model fallback:** per-agent chains in `packages/omo-opencode/src/shared/model-requirements.ts`. **There is no single global priority.**
- **Two fallback systems:** `model-fallback` (proactive, chat.params, hardcoded chains) vs `runtime-fallback` (reactive, session.error, configurable per-category/agent).
- **Config migration:** idempotent via `_migrations` tracking, atomic writes with timestamped backups.
- **Build:** `bun build` (ESM, entry `packages/omo-opencode/src/index.ts`) + `tsc --emitDeclarationOnly`, external: `zod`.
- **CI tests:** root tests run through plain `bun test`; `packages/web/**` has its own package-level CI workflow.
- **Barrel `index.ts` files** establish module boundaries within `packages/omo-opencode/src/`.
- **Architecture rules** enforced via the `rules-injector` hook reading `.omo/rules/*.md` (e.g. `test-discipline.md`, `file-size-architectural-smell.md`, `typescript-programmer.md`).
- **Windows builds:** run on `windows-latest` (not cross-compiled) to avoid Bun segfaults.
- **Platform launchers:** detect AVX2 + libc family at runtime, fallback to baseline if needed.
- **IntentGate (`keyword-detector`):** classifies user intent (`ultrawork`/`ulw`, `search`, `analyze`, `team`) and injects mode-specific prompts.
- **Hashline edit:** every `Read` output tagged with `LINE#ID` content hashes (chars from `ZPMQVRWSNKTXJBYH`); edits reject on hash mismatch.
- **zauc-mocks pattern:** directories named `zauc-mocks-*` (under `packages/omo-opencode/src/hooks/`, `tools/`, `mcp/`, `shared/`) hold `mock.module()` setup that must load alphabetically before the tests that consume those mocked modules. The `zauc-` prefix is purely a sort-order hack for `bun:test` discovery; these are NOT hooks/tools.
- **Test discipline meta-audits:** repo-wide tests that parse source and FAIL the suite on invariant violations: `packages/omo-opencode/src/shared/mock-module-lifecycle-audit.test.ts` (`mock.module()` without restore) and `prompt-async-route-audit.test.ts` (raw `session.promptAsync` outside the gate) via the TS compiler API; `script/package-registration-audit.test.ts` (workspace/devDep registration + ROADMAP reverse-dependency edges stay zero); `script/shared-core-extraction-guard.test.ts` (`packages/*-core` stay harness-neutral); `packages/omo-opencode/src/shared/markdown-link-audit.test.ts` (no machine-local absolute paths in committed `.md`); `opencode-coupling-audit.test.ts` (×2 pkgs — non-adapter packages must not import `@opencode-ai/*`).
- **Docs:** see [`docs/guide/`](docs/guide) for user-facing guides (overview, installation, orchestration, agent-model-matching, team-mode), [`docs/reference/`](docs/reference) for CLI/configuration/features reference. See also [`CHANGELOG.md`](CHANGELOG.md), [`docs/reference/prompt-async-gate-rfc.md`](docs/reference/prompt-async-gate-rfc.md), and [`docs/reference/release-process.md`](docs/reference/release-process.md).
- **Rules files** (auto-injected by `rules-injector` hook): scans `.omo/rules/`, `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, plus `.github/copilot-instructions.md` and `.mdc` files.
- **Process cleanup:** Background-agent error handlers are now log-only — no force-exit on transient errors. Opt out entirely via `OMO_DISABLE_PROCESS_CLEANUP=1` env var.
- **First-prompt watchdog:** `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts` detects main or subagent sessions producing no progress within 90s and triggers fallback / abort; a subagent removed after the watchdog arms is still suppressed.
- **ParentWakeNotifier:** Background-agent parent-wake state in `packages/omo-opencode/src/features/background-agent/parent-wake-notifier.ts` with dependency-injected client and enqueue callback.
- **Workspace migration:** Runtime state migrated from `.sisyphus/` → `.omo/`. Legacy `.sisyphus/` still exists during transition; `packages/omo-opencode/src/shared/legacy-workspace-migration.ts` copies it forward on first load.
- **CI nuance:** PRs targeting `master` are hard-blocked — they MUST target `dev`. CI auto-commits schema changes on master push and creates a draft "next" release on dev push.
