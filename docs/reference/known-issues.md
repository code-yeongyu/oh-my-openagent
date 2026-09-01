# Known Issues

Tracks bugs that are present in the current release but have been intentionally deferred. Each entry should explain the symptom, the history, any workaround, and the planned resolution.

## #5911 - Worktree merge status can ignore dirty filesystem changes

- **Affects**: Agent-managed git worktree handoff and cleanup flows.
- **Symptom**: A worktree can be reported as already merged when `HEAD` matches the target branch, even though modified, untracked, or ignored task-state files still exist only in the worktree. Treating commit ancestry as the whole truth can make users believe work has been integrated before it has been committed, merged, or cleaned up.
- **Workaround**: Before deleting a worktree or accepting an "already merged" answer, run `git status --short --untracked-files=all` from the worktree root. If task state may be ignored, also run `git status --short --ignored --untracked-files=all -- .omo` there. Inspect both results, and delete the worktree only after the filesystem is clean or after the remaining changes have been intentionally copied, committed, or discarded.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5911.

## #5850 - `ulw` planner can fall into native OpenCode plan mode

- **Affects**: Complex `ulw` runs where planning is delegated through a subagent named `plan` while OpenCode's experimental plan mode is enabled.
- **Symptom**: The delegated planner can use OpenCode's native plan workflow, write under `.opencode/plans/` (or OpenCode's data-directory `opencode/plans/` fallback), and show the native `plan_exit` approval prompt instead of returning an OMO plan under `.omo/plans/` to the parent. The nested approval can offer to switch that child to build mode, while leaving it unresolved keeps the synchronous parent task waiting.
- **Workaround**: If a native `plan_exit` prompt appears inside a delegated `ulw` planner, do not switch that nested child to build mode. Interrupt back to the parent, then ask the parent to recover the plan output or rerun planning through Prometheus/OMO planning explicitly.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5850.

## #5839 - Ralph Loop prose-only Oracle approval detection (resolved)

- **Historical behavior**: The former Ralph Loop required Oracle to return the exact `<promise>VERIFIED</promise>` token and could reject a prose-only approval.
- **Resolution**: Ralph Loop is no longer wired into current session hooks. The Goal subsystem replaced its user-facing continuation path and does not use the Ralph Loop Oracle verification detector.
- **Status**: Resolved for current releases. Tracked historically at https://github.com/code-yeongyu/oh-my-openagent/issues/5839.

## #5746 - tmux subagent panes attach only after focus by default

- **Affects**: `tmux.enabled` sessions that expect every subagent pane to show a live attached session immediately.
- **Symptom**: New panes auto-attach for about 5 seconds after spawn (`AUTO_ACTIVATE_GRACE_MS`). If that window is missed, a pane can stay on the placeholder text `Focus this pane to attach` until the user focuses it. With high background concurrency, parts of the tmux layout can look blank or inactive even though subagents are running.
- **Workaround**: Focus a pane to activate its `opencode attach` session, or inspect subagent status through normal task/background outputs when live pane rendering is not necessary. After the grace window, treat focus-to-attach as current behavior; there is no user-facing eager-attach config flag.
- **Status**: Open enhancement. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5746.

## #5809 - cmux tmux panes can stay on the focus-to-attach placeholder

- **Affects**: Users running OMO inside cmux's tmux-compat native split layer.
- **Symptom**: Subagent panes can be created with the "Focus this pane to attach" placeholder but never transition into `opencode attach`, because the activation path relies on `tmux respawn-pane -k`, which cmux may treat as a no-op.
- **Workaround**: Use a real tmux server for subagent pane visualization when interactive attach matters, or avoid relying on focus-to-attach behavior inside cmux until an eager attach path is available. The underlying subagent work can still be inspected through non-pane outputs/logs.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5809.

## #5806 - `ulw` mode does not persist across follow-up messages

- **Affects**: Multi-turn Sisyphus sessions that rely on `ulw` or `ultrawork` keyword injection.
- **Symptom**: The keyword detector is edge-triggered per message. A first prompt that includes `ulw` gets the ultrawork prompt, but a follow-up that omits the keyword can fall back to default Sisyphus behavior and lose the expected delegation pattern.
- **Workaround**: Repeat `ulw` or `ultrawork` in every follow-up message that should stay in ultrawork mode. For long tasks, prefer starting a fresh prompt that includes the keyword instead of assuming the mode remains active.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5806.

## #5838 - LazyCodex frontend runs can skip the visual QA gate

- **Affects**: Codex Light / LazyCodex sessions where the frontend skill is used for UI work.
- **Symptom**: The frontend skill prompt requires a visual QA evidence pass, but Codex currently enforces that requirement through prose instructions rather than a hard completion gate. Under long context or inconvenient browser setup, the model can report completion without screenshots or a dual-oracle visual verdict.
- **Workaround**: Add an explicit instruction such as "verify with visual-qa before claiming done" to frontend prompts, and require screenshot/evidence output before accepting UI work as complete. If no rendered surface is available, ask the agent to state that limitation directly.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5838.

## #5529 - Manual GPT-5.5 custom-provider reasoning effort can conflict with chat providers

- **Affects**: Manual custom-provider configurations that expose `gpt-5.5` through `/v1/chat/completions` but reject tool requests when `reasoning_effort` is present. Current built-in OMO agent chains use GPT-5.6 Sol rather than GPT-5.5.
- **Symptom**: Upstream OpenCode model transforms may supply reasoning effort based on a manually configured GPT-5.5 model ID even when the compatible provider's chat-completions implementation does not support that combination.
- **Workaround**: Use a provider-native route or adapter that supports GPT-5.5 reasoning with tools, or use a custom model/provider configuration that does not emit the unsupported reasoning setting.
- **Status**: Open as a manual custom-provider/upstream OpenCode caveat. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5529.

## #5604 - Required-model delegation availability gate (resolved)

- **Historical behavior**: A required-model subagent could be registered without an available model and then fail before producing child output.
- **Resolution**: Required agents are now skipped during registration when their availability gates find no model in the built-in fallback chain. An explicit user configuration still counts as an intentional override.
- **Status**: Resolved. Tracked historically at https://github.com/code-yeongyu/oh-my-openagent/issues/5604.

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

## #4225 — Custom LSP config in `.opencode/oh-my-openagent.jsonc` is silently ignored

- **Affects**: v4.2.3+ after the LSP to MCP migration.
- **Symptom**: Custom LSP server configuration in your project's `oh-my-openagent.jsonc` is not applied at runtime.
- **Workaround**: Configure the server in `.opencode/lsp.json`, `.omo/lsp.json`, `.omo/lsp-client.json`, or the user-level OpenCode config directory's `lsp.json`.
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

## #5367 — OpenCode-managed `@latest` cache can stay pinned after update

- **Affects**: OpenCode installs that load `oh-my-openagent@latest` or legacy `oh-my-opencode@latest` through OpenCode's `Npm.add()` package sandbox under `~/.cache/opencode/packages/`.
- **Symptom**: OMO reports that an update is available, or `doctor` reports a loaded-version mismatch, but restarting OpenCode keeps loading the older package. Clearing the general npm cache does not necessarily change the sandbox path OpenCode is using.
- **Why it happens**: When the plugin is running from an OpenCode-managed sandbox such as `~/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/`, OMO cannot reliably rewrite that sandbox itself. The auto-update checker therefore avoids claiming "Updated!" from that path and should surface an update-available notice instead.
- **Workaround**: Close OpenCode and keep exactly one OMO entry in the config that currently owns the plugin. If that entry still uses `oh-my-opencode@latest`, replace it with `oh-my-openagent@latest` instead of adding a second entry. Remove the stale OpenCode package sandbox, then reinstall with `--force` in the same config scope:

  ```sh
  rm -rf ~/.cache/opencode/packages/oh-my-openagent@latest \
         ~/.cache/opencode/packages/oh-my-opencode@latest

  # User/global config:
  opencode plugin --global --force oh-my-openagent@latest

  # Project config (run from that project root instead):
  opencode plugin --force oh-my-openagent@latest

  bunx oh-my-openagent doctor --json
  ```

- **Status**: Open. The runtime now avoids the misleading auto-updated toast when it detects an OpenCode-managed sandbox, but users may still need the manual cache refresh above until OpenCode exposes a reliable package-sandbox update path. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5367.

## #4710: `@plan` does not switch to Prometheus

- **Affects**: Current OpenCode/Ultimate planning flow.
- **Symptom**: `@plan` is OpenCode's native plan-agent mention, not an OMO Prometheus switch, so typing it from Sisyphus does not hand the request to Prometheus.
- **Workaround**: Select Prometheus first with the Tab agent selector or `/agent`, ask for the plan there; after the plan is written under `.omo/plans/`, run `/ulw-execute` so Atlas executes it.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/4710.

## #5050: OpenCode can hang during startup before the plugin runs

- **Affects**: OpenCode 1.16.2 startup with external plugins and cold package caches.
- **Symptom**: `opencode --pure` starts, but normal `opencode` clears the terminal and stalls after `service=plugin path=oh-my-openagent@latest loading plugin`.
- **Workaround**: If the hang happens before `$TMPDIR/oh-my-opencode.log` (on Linux often `/tmp/oh-my-opencode.log`) gets a plugin entry, avoid the npm resolver path by using an absolute `file://` plugin path or by pre-populating the OpenCode package cache. If logs point to a malformed or locked `opencode.db`, back up and remove `~/.local/share/opencode/opencode.db*`; OpenCode recreates it on next start, but local session history is lost.
- **Status**: Open. The npm resolver timeout belongs upstream in OpenCode; tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5050.

## #5260: Background tasks can wait on an LSP install decision

- **Affects**: Background tasks that call LSP tools when the language server is not installed.
- **Symptom**: The task reports that it is stuck on `lsp_install_decision` and waits for an install prompt instead of continuing without LSP.
- **Workaround**: Record a `declined` install decision for the missing server with `lsp_install_decision`; future LSP calls collapse to a one-line warning. To share that decision across sessions, set `LSP_TOOLS_MCP_INSTALL_DECISIONS` to a stable decisions-file path.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5260.

## #5120: Sisyphus can loop on simple tasks

- **Affects**: OpenCode 1.17.0 with oh-my-openagent 4.8.1.
- **Symptom**: A trivial prompt such as `output hello world` can repeat the plan-style status block instead of answering directly.
- **Workaround**: For one-off trivial prompts, run `opencode --pure` or temporarily disable the plugin for that session.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5120.

## #5105: Ralph Loop log flooding while child subagents were active (resolved)

- **Historical behavior**: Sessions with an active Ralph Loop and background child subagents could repeatedly log `promptAsync reservation release skipped for different source`.
- **Resolution**: Ralph Loop was replaced by the Goal subsystem (PR #6184), and the `ralph-loop` hook is no longer wired in current session hooks. The original flooding affects only releases before that migration.
- **Status**: Resolved for current releases. Tracked historically at https://github.com/code-yeongyu/oh-my-openagent/issues/5105.

## #5025 - Windows runtime skill source server required Bun.serve (resolved)

- **Historical behavior**: OpenCode Desktop on Windows with `oh-my-openagent@4.7.5` could fail to load the plugin when the runtime skill source server could not use `Bun.serve`.
- **Resolution**: The runtime skill source server now falls back to a Node HTTP server when `Bun.serve` is unavailable. Disabling `security-research` and `security-review` is no longer required for this failure mode.
- **Status**: Resolved for current releases. Tracked historically at https://github.com/code-yeongyu/oh-my-openagent/issues/5025.

## #5021 — Codex planner or reviewer subagents can appear stuck

- **Affects**: LazyCodex / OMO Codex planner and reviewer flows that use native Codex subagents.
- **Symptom**: A parent session can receive repeated `wait_agent` timeouts while a planner or reviewer subagent remains `running`. Follow-up prompts may not recover the run, and the session can look stuck until the child agent is closed or respawned.
- **Workaround**: Do not spin short `wait_agent` cycles; back off between calls by doubling the timeout up to about 5 minutes. Send one targeted follow-up that asks the child to return a result or `BLOCKED`, then record the child as inconclusive before closing or respawning it. Do not treat repeated wait timeouts as proof that the child finished.
- **Status**: Open. Tracked at https://github.com/code-yeongyu/oh-my-openagent/issues/5021.

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
