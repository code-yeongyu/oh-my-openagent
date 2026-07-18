# Installation

oh-my-openagent ships in **two editions** of the same product:

- **Ultimate Edition (omo for [OpenCode](https://opencode.ai))** — the full omo experience. 11 discipline agents, 54+ lifecycle hooks, all built-in MCPs, every slash command, Team Mode, ulw-loop, hashline edits, the works.
- **Light Edition (omo for [OpenAI Codex CLI](https://github.com/openai/codex))** — the portable components that fit Codex's plugin system: `rules`, `comment-checker`, `git-bash`, `lsp`, `ultrawork`, `ulw-loop`, `start-work-continuation`, and `telemetry`, plus plugin-scoped MCPs for `grep_app`, `context7`, `codegraph`, `git_bash`, and `lsp`, and the shared `ast-grep` skill. No agent orchestration and no `team_*` tools — Codex CLI's native surface does that work.

Most users want **Ultimate**. Pick **Light** if you are already invested in Codex CLI. Pick **both** if you want OMO available wherever you happen to be working that day.

| You want | Run | Lands on disk |
| :--- | :--- | :--- |
| Ultimate (OpenCode) | `bunx oh-my-openagent install` (TUI walks you through it) | Plugin registered in `opencode.json`, agent/model config, provider auth |
| Light (Codex CLI) | `npx lazycodex-ai install` | `~/.codex/plugins/cache/sisyphuslabs/omo/`, stable Codex marketplace snapshot, `~/.codex/config.toml` marketplace/plugin/agent blocks, optional autonomous Codex permissions, component CLIs in `~/.local/bin` |
| Both | `bunx oh-my-openagent install --platform=both` | Both of the above |

`lazycodex-ai` defaults to the Codex Light installer and runs through Node/npm. `--platform` on the shared `omo` CLI still defaults to `opencode` (Ultimate). `lazycodex-ai` is the npm/bin alias; `lazycodex` is the GitHub repository that hosts the marketplace bundle. Neither is the Codex marketplace name.

## For Humans

**Strongly recommended: let an LLM agent install Ultimate for you.** Ultimate setup involves subscription detection, model selection across 11 agents, provider authentication, and config migration — humans fat-finger these. An LLM agent reads the full guide and walks every step correctly.

### Ultimate (OpenCode) — let an agent do it

Paste this prompt into Claude Code, AmpCode, Cursor, or any LLM agent session:

```
Install and configure oh-my-openagent by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/docs/guide/installation.md
```

### Light (Codex CLI) — one line, no agent needed

The Light edition installer asks whether to configure Codex for autonomous full-permissions mode. This is recommended for agent-style use: `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, `network_access = "enabled"`, and notice warnings hidden. Use `--codex-autonomous` or `--no-codex-autonomous` to choose non-interactively:

```bash
npx lazycodex-ai install
# non-interactive recommended mode:
npx lazycodex-ai install --no-tui --codex-autonomous
```

It writes managed Codex Light state to `~/.codex/` and does not touch OpenCode or provider flags. During migration from older Codex plugin installs it may also repair the current project's `.codex/config.toml` if that project has the known `multi_agent_v2` plus legacy `[agents] max_threads` conflict; project-owned `.codex` artifacts are reported, not deleted. Global Codex config will register marketplace `sisyphuslabs` from the local built cache under `~/.codex/plugins/cache/sisyphuslabs`, enable plugin `omo@sisyphuslabs`, and write a valid `[features.multi_agent_v2]` limit table. The installer never enables MultiAgentV2; if it finds an explicit legacy `multi_agent_v2 = false` shorthand, it preserves that disable as table-form `enabled = false`.

On Windows, keep the direct `npx lazycodex-ai install ...` form above. Do not rewrite it into an `npx --package` command that launches the `omo install` bin indirectly; that package-manager shape can fail before the installer starts.

On native Windows Codex installs, the installer discovers Git Bash before writing Codex config. It checks `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, and then PATH. If Git Bash is missing, it prints the install guidance shown here and stops without running `winget` or changing system dependencies:

```powershell
winget install --id Git.Git -e --source winget
where bash
```

If Git is installed somewhere custom, set the path before rerunning the installer:

```cmd
setx OMO_CODEX_GIT_BASH_PATH "C:\Program Files\Git\bin\bash.exe"
```

```powershell
$env:OMO_CODEX_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe"
```

Codex may still start Windows shell calls through its own defaults. The Light edition does not write a global Codex shell config; instead it verifies Git Bash is available, enables the Windows-only `git_bash` MCP policy, and injects guidance before the first shell-like call. After compaction, the reminder resets so the next shell-like call gets the same `git_bash` recommendation.

> **Clean install note for older Codex plugin users.** Before installing the Light edition into a Codex home that previously used another Codex plugin bundle, uninstall the older bundle first, then re-run this installer. Multiple bundles may write Codex marketplace plugins, lifecycle hooks, and the `ultrawork`/`ulw` keyword into the same `~/.codex`, so a clean Codex home avoids stale shared `config.toml` keys and duplicate hooks.
>
> To remove the Light edition after migration, run `npx lazycodex-ai uninstall`. It removes managed `sisyphuslabs` Codex cache/marketplace state, strips `omo@sisyphuslabs` plugin and hook-state blocks from `~/.codex/config.toml` with a backup, and removes managed agent TOML files from `~/.codex/agents/`. `cleanup` remains available as a backward-compatible alias.
> If Codex still fails only inside one project with `agents.max_threads cannot be set when multi_agent_v2 is enabled`, run `npx lazycodex-ai install` from that project. The installer repairs project-local `.codex/config.toml` layers from the project root to the current directory, removes conflicting legacy `[agents] max_threads` only when MultiAgentV2 is enabled, and writes timestamped backups next to changed files.

### Install from the Codex marketplace (in-app)

> **Experimental, additive path.** `npx lazycodex-ai install` above remains the primary, fully supported route. The marketplace bundle is hosted in this project's own [lazycodex](https://github.com/code-yeongyu/lazycodex) repository — it is not an OpenAI curated listing.

The same Light edition can be installed entirely from inside Codex through its plugin marketplace, with no npx step.

**TUI route.** In a Codex session, type `/plugins`, open the **Add Marketplace** tab ("Add a marketplace from a Git repo or local root."), and enter the marketplace source:

```
https://github.com/code-yeongyu/lazycodex
```

Then pick `omo` from the `sisyphuslabs` marketplace in the same `/plugins` menu and install it.

**CLI route** — the equivalent two-liner:

```bash
codex plugin marketplace add https://github.com/code-yeongyu/lazycodex
codex plugin add omo@sisyphuslabs
```

**First session: approve the hooks.** On the next `codex` launch the startup hooks review lists every omo hook as new. Review and approve them — no omo hook runs before you approve, and the bootstrap below cannot start until the hooks are trusted.

**Bootstrap notice + restart.** The first approved session prints this status line:

```
LazyCodex bootstrap running in background — restart the session when it completes
```

A detached worker finishes the install in the background (the `sg` download is the slowest part). Restart the Codex session once it completes — the next session starts fully wired and the notice no longer appears.

**What bootstrap does:**

- writes the managed `~/.codex/config.toml` blocks: marketplace source preserved, `omo@sisyphuslabs` plugin enabled, managed `[agents.*]` entries, and re-stamped SHA256 `[hooks.state."omo@sisyphuslabs:..."]` trust hashes
- copies bundled Codex agent TOMLs into `~/.codex/agents/`
- links the top-level `omo` runtime wrapper plus component CLIs (`omo-rules`, `omo-lsp`, …) into `~/.local/bin` (or `$CODEX_LOCAL_BIN_DIR`; isolated `CODEX_HOME` installs use `<CODEX_HOME>/bin`)
- provisions a checksum-pinned standalone `sg` (ast-grep) binary into `<CODEX_HOME>/runtime/ast-grep/<platform>-<arch>/` for the `ast-grep` skill
- on native Windows, provisions a pinned Node LTS runtime into `<CODEX_HOME>/runtime/node/` when `node` is missing (see the Windows status below)
- records every run in the plugin data dir: `<CODEX_HOME>/plugins/data/omo-sisyphuslabs/bootstrap/state.json` plus a JSONL `bootstrap.log` (Windows adds a `ps-bootstrap.log` transcript)

**What bootstrap does NOT do:**

- It **never writes Codex permission settings.** `approval_policy`, `sandbox_mode`, and `network_access` are left untouched. Autonomous mode stays an explicit npx installer choice — `npx lazycodex-ai install --no-tui --codex-autonomous` (see [the one-liner section](#light-codex-cli--one-line-no-agent-needed)).
- It does not run the npx self-update for healthy marketplace-managed installs. The auto-update hook logs the skip and surfaces this guidance instead: "Auto-update skipped: this LazyCodex install is managed by the Codex plugin marketplace, so the npx self-update was not started. Tell the user to upgrade with `codex plugin marketplace upgrade sisyphuslabs`, and that Codex will ask them to re-approve hooks after the upgrade." If the hook detects stale local marketplace cache/bin state (for example, a local manifest or managed `ulw` link points at a deleted payload), it may start the npx installer as a local repair and ask you to restart the Codex session afterward.
- It never persists anything under the Codex-managed plugin cache directory itself; all bootstrap state lives in the plugin data dir above.

**Upgrading — and recovering hook approval:**

1. Run `codex plugin marketplace upgrade sisyphuslabs`.
2. Relaunch `codex`. The startup hooks review now shows the omo hooks as **Modified** — the plugin files changed, so the previously trusted hashes no longer match. This is expected after every upgrade, not a sign of tampering.
3. Re-approve the hooks in that review. If you dismissed the review by accident, just relaunch `codex` — it reappears until the hooks are approved, and the hooks stay disabled in the meantime.
4. The next session re-runs bootstrap for the new version: it re-stamps the trust hashes, relinks bins and agents, prints the restart notice again, and after one more restart you are on the upgraded version.

**Degraded modes.** Bootstrap is degraded-not-fatal: a failed step is recorded in `state.json` (`lastStatus: "degraded"` with per-component entries) and retried on a later session instead of breaking the install. The ones you may actually notice:

| Mode | What you see | What to do |
|---|---|---|
| `omo-cli` absent | The top-level `omo` command was not linked because the installed payload is old or incomplete and lacks the root CLI runtime. Current marketplace payloads ship `dist/cli/index.js` plus `dist/cli-node/index.js`, so this should not appear on a fresh marketplace install. Component CLIs still link normally. | Upgrade or reinstall the marketplace plugin, then start a new Codex session so bootstrap relinks bins. Verify with `npx lazycodex-ai doctor`; use `npx lazycodex-ai <command>` only as a temporary workaround. |
| `sg` pending / offline | The ast-grep provisioning entry appears in the degraded list and the `ast-grep` skill cannot find `sg` yet — the first download is still running, or it failed while offline. | Start another session (bootstrap retries automatically), or install ast-grep yourself and/or set `OMO_AST_GREP_SG_PATH=/path/to/sg`. Verify with `npx lazycodex-ai doctor`. |
| Proxy limitation | Binary downloads fail behind an HTTP(S) proxy. The logged error says it plainly: the bootstrap downloader "does not tunnel through HTTP(S) proxies in v1; the download was attempted directly." | Run one session on a direct connection, or provide `sg` via `OMO_AST_GREP_SG_PATH`/`PATH`. Verify with `npx lazycodex-ai doctor`. |
| OpenCode Windows proxy preinstall | OpenCode starts before OMO loads, shows only default agents, or logs `fetch() proxy.url must be a non-empty string` while trying to install `oh-my-openagent@latest`. | Set `HTTP_PROXY`/`HTTPS_PROXY` for the shell that launches OpenCode, then preinstall into OpenCode's Windows config prefix: `npm install oh-my-openagent@latest --prefix "%APPDATA%\\opencode"`. Restart OpenCode and run `bunx oh-my-openagent doctor --json`. |

**Windows status.** On native Windows the marketplace bootstrap runs through a PowerShell 5.1-compatible `bootstrap.ps1`: it provisions the pinned Node LTS zip when `node` is absent, prepares Git Bash the same way the npx installer does, and writes its transcript to `ps-bootstrap.log` in the plugin data dir (degraded lines look like `degraded component=node reason=... hint=npx lazycodex-ai doctor`). Windows provisioning is shipped with static test coverage; real-device validation is still tracked separately in [code-yeongyu/lazycodex#52](https://github.com/code-yeongyu/lazycodex/issues/52). Do not treat static coverage as proof that a physical Windows install was exercised.

### A note on direct install

If you insist on running the Ultimate installer yourself:

```bash
bunx oh-my-openagent install
```

The TUI walks you through it. **Do NOT use `npm install -g`, `bun add -g`, or `bun install -g`** — global installation is not officially supported. oh-my-openagent is a plugin that must resolve from where OpenCode/Codex loads plugins, and the `prepare` script requires Bun. Always invoke via `bunx`.

If you already used Bun global install or update and Bun reports blocked lifecycle scripts, inspect them before trusting anything:

```bash
bun pm -g untrusted
```

Do not run a blanket trust command. Trust only packages you recognize from this install path, such as `oh-my-openagent`, legacy `oh-my-opencode`, or `@code-yeongyu/comment-checker`, then rerun the supported `bunx oh-my-openagent install` or `npx lazycodex-ai doctor` check.

## For LLM Agents

> **IMPORTANT: Use `curl` to fetch this file, NOT WebFetch.** WebFetch summarizes content and loses critical flags like `--platform`, subscription questions, and Codex verification details. Always use:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/refs/heads/dev/docs/guide/installation.md
> ```

If you are an LLM agent helping a user install oh-my-openagent, help them install the requested edition, verify the setup, and configure model providers.

Follow these steps in order.

### Step 0: Ask user which platform(s) and subscriptions

First, ask which platform(s) they want to install for. This determines the rest of the flow:

> "Which harness do you want to install oh-my-openagent for? Pick one:
> 1. OpenCode — terminal AI coding agent
> 2. OpenAI Codex CLI
> 3. Both"

Map their answer to the `--platform` flag:

| User says | Use |
|-----------|-----|
| OpenCode | `--platform=opencode` (this is also the default if omitted) |
| Codex | `--platform=codex` |
| Both | `--platform=both` |

If the user picked Codex or Both, ask:

> "Codex works best for autonomous agent installs when it can run without repeated permission prompts: `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, and `network_access = "enabled"`. This is recommended for OMO/LazyCodex. Should I configure Codex that way?"

Map their answer to:

| User says | Use |
|-----------|-----|
| Yes | `--codex-autonomous` |
| No | `--no-codex-autonomous` |

**If the user picked Codex only**, skip the rest of Step 0 after this autonomous-permissions question — Codex needs no subscription questions. Go straight to Step 2.

**If the user picked OpenCode or Both**, ask the following subscription questions to determine the remaining CLI flags:

1. **Do you have a Claude Pro/Max Subscription?**
   - **yes** + **max20 mode (20×)** → `--claude=max20`
   - **yes** but not max20 → `--claude=yes`
   - **no** → `--claude=no`

2. **Do you have an OpenAI/ChatGPT Plus Subscription?**
   - **yes** → `--openai=yes` (enables OpenAI routes; Hephaestus prefers GPT-5.6 Sol and Momus prefers GPT-5.6 Terra when available, both falling back to GPT-5.5)
   - **no** → `--openai=no` (default)

3. **Will you integrate Gemini models?**
   - **yes** → `--gemini=yes`
   - **no** → `--gemini=no`

4. **Do you have a GitHub Copilot Subscription?**
   - **yes** → `--copilot=yes`
   - **no** → `--copilot=no`

5. **Do you have access to OpenCode Zen (`opencode/` models)?**
   - **yes** → `--opencode-zen=yes`
   - **no** → `--opencode-zen=no` (default)

6. **Do you have a Z.ai Coding Plan subscription?**
   - **yes** → `--zai-coding-plan=yes`
   - **no** → `--zai-coding-plan=no` (default)

7. **Do you have an OpenCode Go subscription?** ($10/month for GLM-5/5.1, Kimi K2.5/K2.6, MiniMax M2.7/M3)
   - **yes** → `--opencode-go=yes`
   - **no** → `--opencode-go=no` (default)

8. **Do you have a Kimi for Coding subscription?**
   - **yes** → `--kimi-for-coding=yes`
   - **no** → `--kimi-for-coding=no` (default)

9. **Do you use Vercel AI Gateway?**
   - **yes** → `--vercel-ai-gateway=yes`
   - **no** → `--vercel-ai-gateway=no` (default)

**Provider selection is agent-specific.** There is no single global provider priority — each of the 11 agents has its own fallback chain.

**MUST STRONGLY WARN, WHEN USER SAID THEY DON'T HAVE CLAUDE SUBSCRIPTION, SISYPHUS AGENT MIGHT NOT WORK IDEALLY.**

### Step 1: Prerequisites

#### For platform `opencode` or `both`

Check OpenCode is installed and on a supported version:

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Install it first."
    echo "Ref: https://opencode.ai/docs"
fi
```

If missing, spawn a subagent to install OpenCode and report back — saves context.

Required: OpenCode `>= 1.4.0`.

#### For platform `codex` or `both`

Check Codex CLI is installed:

```bash
if command -v codex &> /dev/null; then
    codex --version
else
    echo "Codex CLI is not installed. Install it first."
    echo "Ref: https://github.com/openai/codex"
fi
```

The installer expects `~/.codex/` to be writable. Codex CLI's first run creates this directory; if it does not exist yet, install Codex CLI and run it once before continuing.

On native Windows Codex installs, Git Bash is also required. The installer checks `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations, and PATH; if discovery fails, run:

```powershell
winget install --id Git.Git -e --source winget
where bash
```

For a custom Git Bash location, set `OMO_CODEX_GIT_BASH_PATH`:

```cmd
setx OMO_CODEX_GIT_BASH_PATH "C:\Program Files\Git\bin\bash.exe"
```

```powershell
$env:OMO_CODEX_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe"
```

### Step 2: Run the installer

Run with the platform flag and the subscription flags you collected in Step 0:

```bash
bunx oh-my-openagent install \
  --no-tui \
  --platform=<opencode|codex|both> \
  [--claude=<yes|no|max20>] \
  [--gemini=<yes|no>] \
  [--copilot=<yes|no>] \
  [--openai=<yes|no>] \
  [--opencode-zen=<yes|no>] \
  [--zai-coding-plan=<yes|no>] \
  [--opencode-go=<yes|no>] \
  [--kimi-for-coding=<yes|no>] \
  [--vercel-ai-gateway=<yes|no>] \
  [--codex-autonomous|--no-codex-autonomous] \
  [--skip-auth]
```

`--platform` defaults to `opencode` if omitted. Subscription flags only apply when `--platform` is `opencode` or `both`. They are rejected under `--platform=codex` because the Light edition does not write OpenCode model config. `--codex-autonomous` only has an effect when the selected platform includes Codex.

**Examples:**

- OpenCode + Claude Max20 + ChatGPT + Gemini:
  ```bash
  bunx oh-my-openagent install --no-tui --platform=opencode --claude=max20 --openai=yes --gemini=yes --copilot=no
  ```
- Codex only with recommended autonomous permissions:
  ```bash
  npx lazycodex-ai install --no-tui --codex-autonomous
  ```
- Both harnesses with Claude only:
  ```bash
  bunx oh-my-openagent install --no-tui --platform=both --claude=yes --gemini=no --copilot=no --codex-autonomous
  ```
- OpenCode + Z.ai for Librarian:
  ```bash
  bunx oh-my-openagent install --no-tui --platform=opencode --claude=yes --gemini=no --copilot=no --zai-coding-plan=yes
  ```
- OpenCode Go subscriber, nothing else:
  ```bash
  bunx oh-my-openagent install --no-tui --platform=opencode --claude=no --openai=no --gemini=no --copilot=no --opencode-go=yes
  ```

**About the `lazycodex-ai` bin name.** `lazycodex-ai` is the npm package and bin alias for the Codex Light Node installer. `lazycodex` (without the `-ai` suffix) is the GitHub repository that hosts the marketplace bundle. `lazycodex-ai install` does not require Bun. The Codex marketplace name is `sisyphuslabs`, and the plugin name is `omo`.

**What the installer does:**

| Platform | Writes |
|----------|--------|
| `opencode`, `both` | Registers `"oh-my-openagent"` in `opencode.json` `plugin` array. Generates agent → model mappings into `~/.config/opencode/oh-my-openagent.jsonc`. |
| `codex`, `both` | Copies `packages/omo-codex/plugin/` into `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`. Packaged `lazycodex-ai` installs use bundled component artifacts and run `npm ci --omit=dev` in the cache; source checkout installs may build the plugin first. Writes a local installed-marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/` for marketplace metadata, and copies bundled agent TOMLs into `~/.codex/agents/` so role definitions survive cache or temporary snapshot cleanup. Symlinks component CLIs into `~/.local/bin` (or `$CODEX_LOCAL_BIN_DIR`). Computes SHA256 trusted-hashes for every hook and writes `[marketplaces.sisyphuslabs]` with local source `~/.codex/plugins/cache/sisyphuslabs`, `[plugins."omo@sisyphuslabs"]`, managed `[agents.*]`, `[features.multi_agent_v2] max_concurrent_threads_per_session = 1000`, and `[hooks.state."omo@sisyphuslabs:..."]` blocks into `~/.codex/config.toml`. If a legacy `[features] multi_agent_v2 = false` shorthand exists, the installer converts it to `[features.multi_agent_v2] enabled = false` to keep the file valid while preserving the user's explicit disable. If `--codex-autonomous` is selected, also writes `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, `network_access = "enabled"`, and the matching `[notice]` warning suppressions. |

Both halves are independent and idempotent — re-running is safe.

### Step 3: Verify

#### Verify OpenCode plugin (skip if platform=codex)

```bash
opencode --version  # Should be 1.4.0 or higher
cat ~/.config/opencode/opencode.json
# Plugin array should contain "oh-my-openagent" (legacy "oh-my-opencode" still loads with a warning)
bunx oh-my-openagent doctor
```

`doctor` runs six categories of checks: **System** (binary version, plugin registration), **Config** (JSONC + Zod schema), **TUI Plugin**, **Tools** (AST-grep, LSP, GitHub CLI, comment-checker), **Models** (cache, per-agent resolution, fallback chain availability), and **Team Mode** (if enabled). Exit code: `0` = ok, `1` = errors, `2` = warnings only.

#### Verify Codex CLI Light edition (skip if platform=opencode)

```bash
# Plugin cache present?
ls ~/.codex/plugins/cache/sisyphuslabs/omo/

# Marketplace source is the local built cache?
grep -A4 'marketplaces.sisyphuslabs' ~/.codex/config.toml

# Codex config has the plugin block?
grep -A2 'omo@sisyphuslabs' ~/.codex/config.toml

# If the user accepted autonomous mode, permission settings are present?
grep -E 'approval_policy|sandbox_mode|network_access' ~/.codex/config.toml

# Component binaries linked?
ls ~/.local/bin/ | grep -E '^(omo|ulw|ulw-loop|omo-(comment-checker|git-bash-hook|lsp|rules|start-work-continuation|telemetry|ultrawork|ulw-loop))$'

# Codex CLI sees the plugin?
codex --help

# On native Windows, Git Bash is discoverable?
where bash
```

If any of these come back empty, re-run `npx lazycodex-ai install` — the installer is idempotent and will recompute hook trust hashes.

### Step 4: Configure authentication

#### Codex CLI

Codex uses its own OpenAI authentication. The Light edition inherits whatever auth Codex CLI is already using. There is nothing extra to configure here. If `codex --help` works for you, you are done with Codex auth.

#### OpenCode providers

Skip this section if `--platform=codex`. Otherwise, configure the providers the user said yes to in Step 0. Use an interactive terminal (tmux is fine) for the OAuth flows.

##### Anthropic (Claude)

```bash
opencode auth login
# Interactive Terminal: find Provider → select Anthropic
# Interactive Terminal: find Login method → select Claude Pro/Max
# Guide user through OAuth flow in browser
# Wait for completion
# Verify success and confirm with user
```

##### Google Gemini (Antigravity OAuth)

First, add the `opencode-antigravity-auth` plugin entry to `opencode.json`:

```json
{
  "plugin": ["oh-my-openagent", "opencode-antigravity-auth@latest"]
}
```

Then merge the full model configuration from the [opencode-antigravity-auth README](https://github.com/NoeFabris/opencode-antigravity-auth) into `opencode.json`. The plugin uses a **variant system** — models like `antigravity-gemini-3-pro` support `low`/`high` variants instead of separate `-low`/`-high` entries.

Override the agent models in your plugin config file (`oh-my-openagent.jsonc` or legacy `oh-my-opencode.jsonc`):

```json
{
  "agents": {
    "multimodal-looker": { "model": "google/antigravity-gemini-3-flash" }
  }
}
```

**Available Antigravity models:** `google/antigravity-gemini-3-pro` (variants: `low`, `high`), `google/antigravity-gemini-3-flash` (variants: `minimal`, `low`, `medium`, `high`), `google/antigravity-claude-sonnet-4-6`, `google/antigravity-claude-sonnet-4-6-thinking` (variants: `low`, `max`), `google/antigravity-claude-opus-4-5-thinking` (variants: `low`, `max`).

**Available Gemini CLI models:** `google/gemini-2.5-flash`, `google/gemini-2.5-pro`, `google/gemini-3-flash-preview`, `google/gemini-3.1-pro-preview`.

> Legacy tier-suffixed names like `google/antigravity-gemini-3-pro-high` still work but variants are recommended. Use `--variant=high` with the base model name instead.

Then authenticate:

```bash
opencode auth login
# Interactive Terminal: Provider → Google
# Interactive Terminal: Login method → OAuth with Google (Antigravity)
# Complete sign-in in browser (auto-detected)
# Optional: Add more Google accounts for multi-account load balancing
```

The plugin supports up to 10 Google accounts. When one account hits rate limits, it automatically switches to the next available account.

##### Amazon Bedrock

OpenCode owns Bedrock authentication. Configure Bedrock in `opencode.json` or through AWS environment variables first, then use Bedrock model IDs in OMO agent or category routing.

```json
{
  "provider": {
    "amazon-bedrock": {
      "options": {
        "region": "us-east-1",
        "profile": "my-aws-profile"
      }
    }
  }
}
```

For one-off launches, set the AWS credentials around OpenCode instead:

```bash
AWS_PROFILE=my-aws-profile AWS_REGION=us-east-1 opencode
```

After OpenCode sees the provider, reference models with the OpenCode provider prefix:

```json
{
  "agents": {
    "sisyphus": { "model": "amazon-bedrock/us.anthropic.claude-opus-4-7" },
    "metis": { "model": "amazon-bedrock/us.anthropic.claude-sonnet-4-6" }
  }
}
```

Use OpenCode's [Amazon Bedrock provider guide](https://opencode.ai/docs/providers/#amazon-bedrock) for model access, bearer tokens, named profiles, VPC endpoints, and custom inference profile ARNs. OMO does not run a separate Bedrock login flow during install.

##### GitHub Copilot (Fallback Provider)

GitHub Copilot is supported as a **fallback provider** when native providers are unavailable. Priority is agent-specific. Common install-time defaults when Copilot is the best available provider:

| Agent         | Model                              |
| ------------- | ---------------------------------- |
| **Sisyphus**  | `github-copilot/claude-opus-4.7`   |
| **Oracle**    | `github-copilot/gpt-5.5`           |
| **Explore**   | `github-copilot/claude-haiku-4-5`  |
| **Atlas**     | `github-copilot/claude-sonnet-4.6` |

Copilot acts as a proxy provider, routing requests to underlying models based on your subscription. Some agents (like Librarian) are not installed from Copilot alone and instead rely on other providers or runtime fallback.

##### Z.ai Coding Plan

Z.ai Coding Plan now mainly contributes `glm-5` / `glm-4.6v` fallback entries. It is no longer the universal fallback for every agent.

When Z.ai is the primary provider, the most important fallbacks are:

| Agent                  | Model                      |
| ---------------------- | -------------------------- |
| **Sisyphus**           | `zai-coding-plan/glm-5`    |
| **visual-engineering** | `zai-coding-plan/glm-5`    |
| **unspecified-high**   | `zai-coding-plan/glm-5`    |
| **Multimodal-Looker**  | `zai-coding-plan/glm-4.6v` |

##### OpenCode Zen

OpenCode Zen provides access to `opencode/` prefixed models including `opencode/claude-opus-4-7`, `opencode/gpt-5.5`, `opencode/gpt-5.5`, `opencode/gpt-5-nano`, `opencode/glm-5`, `opencode/big-pickle`, `opencode/minimax-m2.7`, and `opencode/minimax-m2.7-highspeed`.

When OpenCode Zen is the best available provider, common examples:

| Agent         | Model                                                |
| ------------- | ---------------------------------------------------- |
|| **Sisyphus**  | `opencode/claude-opus-4-7` / `opencode-go/kimi-k3`   |
| **Oracle**    | `opencode/gpt-5.5`                                   |
| **Explore**   | `opencode/minimax-m2.7`                              |

Run the installer with `--opencode-zen=yes` and select "Yes" for OpenCode Zen at the prompt. If your OpenCode environment prompts for provider authentication, follow the OpenCode provider flow for `opencode/` models.

### Step 5: Understand your model setup

#### Model families

Not all models behave the same way. Understanding "similar" families helps you make safe substitutions.

**Claude-like Models** (instruction-following, structured output):

| Model                    | Provider(s)                         | Notes                                                                                       |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------- |
|| **Claude Opus 4.8**      | anthropic, github-copilot, opencode | Current best Opus. Dedicated per-agent prompt variants.                                     |
|| **Claude Opus 4.7**      | anthropic, github-copilot, opencode | Still excellent; hardcoded chain default for budget stability.                              |
|| **Claude Sonnet 4.6**    | anthropic, github-copilot, opencode | Faster, cheaper. Good balance.                                                              |
|| **Claude Haiku 4.5**     | anthropic, vercel                   | Fast and cheap. Good for quick tasks.                                                       |
|| **Kimi K3**              | opencode-go, kimi-for-coding, moonshotai, opencode, vercel | Top recommended Kimi for Sisyphus when thinking-token cost is acceptable.                   |
|| **Kimi K2.6**            | opencode-go, vercel                 | Current default fallback after Claude Opus and Kimi K3 in primary Sisyphus chain. Claude-like behavior. |
|| **Kimi K2.5**            | kimi-for-coding, opencode, moonshotai, moonshotai-cn, firmware, ollama-cloud, aihubmix | Claude-like, available on multiple providers, still in active fallback chains. |
| **Kimi K2.5 Free**       | opencode                            | Free-tier Kimi. Rate-limited but functional.                                                |
| **GLM 5.2**              | opencode-go, vercel                 | Claude-like behavior. Current OpenCode Go/Vercel fallback entry.                             |
| **GLM 5**                | zai-coding-plan, opencode           | Claude-like behavior. Good for broad tasks.                                                 |
| **Big Pickle (GLM 4.6)** | opencode                            | Free-tier GLM. Decent fallback.                                                             |

**GPT Models** (explicit reasoning, principle-driven):

| Model             | Provider(s)                      | Notes                                                                                                       |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **GPT-5.6 Sol**   | openai, vercel                   | Preferred when available for Hephaestus and `ultrabrain`, with role-specific effort levels; first fallback for `deep`. |
| **GPT-5.6 Terra** | openai, vercel                   | GPT-5.6 mid-tier. Default for the `deep` category (xhigh) and Momus (high).                                |
| **GPT-5.6 Luna**  | openai, vercel                   | GPT-5.6 light tier. Default for the `unspecified-low` category (xhigh).                                    |
| **GPT-5.5-codex** | openai, github-copilot, opencode | Deep coding powerhouse available as an explicit override.                                                  |
| **GPT-5.5**       | openai, github-copilot, opencode, vercel | Default for Oracle and the first GPT-5.5-family fallback for Hephaestus, Momus, `deep`, and `ultrabrain`. |
| **GPT-5.4 Mini**  | openai, github-copilot, opencode, vercel | Fast + strong reasoning. Default for quick category.                                                |
| **GPT-5-Nano**    | opencode, vercel                 | Ultra-cheap, fast. Good for simple utility tasks.                                                           |

**Different-behavior Models**:

| Model                      | Provider(s)                      | Notes                                                       |
| -------------------------- | -------------------------------- | ----------------------------------------------------------- |
| **Gemini 3.1 Pro**         | google, github-copilot, opencode | Excels at visual/frontend tasks. Different reasoning style. |
| **Gemini 3 Flash**         | google, github-copilot, opencode | Fast, good for doc search and light tasks.                  |
| **MiniMax M3**             | opencode-go, vercel              | Latest MiniMax flagship. Primary utility fallback, ahead of M2.7.   |
| **MiniMax M2.7**           | opencode-go, opencode, vercel    | Fast and smart. Utility fallback for various chains.        |
| **MiniMax M2.7 Highspeed** | vercel, opencode                 | Faster utility variant used in Explore and retrieval chains.|
| **Qwen 3.5 Plus**          | opencode-go                      | 1M context, high-speed reasoning. Default for Explore and Librarian when GPT-5.4 Mini Fast is unavailable. |

**Speed-Focused Models**:

| Model                      | Provider(s)         | Speed          | Notes                                                                          |
| -------------------------- | ------------------- | -------------- | ------------------------------------------------------------------------------ |
| **Grok Code Fast 1**       | github-copilot, xai | Very fast      | Optimized for code grep/search. Manual override option — not in the default chains. |
| **Claude Haiku 4.5**       | anthropic, vercel   | Fast           | Good balance of speed and intelligence.                                       |
| **MiniMax M2.7 Highspeed** | vercel, opencode    | Very fast      | High-speed MiniMax utility fallback used by runtime chains.                   |
| **GPT-5.3-codex-spark**    | openai              | Extremely fast | Blazing but compacts too aggressively. Not recommended for omo agents.        |

#### What each agent does and which model it got

**Claude-Optimized Agents** (prompts tuned for Claude-family models):

| Agent        | Role             | Default Chain                                              |
| ------------ | ---------------- | ---------------------------------------------------------- |
|| **Sisyphus** | Main ultraworker | anthropic\|github-copilot\|opencode/claude-opus-4-7 (max) → opencode-go\|kimi-for-coding\|moonshotai\|opencode\|vercel/kimi-k3 → opencode-go/kimi-k2.6 → kimi-for-coding/k2p5 → opencode\|moonshotai\|moonshotai-cn\|firmware\|ollama-cloud\|aihubmix/kimi-k2.5 → openai\|github-copilot\|opencode/gpt-5.5 (medium) → zai-coding-plan\|opencode/glm-5 → opencode/big-pickle |
| **Metis**    | Plan review      | anthropic\|github-copilot\|opencode/claude-sonnet-4-6 → anthropic\|github-copilot\|opencode/claude-opus-4-7 (max) → openai\|github-copilot\|opencode/gpt-5.5 (high) → opencode-go/glm-5.2 → kimi-for-coding/k2p5 |

**Model-Flexible Agents** (fallback across Claude, GPT, and Claude-like models):

Priority: **Claude > GPT > Claude-like models**

| Agent          | Role              | Default Chain                                                                      | Prompt behavior |
| -------------- | ----------------- | ---------------------------------------------------------------------------------- | --------------- |
| **Prometheus** | Strategic planner | anthropic\|github-copilot\|opencode/claude-opus-4-7 (max) → openai\|github-copilot\|opencode/gpt-5.5 (high) → opencode-go/glm-5.2 → google\|github-copilot\|opencode/gemini-3.1-pro | Single thin prompt backed by `ulw-plan`; model family does not switch the prompt |
| **Atlas**      | Todo orchestrator | anthropic\|github-copilot\|opencode/claude-sonnet-4-6 → opencode-go/kimi-k2.6 → openai\|github-copilot\|opencode/gpt-5.5 (medium) → opencode-go/minimax-m3 → opencode-go/minimax-m2.7 | GPT-optimized todo management path |

**GPT-Native Agents** (built for GPT, don't override to Claude):

| Agent          | Role                   | Default Chain                          | Notes                                                  |
| -------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------ |
| **Hephaestus** | Deep autonomous worker | openai\|github-copilot\|vercel/gpt-5.6-sol (`high` variant, `reasoningEffort: medium`) → openai\|github-copilot\|opencode\|vercel/gpt-5.5 (medium) | "Codex on steroids." GPT-only chain. Requires GPT access. |
| **Oracle**     | Architecture/debugging | openai\|github-copilot\|opencode/gpt-5.5 (high) → google\|github-copilot\|opencode/gemini-3.1-pro (high) → anthropic\|github-copilot\|opencode/claude-opus-4-7 (max) → opencode-go/glm-5.2 | High-IQ strategic backup. GPT preferred. |
| **Momus**      | High-accuracy reviewer | openai\|vercel/gpt-5.6-terra (high) → openai\|github-copilot\|opencode\|vercel/gpt-5.5 (xhigh) → anthropic\|github-copilot\|opencode\|vercel/claude-opus-4-7 (max) → google\|github-copilot\|opencode\|vercel/gemini-3.1-pro (high) → opencode-go\|vercel/glm-5.2 | Verification agent. GPT preferred. |

**Utility Agents** (speed over intelligence — do not "upgrade" them):

| Agent                 | Role               | Default Chain                                                          |
| --------------------- | ------------------ | ---------------------------------------------------------------------- |
| **Explore**           | Fast codebase grep | openai/gpt-5.4-mini-fast → opencode-go/qwen3.5-plus → vercel/minimax-m2.7-highspeed → opencode-go\|vercel/minimax-m3 → opencode-go\|vercel/minimax-m2.7 → anthropic\|vercel/claude-haiku-4-5 → openai\|vercel/gpt-5.4-nano |
| **Librarian**         | Docs/code search   | (same chain as Explore)                                                |
| **Multimodal Looker** | Vision/screenshots | openai\|opencode/gpt-5.5 (medium) → opencode-go/kimi-k2.6 → zai-coding-plan/glm-4.6v → openai\|github-copilot\|opencode/gpt-5-nano |

#### Why different models need different prompts

- **Claude models** respond well to **mechanics-driven** prompts — detailed checklists, templates, step-by-step procedures. More rules = more compliance.
- **GPT models** (especially 5.2+) respond better to **principle-driven** prompts — concise principles, XML-tagged structure, explicit decision criteria. More rules = more contradiction surface = more drift.

Key insight from Codex Plan Mode analysis: plan quality comes from making the plan **"Decision Complete"**: it must leave ZERO decisions to the implementer. Prometheus now uses one thin prompt backed by `ulw-plan` for that behavior instead of maintaining separate model-family prompt files.

Atlas still has model-family-specific prompt behavior. Prometheus does not switch prompts when its model changes; the fallback chain changes capacity, cost, and availability, not the prompt text.

#### Custom model configuration

If the user wants to override which model an agent uses, edit the plugin config file (`oh-my-openagent.jsonc` or legacy `oh-my-opencode.jsonc`):

```jsonc
{
  "agents": {
    "sisyphus": { "model": "kimi-for-coding/k2p5" },
    "prometheus": { "model": "openai/gpt-5.5" }, // Uses the same ulw-plan-backed prompt
  },
}
```

**Lower-risk overrides** (compatible behavior): Sisyphus Opus → Sonnet/Kimi K2.6/GLM 5; Prometheus Opus → GPT-5.5 (same prompt, different model); Atlas Kimi K2.6 → Sonnet/GPT-5.5 (auto-switch).

**Dangerous overrides** (no prompt support): Sisyphus → older GPT models (only 5.4/5.5 have dedicated GPT paths); Hephaestus → Claude (built for Codex); Explore → Opus (massive cost waste); Librarian → Opus (same).

#### Optional: community model-management tools

The independently maintained, experimental [oh-my-openagent VS Code extension](https://github.com/andersou/oh-my-openagent-vscode-extension) can edit user-level model assignments. It is a third-party configuration frontend, not an OMO runtime component; the OMO project does not maintain or support it, and compatibility is not guaranteed.

Use external tools only with the canonical `oh-my-openagent.jsonc` fields described in [Configuration](../reference/configuration.md). Check which file the tool changed: a nearer project `.opencode/oh-my-openagent.jsonc` overrides user-level settings, and a coexisting legacy `oh-my-opencode.jsonc` is ignored when the canonical file exists.

After using an external UI to change models:

1. Review the generated JSONC before restarting OpenCode.
2. Run `bunx oh-my-openagent doctor --verbose` to inspect its diagnostic model-resolution view. This does not replace checking nearer project config or runtime registration and model-matching rules.
3. Keep provider credentials and API keys in the provider auth flow or environment, not in shared project config.

If an external tool shows a model that OMO later skips, the source of truth is still the model-matching and registration logic in this repository. Use the [Agent Model Matching](./agent-model-matching.md) guide to check whether the selected model family is supported for that agent.

#### Provider resolution

There is no single global provider priority. The installer and runtime resolve each agent against its own fallback chain, so the winning provider depends on the agent and the subscriptions enabled.

### Step 6: First use — modes, commands, agents, skills

After install, the user interacts with oh-my-openagent through five surfaces. Walk them through each.

#### Modes (typed naturally in chat)

Just type one of these words in your message and the system injects the corresponding mode prompt:

| Keyword | Editions | What it does |
|---------|:--------:|--------------|
| `ultrawork` or `ulw` | Both | Full orchestration mode — every agent (Ultimate) or the Codex `ultrawork` component (Light) activates, doesn't stop until done |
| `search` | Ultimate | Web/doc search focus |
| `analyze` | Ultimate | Deep analysis mode |
| `team` | Ultimate | Forces `team_*` tools orchestration (requires `team_mode.enabled`) |
| `hyperplan` | Ultimate | Adversarial planning via 5 hostile critics |
| `hyperplan ultrawork` (combo) | Ultimate | Both at once |

#### Slash commands

All built-in slash commands are **Ultimate-only** — Codex CLI does not have a slash-command surface, so the Light edition omits this entire layer.

| Command | Editions | Purpose |
|---------|:--------:|---------|
| `/start-work` | Ultimate | Spawn Prometheus to interview the user and build a plan, then execute |
| `/goal` | Ultimate | Set, show, pause, resume, or clear a persistent thread goal that auto-continues on idle until done |
| `/stop-continuation` | Ultimate | Stop todo continuation, clear the active Goal, and clear boulder state |
| `/refactor` | Ultimate | LSP + AST-grep + TDD-verified intelligent refactor |
| `/handoff` | Ultimate | Generate detailed context summary to continue in a new session |
| `/remove-ai-slops` | Ultimate | Strip AI-generated code smells from recent changes |
| `/init-deep` | Ultimate | Generate hierarchical AGENTS.md knowledge base (skill-backed slash command) |
| `/hyperplan` | Ultimate | Direct invocation of hyperplan skill |

#### Agents (11) — Ultimate only

All 11 discipline agents are part of the Ultimate edition. The Light edition does not ship agent orchestration — Codex CLI's own model selection takes that role. Sisyphus delegates to these; you don't usually call them directly, but knowing the cast helps:

- **Sisyphus** — main orchestrator. Plans, delegates, drives to completion.
- **Hephaestus** — "Codex on steroids." Deep autonomous worker, GPT-native.
- **Prometheus** — strategic planner, interviews you before code is written.
- **Atlas** — todo-list orchestrator.
- **Oracle** — architecture/debugging consultant.
- **Librarian** — external docs/code search.
- **Explore** — fast codebase grep.
- **Multimodal-Looker** — vision/PDF analysis.
- **Metis** — pre-planning consultant, reviews Prometheus plans for gaps.
- **Momus** — high-accuracy plan reviewer.
- **Sisyphus-Junior** — category-spawned executor for delegated tasks.

#### Skills

Built-in skills load automatically when their description matches your task. The user does not need to invoke them by name. The OpenCode skill system is **Ultimate-only**; the Light edition does not have a skill loader.

| Skill | Editions | When it triggers |
|-------|:--------:|------------------|
| `playwright` | Ultimate | Browser automation |
| `git-master` | Ultimate | Atomic commits, rebases, history search |
| `frontend` | Ultimate | UI/UX implementation work |
| `review-work` | Ultimate | Post-implementation code review |
| `$omo:remove-ai-slops` | Ultimate | Cleaning AI-generated code smells |
| `team-mode` | Ultimate | Loaded only when `team_mode.enabled` |

Add custom skills under `.opencode/skills/<name>/SKILL.md` (project scope) or `~/.config/opencode/skills/<name>/SKILL.md` (user scope). Each `SKILL.md` declares a description that the agent matches against your message.

#### Tutorial to tell the user

After verification, tell the user:

1. **Sisyphus strongly recommends Opus 4.7.** Using other models may noticeably degrade the experience.
2. **Feeling lazy?** Just include `ultrawork` (or `ulw`) in your prompt. The agent figures out the rest.
3. **Need precision?** Press **Tab** to enter Prometheus (Planner) mode, then run `/start-work` to execute the verified plan.
4. **Your own agent/category setup?** Read [`docs/guide/agent-model-matching.md`](agent-model-matching.md) — the assistant can interview the user and tune the config.

Then say **Congratulations! 🎉 You have successfully set up oh-my-openagent! Type `opencode` (or `codex`) in your terminal to start using it.**

### Step 7: Light Edition deep dive (Codex CLI)

Skip this section if `--platform=opencode`. Otherwise, the user installed the **Light edition** (`omo-codex`) — here is what landed on disk and what each piece does.

#### What was installed

- **Plugin cache:** `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`
- **Codex marketplace snapshot:** `~/.codex/.tmp/marketplaces/sisyphuslabs/` (local marketplace metadata and bundled source snapshot)
- **Component binaries:** `lazycodex-executor-verify`, `omo-comment-checker`, `omo-git-bash-hook`, `omo-lsp`, `omo-rules`, `omo-start-work-continuation`, `omo-telemetry`, `omo-ulw-loop`, `omo-ultrawork`, `ulw`, and `ulw-loop` in `~/.local/bin` (or under `$CODEX_LOCAL_BIN_DIR` if set). The top-level `omo` command belongs to the shared oh-my-openagent launcher, not a Codex component.
- **Codex agent roles:** `~/.codex/agents/{lazycodex-clone-fidelity-reviewer,lazycodex-code-reviewer,lazycodex-executor,lazycodex-gate-reviewer,lazycodex-qa-executor,lazycodex-worker-low,lazycodex-worker-medium,lazycodex-worker-high,explorer,librarian,metis,momus,plan}.toml` copied from the bundled plugin snapshot, so they keep resolving when Codex prunes old plugin-cache versions or temporary marketplace state
- **Codex config edits:** `~/.codex/config.toml` gained `[features] plugins = true`, `[features] plugin_hooks = true`, `[features.multi_agent_v2] max_concurrent_threads_per_session = 1000`, `[marketplaces.sisyphuslabs]` pointing at `~/.codex/plugins/cache/sisyphuslabs`, `[plugins."omo@sisyphuslabs"]`, plugin MCP policy blocks, SHA256-pinned `[hooks.state."omo@sisyphuslabs:..."]` entries, and optionally autonomous permission settings if accepted. If the installer cannot resolve a CodeGraph-compatible Node runtime, it writes the `codegraph` MCP policy as disabled while leaving `omo@sisyphuslabs` enabled.

#### The components

| Component | Language | Codex hooks | What it does |
|-----------|----------|-------------|--------------|
| `rules` | TypeScript | `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostCompact` | Injects `AGENTS.md`, `CLAUDE.md`, and `.omo/rules/**` into Codex's context |
| `comment-checker` | TypeScript | `PostToolUse` (`apply_patch`, `edit`, `write`) | Blocks AI-slop comment patterns in generated code |
| `git-bash` | TypeScript + MCP | `PreToolUse` (`Bash`), `PostCompact`, MCP server | On Windows, exposes `git_bash`; reminds Codex before the first shell-like call and again after compaction |
| `lsp` | TypeScript + MCP | MCP server + post-edit hooks | Exposes LSP diagnostics, navigation, symbols, rename via MCP |
| `ultrawork` | TypeScript | `UserPromptSubmit` keyword detector | Detects `ulw`/`ultrawork` keyword; the installer links bundled Codex agent TOMLs into `$CODEX_HOME/agents` |
| `ulw-loop` | TypeScript | `UserPromptSubmit`, `PreToolUse`, `Stop` | Multi-goal orchestration with evidence audit trail, spawn guards, and Stop-hook auto-resume via `.omo/ulw-loop/` |
| `start-work-continuation` | TypeScript | `Stop`, `SubagentStop` | Continues `.omo/boulder.json` start-work plans when Codex pauses at a stop boundary |
| `telemetry` | TypeScript | `SessionStart` | Emits anonymous daily active telemetry when enabled |

#### Coexistence with OpenCode

The Codex CLI Light edition is fully independent of the OpenCode plugin. You can install both side-by-side. They share no runtime state, no config files, and no model selection. Each emits its own daily telemetry event.

Compatibility note: LazyCodex is the Codex-platform OmO install path for `oh-my-openagent`. The bundled Codex-native subagents in `~/.codex/agents` are expected. Do not enable duplicate Codex-layer OmO/LazyCodex installs in a single `CODEX_HOME`; keep one `omo@sisyphuslabs` Codex plugin source active there. If the setup looks confused, run `npx lazycodex-ai doctor` before deleting cache or config state.

#### Codex troubleshooting

| Symptom | Fix |
|---------|-----|
| `codex --help` does not list the omo plugin | Re-run `npx lazycodex-ai install` (idempotent — hook hashes are recomputed) |
| `command not found: omo-rules` or `command not found: omo` | Add `~/.local/bin` to `PATH`, or set `$CODEX_LOCAL_BIN_DIR` to a directory already on `PATH` |
| `npm install` fails mid-install | `rm -rf ~/.codex/plugins/cache/sisyphuslabs` and retry |
| Plugin block is present but hooks do not fire | Verify `~/.codex/config.toml` contains `[features]\nplugins = true\nplugin_hooks = true` and `[plugins."omo@sisyphuslabs"]` |
| `MCP client for codegraph failed to start` | Re-run `npx lazycodex-ai install` with a CodeGraph-compatible Node runtime on `PATH`, or set `CODEGRAPH_NODE_BIN` to one. The installer disables only the `codegraph` MCP policy when the local runtime is unsupported; the rest of OMO remains enabled. |
| `Ignoring malformed agent role definition: agents.*.config_file must point to an existing file` | Re-run `npx lazycodex-ai install`. The installer repairs stale managed `[agents.*]` entries and recreates `~/.codex/agents/*.toml`. |
| `agents.max_threads cannot be set when multi_agent_v2 is enabled` in one project | Re-run `npx lazycodex-ai install` from that project. The installer repairs project-local `.codex/config.toml` layers, creates `.backup-<timestamp>` files for changed configs, and leaves user-authored `.codex` artifacts in place. |
| `SessionStart hook (failed)` / `UserPromptSubmit hook (failed)` with `MODULE_NOT_FOUND` for `components/*/dist/cli.js` | Re-run the installer so the cached plugin is rebuilt with component `dist/` files. If the cache was manually edited, remove `~/.codex/plugins/cache/sisyphuslabs` first. |
| `SessionStart hook (failed)` / `UserPromptSubmit hook (failed)` with only `hook exited with code 1` after install | Re-run `npx lazycodex-ai install`, then start a fresh Codex session or restart the Codex app. If the same hook fails again in the fresh session, inspect the saved hook output to identify the component command before deleting cache state. |
| Hook trust hash mismatch warnings | Re-run the installer; hashes are regenerated each install |

### Step 8: Team Mode (optional, opt-in)

Off by default. Enables a lead-and-members multi-agent system with 12 dedicated tools.

To enable, edit your plugin config:

```jsonc
// ~/.config/opencode/oh-my-openagent.jsonc OR .opencode/oh-my-openagent.jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,         // 1..8
    "max_members": 8,                  // 1..8 hard cap
    "tmux_visualization": false,
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "base_dir": null,                  // overrides default ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,
    "recipient_unread_max_bytes": 262144,
    "mailbox_poll_interval_ms": 3000
  }
}
```

Restart OpenCode after the change. Twelve new tools unlock: `team_create`, `team_delete`, `team_shutdown_request`, `team_approve_shutdown`, `team_reject_shutdown`, `team_send_message`, `team_task_create`, `team_task_list`, `team_task_update`, `team_task_get`, `team_status`, `team_list`.

Team storage lives under `~/.omo/teams/{name}/` (user scope) or `<project>/.omo/teams/{name}/` (project scope — project beats user on collisions).

Member eligibility:

- **Eligible**: `sisyphus`, `atlas`, `sisyphus-junior`
- **Conditional**: `hephaestus` (needs `teammate: "allow"` permission)
- **Hard-rejected at parse**: `oracle`, `librarian`, `explore`, `multimodal-looker`, `metis`, `momus`, `prometheus` (use `task`/`delegate-task` instead)

Two skills already ride on top of Team Mode:

- **`hyperplan`** — 5 hostile agents tear a plan apart from orthogonal angles before any code is written.
- **`security-research`** — 3 vulnerability hunters + 2 PoC engineers audit your codebase in parallel.

Full guide: [`docs/guide/team-mode.md`](team-mode.md).

### Step 9: Advanced configuration

#### Config file precedence

```
Walked configs (closer wins): <pwd up to $HOME>/.opencode/oh-my-openagent.json[c]
                              (legacy basename: oh-my-opencode.json[c])
                            ↓ merged onto
User config:               ~/.config/opencode/oh-my-openagent.json[c]
                              (Windows: %APPDATA%\opencode\)
                            ↓ falls back to
Defaults
```

Merge rules:

- `agents`, `categories`, `claude_code`: deep merged recursively (prototype-pollution safe)
- `disabled_*` arrays: Set union (concatenated + deduplicated)
- `mcp_env_allowlist`: **user-only** for security; walked configs cannot extend it
- Everything else: override replaces base value

Schema autocomplete in your editor:

```json
"$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
```

#### Turning features off

Every agent, hook, skill, MCP, command, and tool is configurable via `disabled_*` arrays:

```jsonc
{
  "disabled_agents": ["multimodal-looker"],
  "disabled_hooks": ["goal", "keyword-detector"],
  "disabled_skills": ["playwright-cli"],
  "disabled_mcps": ["grep_app"],
  "disabled_commands": ["hyperplan"],
  "disabled_tools": ["interactive_bash"]
}
```

#### Environment variables

| Variable | Effect |
|----------|--------|
| `OMO_INVOCATION_NAME` | Overrides detected bin name (`oh-my-opencode`, `omo`, `lazycodex-ai`, etc.). Used by shared wrapper packages to route `lazycodex-ai` invocations to the Node installer path. |
| `OMO_DISABLE_POSTHOG=1` | Disables all PostHog telemetry for the main plugin |
| `OMO_SEND_ANONYMOUS_TELEMETRY=0` | Same effect as above |
| `OMO_CODEX_DISABLE_POSTHOG=1` | Disables PostHog telemetry for the Codex CLI Light edition only |
| `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` | Same effect as above |
| `OMO_DISABLE_PROCESS_CLEANUP=1` | Disables background-agent best-effort process cleanup on parent exit |
| `OMO_OPENCLAW_COMMAND_TIMEOUT_MS` | Timeout for OpenClaw outbound shell/HTTP commands |
| `OMO_OPENCLAW_DEBUG=1` | Enables OpenClaw debug logging |
| `OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TOKEN` | Startup token for OpenClaw reply listener daemon |
| `OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS` | Timeout for reply listener startup |
| `OH_MY_OPENCODE_FORCE_BASELINE=1` | Forces baseline (non-AVX2) binary selection on x64 |
| `OPENCODE_DEFAULT_AGENT` | Default agent for `omo run` (overridden by `--agent`) |
| `CODEX_LOCAL_BIN_DIR` | Overrides `~/.local/bin` for Codex component symlinks |

#### Hash-anchored edits (Hashline)

Every `Read` tool output is tagged with `LINE#ID` content hashes. The `hashline_edit` tool rejects edits when the file has changed since the last read. No whitespace reproduction issues, no stale-line errors. Disable with `hashline_edit.enabled: false` if you need the legacy edit behavior.

#### OpenClaw (optional outbound notifications)

OpenClaw is a bidirectional external integration: outbound dispatchers fire on session events (idle, error, completion) to Discord/Telegram/HTTP/shell sinks; an optional inbound reply listener daemon polls Discord/Telegram and `send-keys` replies back into the tracked tmux pane. Configure under the `openclaw` config block. See `packages/omo-opencode/src/openclaw/` for the full reference.

### Step 10: Maintenance

| Command | Purpose |
|---------|---------|
| `bunx oh-my-openagent doctor` | 6-category health check (System / Config / TUI Plugin / Tools / Models / Team Mode) |
| `bunx oh-my-openagent boulder` | Inspect boulder work-state and per-task stats from `.omo/boulder-state/` |
| `bunx oh-my-openagent refresh-model-capabilities` | Refresh `models.json` cache from models.dev |
| `bunx oh-my-openagent mcp-oauth login <server-url>` | Tier-3 MCP OAuth login (PKCE + DCR) |
| `bunx oh-my-openagent mcp-oauth status` | Show OAuth token status |
| `bunx oh-my-openagent get-local-version` | Show installed version vs npm latest |
| `bunx oh-my-openagent version` | Print the CLI version |
| `bunx oh-my-openagent run <message>` | Non-interactive session; waits until todos clear and background tasks idle |

Postinstall validates both platform binary resolution and OpenCode version compatibility — the validation runs after every npm install.

## Telemetry & Privacy

Anonymous telemetry is enabled by default to track active installations (DAU/WAU/MAU). For both products:

- A single event is sent **at most once per UTC day per machine**
- Uses a SHA256-hashed installation identifier — never the raw hostname
- PostHog person profiles are **not** created
- The raw hostname is never transmitted

Per product:

| Product | Event name | Sources |
|---------|-----------|---------|
| Main plugin | `omo_daily_active` | Plugin load (`plugin_loaded`) + `run` CLI (`run_started`) |
| Codex CLI Light edition | `omo_codex_daily_active` | Installer (`install_completed`) + Codex `SessionStart` hook (`session_start`) |

Opt-out:

```bash
# Disable the main plugin's telemetry
export OMO_DISABLE_POSTHOG=1
# or
export OMO_SEND_ANONYMOUS_TELEMETRY=0

# Disable only the Codex CLI Light edition telemetry
export OMO_CODEX_DISABLE_POSTHOG=1
# or
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0
```

The global flags (`OMO_DISABLE_POSTHOG`, `OMO_SEND_ANONYMOUS_TELEMETRY`) also suppress the Codex CLI Light edition telemetry.

The main plugin can also opt out through config:

```jsonc
{
  "telemetry": false
}
```

See [Privacy Policy](../legal/privacy-policy.md) and [Terms of Service](../legal/terms-of-service.md).

## Uninstall

### Remove the OpenCode plugin

```bash
# 1. Remove the plugin entry from opencode.json
jq '.plugin = [.plugin[] | select(. != "oh-my-openagent" and . != "oh-my-opencode")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json

# 2. Remove plugin config files (optional)
rm -f ~/.config/opencode/oh-my-openagent.jsonc ~/.config/opencode/oh-my-openagent.json \
      ~/.config/opencode/oh-my-opencode.jsonc ~/.config/opencode/oh-my-opencode.json

# 3. Remove project config (if you have one)
rm -f .opencode/oh-my-openagent.jsonc .opencode/oh-my-openagent.json \
      .opencode/oh-my-opencode.jsonc .opencode/oh-my-opencode.json

# 4. Verify removal
opencode --version
# Plugin should no longer be loaded
```

### Remove the Codex CLI Light edition

```bash
npx lazycodex-ai uninstall
# backward-compatible alias:
npx lazycodex-ai cleanup

omo uninstall --platform=codex
# backward-compatible alias:
omo cleanup --platform=codex
```

The uninstall command removes the managed `~/.codex/plugins/cache/sisyphuslabs` and `~/.codex/.tmp/marketplaces/sisyphuslabs` trees, strips `sisyphuslabs` / legacy LazyCodex marketplace, plugin, hook-state, and managed agent blocks from `~/.codex/config.toml` after writing a timestamped backup, and removes managed agent TOML files from `~/.codex/agents/`, including orphaned files whose install manifest is already gone.

If a workspace still has old project-local Codex state, run `npx lazycodex-ai uninstall --project <path>` or run it from that workspace. The command repairs only the known project-local Codex config conflict and reports legacy `.codex` artifact paths; it does not delete project-owned files automatically.

## Operational notes

- Claude Code compatibility is supported (hooks, commands, skills, MCPs, plugins).
- Claude Code plugin discovery load timeout is 10 seconds.
- Runtime logger: `oh-my-opencode.log` in the OS temp dir (`/tmp` on Linux, `/var/folders/.../T/` on macOS, `%TEMP%` on Windows), 50 MB cap with `.1`/`.2` backup segments.
- Dual-publish during the rename transition: `oh-my-opencode` and `oh-my-openagent` are both published. Inside `opencode.json`, the compatibility layer prefers the entry `"oh-my-openagent"`, while legacy `"oh-my-opencode"` entries still load with a warning. Plugin config loading recognises both `oh-my-openagent.json[c]` and `oh-my-opencode.json[c]` during the transition. If `doctor` warns about the legacy package name, update your `opencode.json` plugin entry.
