# Known Issues

Tracks bugs that are present in the current release but have been intentionally deferred. Each entry should explain the symptom, the history, any workaround, and the planned resolution.

## #4184 - Custom provider models without `limit` do not auto-compact

- **Affects**: OpenAI-compatible custom providers whose models are written to `opencode.json` without a `limit` block.
- **Symptom**: OpenCode sees the model context as `0`, so auto-compaction never triggers and long sessions can overflow the model window.
- **Workaround**: Add a `limit` block to each custom provider model in `opencode.json`, for example:

```json
{
  "glm-5.1": {
    "name": "GLM-5.1",
    "limit": { "context": 200000, "output": 16384 }
  }
}
```

- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4184.

## v4.2.1 - Delegate-task early-failure-fallback (BLOCKER-4, resolved)

BLOCKER-4 is resolved in v4.2.1. Delegated child sessions now retain the first prompt payload before dispatch and consume that bootstrap payload exactly once when runtime fallback must retry an empty-history child session.

## v4.2.0 - Delegate-task early-failure-fallback (BLOCKER-4, deferred from PR #3825)

### Symptom

A delegated child session that fails on its very first `promptAsync` call (for example, the provider rejects the request before any session history is persisted) may not advance to the configured fallback models. The session ends in early failure instead of retrying with the next fallback in the chain.

This affects subagents launched via the delegate-task tool (background or sync) where the first provider call fails immediately and `session.messages` is still empty.

### History

PR #3825 (`tw-yshuang/fix/delegated-child-session-early-failure-fallback`, merged as `cd33f3a39` and then `fac90d69f` on 2026-05-07) introduced a shared bootstrap context (`packages/omo-opencode/src/shared/delegated-child-session-bootstrap.ts`) to capture the retry payload before the first prompt dispatch, so empty-history failures could still retry with the fallback chain.

After the merge landed on `dev`, the PR's own regression test (`delegated child-session empty-history fallback retries with captured bootstrap prompt` in `packages/omo-opencode/src/hooks/runtime-fallback/index.test.ts`) failed on a clean root `bun test --timeout 30000` run (6828 pass / 1 fail). PR #4044 (`code-yeongyu/revert/3825-delegated-bootstrap`, revert commit `3c7d1299a`, merge-revert commit `e2b8e49e2`, merged on 2026-05-15) reverted the merge to keep `dev` green (6823 pass / 0 fail / 6 skip across 709 files).

The original failure-mode the PR targets remains in v4.2.0.

### Workaround

- For delegated subagents, prefer providers that succeed reliably on the first call (rarely fail with auth/quota errors at request time).
- Configure fallback models conservatively in `categories[].fallback_models` and accept that the very first failure may not auto-retry.
- The existing runtime-fallback persisted-history retry path still works after the subagent produces any history.

### Tracking

Issue #4059 tracks the reland with stabilized regression coverage. The reland is deferred to a follow-up release and should account for current schema-shape changes plus prompt-async-gate semantics.

## #4225 — Custom LSP config in `.opencode/oh-my-openagent.jsonc` is silently ignored

- **Affects**: v4.2.3+ after the LSP to MCP migration.
- **Symptom**: Custom LSP server configuration in your project's `oh-my-openagent.jsonc` is not applied at runtime.
- **Workaround**: Configure your LSP server through OpenCode's native `lsp` config instead.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4225.

## #4990 — Team-mode lead can stall after full quiescence

- **Affects**: Team-mode workflows where the lead and all members become idle with no unread messages or pending tasks.
- **Symptom**: The team looks finished, but the lead does not start the next turn until the user sends a manual nudge such as `are you done?`. After that nudge, the lead can call `team_status` and continue.
- **Workaround**: Before assuming the team is stuck, send one short manual nudge and ask the lead to run `team_status` plus `team_task_list`. For long multi-round runs, prefer explicit `team_task_*` state over ad-hoc message counting so the lead has a deterministic completion signal.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4990.

## #4863 — OpenCode 1.16.x starts with only build/plan agents after install

- **Affects**: OpenCode 1.16.x with oh-my-openagent 4.7.x.
- **Symptom**: After installing oh-my-openagent, the OpenCode agent list only shows the built-in build/plan agents. `bunx oh-my-openagent doctor` can still report `System OK`, so this looks like a successful install even though the OMO agents are not visible.
- **Workaround**: Stop OpenCode, clear the OpenCode and OMO cache directories, then reinstall:

  ```sh
  rm -rf ~/.cache/opencode/ ~/.cache/oh-my-openagent/ ~/.cache/oh-my-opencode/
  bunx oh-my-openagent install
  ```

- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4863.

## #4710: `@plan` may stay in Sisyphus instead of switching to Prometheus

- **Affects**: Current OpenCode/Ultimate planning flow.
- **Symptom**: Typing `@plan` from Sisyphus can leave the request in Sisyphus instead of handing it to Prometheus.
- **Workaround**: Switch to Prometheus first with the Tab agent selector or `/agent`, ask for the plan there, then run `/start-work` after approval.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4710.

## #4733 - Credit usage can spike after v3 to v4 upgrades

- **Affects**: Anthropic subscription-token users upgrading from the older v3 agent stack to the v4 orchestration stack.
- **Symptom**: A workload that previously lasted all day can hit Claude session or usage limits within a few hours, even when the user believes the model list stayed the same.
- **Likely contributors**: Larger v4 system prompts, more explicit orchestration instructions, background delegation, retry/fallback behavior, and feature hooks that did not exist in the same form in v3.
- **Workaround**: For cost-sensitive sessions, pin cheaper category models, avoid `ulw`/team-mode/background delegation unless needed, and disable optional high-churn hooks or features before long interactive work. Use `opencode models`, `bunx oh-my-openagent doctor`, and provider dashboards to verify the effective model and usage path instead of relying on remembered v3 defaults.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4733.

## #4734 - Version pins can report one version while another build loads

- **Affects**: OpenCode plugin entries pinned as `oh-my-openagent@<version>` when package cache resolution still serves a newer installed build.
- **Symptom**: The version checker says the plugin is pinned, for example to `3.16.0`, but the session header shows a newer running version such as `4.7.5`.
- **Workaround**: Treat the session header and loaded package cache as the source of truth. Clear the OpenCode package cache for `oh-my-openagent@latest` / pinned entries, reinstall the exact package version, and re-open OpenCode before relying on a downgrade to reduce usage or behavior changes.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4734.

## #5050: OpenCode can hang during startup before the plugin runs

- **Affects**: OpenCode 1.16.2 startup with external plugins and cold package caches.
- **Symptom**: `opencode --pure` starts, but normal `opencode` clears the terminal and stalls after `service=plugin path=oh-my-openagent@latest loading plugin`.
- **Workaround**: If the hang happens before `/tmp/oh-my-opencode.log` gets a plugin entry, avoid the npm resolver path by using an absolute `file://` plugin path or by pre-populating the OpenCode package cache. If logs point to a malformed or locked `opencode.db`, back up and remove `~/.local/share/opencode/opencode.db*`; OpenCode recreates it on next start, but local session history is lost.
- **Status**: Open. The npm resolver timeout belongs upstream in OpenCode; tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5050.

## #5072: Blank TUI when the external plugin is enabled globally

- **Affects**: OpenCode 1.16.2 on macOS when `oh-my-openagent@latest` is loaded from global `opencode.jsonc`.
- **Symptom**: The TUI opens to a blank screen and logs stop around `service=plugin path=oh-my-openagent@latest loading plugin`; disabling plugins restores normal startup.
- **Workaround**: Temporarily remove the plugin from global config, then retry with a pinned plugin version or a project-local plugin entry so the failing config can be isolated. Start with `opencode --log-level DEBUG .` and compare logs with `plugin: []` before assuming provider or terminal rendering is at fault.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5072.

## #5260: Background tasks can wait on an LSP install decision

- **Affects**: Background tasks that call LSP tools when the language server is not installed.
- **Symptom**: The task reports that it is stuck on `lsp_install_decision` and waits for an install prompt instead of continuing without LSP.
- **Workaround**: Record a `declined` install decision for the missing server with `lsp_install_decision`; future LSP calls collapse to a one-line warning. To share that decision across sessions, set `LSP_TOOLS_MCP_INSTALL_DECISIONS` to a stable decisions-file path.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5260.

## #5810: Session tools can miss history outside the current instance scope

- **Affects**: `session_read`, `session_search`, and `session_list` when OpenCode is launched from a directory whose instance scope excludes older sessions, especially non-git directories on Windows.
- **Symptom**: `session_info(<id>)` can return metadata for a session while `session_read(<id>)` reports `Session not found`, and `session_list()` shows only a small subset of sessions that exist in the SQLite database.
- **Workaround**: Use `session_info` first when you know the session id, then relaunch OpenCode from the project directory that owns the historical sessions before using read/search/list. For forensic work, inspect/export the OpenCode DB directly rather than relying on scope-filtered list output.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5810.

## #5804: Parent session can miss background completion notifications

- **Affects**: Sisyphus sessions that dispatch background work with `task(run_in_background=true)` or `call_omo_agent` and then end the turn saying they are waiting.
- **Symptom**: The child/background agent completes, but the parent never receives or acts on the wake notification, so the visible session stays stuck until the user manually sends a follow-up such as `continue`.
- **Workaround**: Keep the parent session active with a short manual follow-up after expected background completion, then ask it to check background task status/output. For critical work, prefer synchronous delegation or explicitly poll task output rather than relying on a single automatic wake.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5804.

## #5790: Completed background results can require a manual follow-up

- **Affects**: Background or parallel investigations where the parent agent promises to wait for the result and then ends the turn.
- **Symptom**: The background work may finish successfully, but no final answer is delivered into the original conversation until the user asks whether the result came back.
- **Workaround**: Ask the parent to record the task ids before waiting, then send one follow-up after the expected completion window asking it to read those task outputs and summarize. For long-running work, prefer explicit task status checks over assuming the parent will proactively resume.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5790.

## #5802: `multimodal-looker` can hang on `opencode/mimo-v2.5-free`

- **Affects**: `look_at` / `multimodal-looker` when `agents.multimodal-looker.model` is explicitly set to `opencode/mimo-v2.5-free`.
- **Symptom**: The delegated image-reading task receives image data but never returns a response or clear timeout. `doctor` can also report the configured model as `unknown`.
- **Workaround**: Do not use `opencode/mimo-v2.5-free` as the primary multimodal-looker model. Use a known working OpenCode free-tier model such as `opencode/deepseek-v4-flash-free` or `opencode/big-pickle`, then keep `mimo-v2.5-free` out of the primary slot until the model registry/dispatch path is fixed.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5802.

## #5341: `oh-my-opencode` Linux/Windows wrapper can miss platform binaries

- **Affects**: `npm install -g oh-my-opencode@4.10.0` on Linux x64 and Windows x64.
- **Symptom**: Running `oh-my-opencode --version` exits with `Platform binary not installed` because the wrapper looks for `oh-my-opencode-linux-x64` / `oh-my-opencode-windows-x64`, while the published platform packages for those targets use the `oh-my-openagent-*` family.
- **Workaround**: Install through the `oh-my-openagent` package family or use `bunx oh-my-openagent ...` until the wrapper/platform package aliasing is made symmetric. If you already installed the broken wrapper globally, remove it before reinstalling to avoid bin shadowing.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5341.

## #5331: `team_mode.base_dir` does not expand a literal `~`

- **Affects**: Team mode configs that set `"base_dir": "~/.omo"` instead of leaving the field unset/null.
- **Symptom**: OMO creates a real directory named `~` in the current working directory, with team state under `./~/.omo/...`, rather than writing to the user's home directory.
- **Workaround**: Use an absolute path for `team_mode.base_dir`, or set it to `null`/remove it so OMO uses its built-in home-directory default. Delete any accidental literal `./~` directories only after confirming they contain no state you still need.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5331.

## #5317: `team_send_message` replies can disappear after team activation

- **Affects**: Team-mode workflows on the reported 4.10.0 path where leads send activation checks to members immediately after `team_create`.
- **Symptom**: `team_send_message` reports successful delivery, but member acknowledgements never appear in the lead transcript or status flow, leaving the lead unable to confirm that members are alive.
- **Workaround**: Before relying on multi-member activation, run a one-member smoke team and verify a reply reaches the lead. If replies do not appear, fall back to a parent-driven workflow with explicit `team_task_*` state checks or use the last known working version for team-mode-heavy runs.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5317.

## #5120: Sisyphus can loop on simple tasks

- **Affects**: OpenCode 1.17.0 with oh-my-openagent 4.8.1.
- **Symptom**: A trivial prompt such as `output hello world` can repeat the plan-style status block instead of answering directly.
- **Workaround**: For one-off trivial prompts, run `opencode --pure` or temporarily disable the plugin for that session.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5120.

## #5187: ChatGPT Plus installs can select API-tier Codex models

- **Affects**: TUI installer runs where the user selects ChatGPT Plus / `--openai=yes`.
- **Symptom**: Generated category config can map `unspecified-low` and `unspecified-high` to `openai/gpt-5.3-codex`, which then fails for accounts that do not have that API-tier model available even though `doctor` reports the installation as healthy.
- **Workaround**: Edit `.opencode/oh-my-openagent.jsonc` and move those categories back to a model available through your actual provider set, such as an OpenCode Go Kimi/GLM entry or a supported GPT model visible in `opencode models`. Re-run `bunx oh-my-openagent doctor` after the edit to confirm effective model resolution.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5187.

## #5105: Ralph Loop can flood logs while child subagents are active

- **Affects**: Sessions with an active Ralph Loop and background child subagents.
- **Symptom**: `/tmp/oh-my-opencode.log` repeats `promptAsync reservation release skipped for different source` while child subagents emit message events.
- **Workaround**: If you are not using Ralph Loop in that workspace, add `"disabled_hooks": ["ralph-loop"]` to `oh-my-openagent.jsonc`. If a loop is already active, run `/cancel-ralph` before disabling the hook.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5105.

## #5107: Team tmux visualization can silently skip pane creation

- **Affects**: Team mode with `team_mode.tmux_visualization: true` on OpenCode 1.16.2 / OMO 4.8.1 when the TUI uses a dynamic server port.
- **Symptom**: `team_create` reports an active team, but no tmux panes are spawned, `team_status` has no `tmuxPaneId`, and the only clue is an internal log line saying the OpenCode server is not reachable.
- **Workaround**: Launch OpenCode with an explicit matching port in both places, for example `OPENCODE_PORT=24096 opencode --port 24096`, then create the team from that session. Treat `removedLayout: true` on delete as a requested-layout flag, not proof that panes existed.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5107.

## #5025 — OpenCode Desktop loads the plugin but only shows native modes

- **Affects**: OpenCode Desktop on Windows with `oh-my-openagent@4.7.5`.
- **Symptom**: The Desktop plugin list shows `oh-my-openagent` as loaded, but the UI only exposes the native `build` and `plan` modes. The OpenCode log may include `Runtime skill source server requires Bun.serve failed to load plugin`.
- **Workaround**: Disable the runtime security skills that start the Bun-backed skill source server, then restart OpenCode Desktop:

  ```json
  {
    "disabled_skills": [
      "security-research",
      "security-review"
    ]
  }
  ```

- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5025.

## #5021 — Codex planner or reviewer subagents can appear stuck

- **Affects**: LazyCodex / OMO Codex planner and reviewer flows that use native Codex subagents.
- **Symptom**: A parent session can receive repeated `wait_agent` timeouts while a planner or reviewer subagent remains `running`. Follow-up prompts may not recover the run, and the session can look stuck until the child agent is closed or respawned.
- **Workaround**: Use short wait cycles, send one targeted follow-up that asks the child to return a result or `BLOCKED`, then record the child as inconclusive before closing or respawning it. Do not treat repeated wait timeouts as proof that the child finished.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5021.

## #5481 - LazyCodex can continue without consuming a spawned planner result

- **Affects**: LazyCodex `ulw` flows that spawn a planner/research subagent while the parent keeps executing.
- **Symptom**: The planner continues spending high-effort tokens, but the main agent proceeds with its own plan and never incorporates the planner output.
- **Workaround**: For work that truly needs a plan, ask for the plan as a first explicit step and wait for it before implementation, or manually stop the parent when it starts executing before the spawned planner returns. Treat background planner output as advisory unless the parent explicitly reports that it read and applied it.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5481.

## #5544 - Session titles can fall back to timestamp names

- **Affects**: Windows OpenCode sessions after ULW/OMO install when title generation fails or receives the wrong prompt text.
- **Symptom**: Session list entries become generic names such as `New session-2026-06-24T03:24:10.559Z` instead of a short task description.
- **Workaround**: Check the configured OpenCode title model and fix any `doctor` failure first, especially Bun/UTF-8 errors on Windows. If the session is already created, rename it manually in the OpenCode UI or start a new session with a short first user message before entering `ulw`.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5544.

## #5560 - LSP daemon MCP proxy processes can survive ended sessions

- **Affects**: LSP-backed MCP proxy processes (`cli.js mcp`) after OpenCode sessions end normally or are killed.
- **Symptom**: Multiple stale `lsp-daemon` proxy processes and language-server children accumulate over days, consuming significant memory even though the original OpenCode sessions are gone.
- **Workaround**: Periodically inspect process lists for stale `lsp-daemon` / language-server children and terminate orphaned processes after closing OpenCode. If memory pressure appears, restart the editor/terminal session that launched OpenCode so inherited daemon handles are released.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5560.

## #5575 - OpenCode 1.17.10+ can stop dispatching OMO hooks

- **Affects**: OMO versions still wired to OpenCode's older plugin hook shape when run on OpenCode 1.17.10 or newer.
- **Symptom**: The plugin loads without an obvious crash, but session lifecycle hooks stop firing, subagent completion reminders do not reach the parent, and delegated work can look permanently stuck.
- **Workaround**: If this exact regression appears, downgrade OpenCode to `1.17.9` or use an OMO build that explicitly includes the SDK v2 compatibility wrapper. Do not debug it as a model/provider problem until hook delivery has been confirmed.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5575.

## #5586 - ULW sessions can be titled `ULTRAWORK MODE ENABLED!`

- **Affects**: ULW prompts when title generation sees the injected ultrawork instruction block before the user's task text.
- **Symptom**: The session title describes the mode banner instead of the actual task, making session history hard to scan.
- **Workaround**: Start complex work with a short descriptive first sentence before `ulw`, or rename affected sessions manually after creation. If you rely heavily on history search, avoid starting multiple unrelated tasks with identical `ulw` prefixes until title injection ordering is fixed.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5586.

## #5574 - Agent config rewrites can confuse Sisyphus-Junior overrides

- **Affects**: Configs that use display-style keys such as `Sisyphus-Junior` instead of canonical config keys such as `sisyphus-junior`.
- **Symptom**: OMO rewrites the config and creates a backup, but the effective model/category override can appear to apply to the wrong name, causing Sisyphus-Junior to fall back to a cheaper/default model.
- **Workaround**: Use canonical lower-case agent keys in `oh-my-openagent.jsonc` (`sisyphus-junior`, `sisyphus`, `atlas`, etc.) and use display-name settings only for UI labels. After migration, run `bunx oh-my-openagent doctor` and inspect the effective model for `sisyphus-junior`.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5574.

## #5573 - Background tasks can hang behind incomplete todos

- **Affects**: Background tasks whose subagent creates todos and produces a final answer while one or more todos remain `pending` or `in_progress`.
- **Symptom**: The parent never receives the completed result because background completion waits for todos to resolve; disabling `todo-continuation-enforcer` can make this worse by removing the recovery prompt.
- **Workaround**: Do not disable `todo-continuation-enforcer` for background-heavy workflows. In background prompts, add a final instruction to mark every todo completed immediately before emitting the final result, and avoid forcing extra todo usage through skills unless task tracking is essential.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5573.

## #5548 - ULW continuation can override intentional user-input pauses

- **Affects**: ULW sessions where the agent has unfinished todos but intentionally stops to ask the user for a required decision.
- **Symptom**: A continuation prompt can push the model to proceed without the user's answer, causing it to invent defaults or make decisions that should have stayed with the user.
- **Workaround**: When asking ULW to do work that needs human confirmation, explicitly require `BLOCKED awaiting user input` and no further action until the answer arrives. For sensitive approval workflows, use a normal interactive prompt or disable the continuation hook for that session rather than relying on ULW autonomy.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5548.

## #4722 - Codex hooks can report exit code 1 immediately after install

- **Affects**: LazyCodex / OMO Codex installs where Codex keeps running across a plugin cache/config update.
- **Symptom**: Codex shows `SessionStart hook (failed)` or `UserPromptSubmit hook (failed)` with `hook exited with code 1`, but the visible saved hook output may not identify which OMO component failed.
- **Workaround**: Re-run `npx --yes lazycodex-ai@latest install --no-tui --skip-auth`, start a fresh Codex session, and confirm no hook failure banner appears. If failures persist, manually replay the registered OMO hook commands with minimal Codex-shaped JSON payloads so the failing component can be separated from unrelated global hooks.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4722.

## #3303 - Windows OpenCode proxy install can fail before OMO loads

- **Affects**: Windows OpenCode installs behind an HTTP(S) proxy, especially first startup paths that ask OpenCode to fetch `oh-my-openagent@latest`.
- **Symptom**: OpenCode may show only default agents or log `fetch() proxy.url must be a non-empty string` before OMO loads, so OMO hooks and doctor cannot repair the install from inside the plugin.
- **Workaround**: Launch OpenCode from a shell that has `HTTP_PROXY` and `HTTPS_PROXY` set, then preinstall the package into OpenCode's Windows config prefix with `npm install oh-my-openagent@latest --prefix "%APPDATA%\\opencode"`. Restart OpenCode and verify with `bunx oh-my-openagent doctor --json`.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/3303.

## #4702 - Windows TUI plugin install can pause startup on a Bun npm git error

- **Affects**: Windows OpenCode startup when `tui.json` includes `oh-my-openagent/tui`.
- **Symptom**: OpenCode's built-in Bun npm client can spend about 62 seconds trying to install the TUI plugin before failing with `NpmInstallFailedError` and an unknown git error. Core OMO agents, skills, commands, and MCP tools still work without the TUI plugin.
- **Workaround**: Remove `oh-my-openagent/tui` from the `plugin` list in `tui.json` until the Bun npm install path is fixed.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4702.

## #4170 - CJK characters in custom agent display names can render as mojibake

- **Affects**: OpenCode TUI sessions with custom OMO agent display names that include Chinese, Japanese, or Korean characters.
- **Symptom**: The ASCII part of the agent name renders normally, but the CJK characters in the TUI header can appear garbled.
- **Workaround**: Use ASCII-only custom display names such as `Sisyphus - Orchestrator` until the TUI rendering path handles multi-byte character widths reliably.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4170.

## #3835 / #3456 — OpenCode Desktop shows only native agents

- **Affects**: OpenCode Desktop sessions where `opencode agent list` or the TUI still shows OMO agents, but the Desktop agent selector only shows native agents such as Build and Plan.
- **Symptom**: Desktop hides Sisyphus, Hephaestus, Prometheus, Atlas, or other OMO agents even though `oh-my-openagent doctor` passes.
- **First check**: Inspect the OpenCode Desktop log for `Failed to load plugin oh-my-openagent@latest` and missing files under `~/.cache/opencode/packages/oh-my-openagent@latest/node_modules`.
- **Cache workaround**: Close Desktop, remove the `oh-my-openagent@latest` package cache, then reinstall the plugin from the same working directory with `opencode plugin oh-my-openagent@latest`.
- **Scope workaround**: If the plugin loads in one shell but not Desktop, compare the active user and project `opencode.json` files. OpenCode can read a closer project `.opencode/opencode.json` instead of the user config you inspected.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/3835 and https://github.com/code-yeongyu/oh-my-openagent/issues/3456. This entry documents current triage steps; it does not resolve Desktop GUI rendering regressions.

## #3435 — Anthropic subscription auth may reject prompts containing `opencode`

- **Affects**: Anthropic subscription-token routes and third-party auth plugins. API-key routes may behave differently.
- **Symptom**: Anthropic returns `Third-party apps now draw from extra usage, not plan limits...` for one project while similar projects still work.
- **Likely trigger**: Upstream Anthropic filtering appears sensitive to the literal string `opencode` in custom project rules, system prompt text, or OMO's legacy prompt identifiers.
- **Workaround**: In user-controlled project files such as `AGENTS.md`, prefer `oh-my-openagent`, `OMO`, or `OpenCode` wording instead of the lowercase literal `opencode` when targeting Anthropic subscription providers.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/3435. The runtime prompt-identity cleanup still needs maintainer direction, so this workaround does not close the underlying issue.
