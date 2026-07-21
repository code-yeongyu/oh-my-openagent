# @oh-my-opencode/omo-codex

Codex harness adapter for **oh-my-openagent**. Brings the OMO experience (rules injection, comment checker, plugin-scoped MCPs, ultrawork, ulw-loop, start-work continuation, telemetry) into [OpenAI Codex CLI](https://github.com/openai/codex) through Codex's native plugin system.

## Layout

| Path | Purpose |
|------|---------|
| `plugin/` | Vendored Codex plugin namespace `omo` with isolated components. Shipped to the user via `~/.codex/plugins/cache/`. |
| `marketplace.json` | Codex marketplace manifest. Identifies `omo` as the single installable plugin. |
| `scripts/` | Node ESM build scripts for Codex cache installation and marketplace config updates. |
| `src/` | TypeScript runtime: installer + telemetry consumed by the omodex CLI. |
| `MARKETPLACE.md` | Native Codex marketplace notes for `sisyphuslabs` / `omo`. |

## Components Vendored

- `rules` (TypeScript) - injects `CONTEXT.md` / `.omo/rules/**` and other explicit rule sources into context via `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostCompact`; `AGENTS.md` is left to Codex native handling.
- `comment-checker` (TypeScript) - runs `@code-yeongyu/comment-checker` after `apply_patch` / `edit` / `write` tool use.
- `lsp` (TypeScript + LSP MCP) - exposes LSP diagnostics, navigation, symbols, rename via MCP + post-edit hooks.
- `git-bash` (TypeScript + Git Bash MCP) - exposes the Windows-only `git_bash` MCP and reminds Codex on the first shell-like call, including the first one after compaction.
- `ultrawork` (TypeScript) - keyword detector (`ulw` / `ultrawork`) that injects the full ultrawork directive; bundled agent TOML files are installed into `CODEX_HOME/agents`.
- `ulw-loop` (TypeScript) - durable multi-goal orchestration backed by `.omo/ulw-loop/` evidence audit; `PreToolUse` spawn guards (fan-out cap + gate-artifact preflight) and a `Stop` auto-resume hook.
- `start-work-continuation` (TypeScript) - `Stop` / `SubagentStop` continuation hook for `.omo/boulder.json` start-work plans.
- `telemetry` (TypeScript) - anonymous daily active telemetry hook.

## Install

End users invoke through the omodex CLI. This package is the **Light edition** of omo — install it directly with:

```bash
npx lazycodex-ai install
# non-interactive recommended mode:
npx lazycodex-ai install --no-tui --codex-autonomous
```

To install **both** the Ultimate edition (OpenCode plugin) and the Light edition (this package) at once, use `--platform=both`.

The installer copies the built plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`, writes the local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`, copies bundled agent TOMLs into `~/.codex/agents/`, enables `omo@sisyphuslabs` in `~/.codex/config.toml`, writes the valid `[features.multi_agent_v2]` limit table without enabling MultiAgentV2, and registers the `sisyphuslabs` marketplace from the local built cache. If an older config used `[features] multi_agent_v2 = false`, the installer preserves that explicit disable as table-form `enabled = false`. `lazycodex-ai` is the npm/bin alias and `lazycodex` is the marketplace repository; the marketplace identity remains `sisyphuslabs`.

To remove managed Codex Light state, run `npx lazycodex-ai uninstall`. The backward-compatible alias is `npx lazycodex-ai cleanup`. Uninstall removes managed `sisyphuslabs` cache/marketplace directories, strips OMO marketplace/plugin/hook-state config blocks with a backup, removes managed agent TOML files from `~/.codex/agents/`, and repairs the known project-local legacy `.codex/config.toml` conflict while leaving project-owned `.codex` files in place.

### Local dev install (dogfood the source build)

To run **this repo's local build** on your real `~/.codex` instead of the published package, stamped so you can see at a glance you're on a dev build:

```bash
bun run install:codex-dev            # uninstalls current, installs repo HEAD as version "dev"
bun run script/install-codex-dev.ts --version=dev-$(git rev-parse --short HEAD)  # custom stamp
bun run script/install-codex-dev.ts --no-uninstall   # skip the uninstall step
```

This sets `LAZYCODEX_DEV_VERSION` (default `dev`), which threads through `resolveLazyCodexPluginVersion` so the plugin version stamp becomes that value everywhere it appears: the cache dir (`~/.codex/plugins/cache/sisyphuslabs/omo/dev/`), `.codex-plugin/plugin.json`, the stamped `package.json`, and — most visibly — the hook status prefix Codex prints every turn (`(OmO dev) ...`). `omo get-local-version` renders a `[DEV]` badge and skips the npm update check for any non-semver stamp. A plain `LAZYCODEX_DEV_VERSION`-less `lazycodex install` is unchanged. This writes to your REAL `~/.codex`; for isolated QA use the throwaway-`CODEX_HOME` flow instead.


The Codex plugin bundle includes Context7 as a default MCP in its `.mcp.json`, using the hosted `https://mcp.context7.com/mcp` endpoint. The installer enables the `omo@sisyphuslabs` plugin MCP policy for Context7 while leaving any existing user-level `[mcp_servers.context7]` block untouched.
The same plugin-scoped MCP manifest also bundles `grep_app`, `git_bash`, `lsp`, and `codegraph`. The ast-grep capability ships as the `ast-grep` skill and provisions `sg` into the Codex runtime. `git_bash` is enabled only on Windows by default. `codegraph` is enabled only when the installer can resolve a supported local Node runtime for CodeGraph; unsupported runtimes disable that MCP policy while keeping `omo@sisyphuslabs` enabled.

### CodeGraph exclusions

CodeGraph is skipped for project roots under default ephemeral/state locations: POSIX `/tmp`, POSIX `/private/tmp`, the current OS temp directory on every platform, and any path containing a `.omo` segment. Skipped projects do not run the `SessionStart` bootstrap worker and the MCP exposes an unavailable stub instead of starting CodeGraph.

Add extra exclude-only roots with `codegraph.excluded_roots`:

```jsonc
{
  "codegraph": {
    "excluded_roots": ["~/scratch/codegraph", "relative-cache-root"]
  }
}
```

Entries may be absolute, `~`-relative, or relative to the configured home directory. OMO expands `~`, realpath-canonicalizes each configured root when possible, and compares descendants after platform-aware normalization. There is no include override.

CodeGraph runs with `CODEGRAPH_NO_DOWNLOAD=1`, `CODEGRAPH_TELEMETRY=0`, and `DO_NOT_TRACK=1` in the managed child environment, plus `CODEGRAPH_NO_DAEMON=1` unless the shared daemon is opted in (see below). OMO stores per-project CodeGraph data under the managed CodeGraph home and prunes dead project stores when their recorded source directory no longer exists.

### CodeGraph daemon (opt-in)

By default every CodeGraph MCP process runs the index in-process and exits with its client. Set `codegraph.daemon` to `true` in the OMO config (`~/.omo/config.jsonc`, or `.omo/config.jsonc` in a project) to opt into the upstream shared daemon:

```jsonc
{
  "codegraph": {
    // Default false. When true, one detached daemon per project serves every
    // CodeGraph client instead of each client loading the index in-process.
    "daemon": true
  }
}
```

With the daemon enabled, upstream CodeGraph spawns one detached daemon per project, rooted at the nearest ancestor holding `.codegraph/codegraph.db`, and every client for that project talks to it over a local socket. The daemon records itself in `.codegraph/daemon.pid`, exits after about five minutes idle, and runs under an upstream PPID watchdog. Opting in trades a detached background process for lower first-query latency once any client has warmed the daemon, plus one shared index across concurrent clients. It ships off by default so no process outlives the client that started it.

Inspect or stop running daemons with the upstream manager:

```bash
codegraph daemon   # interactive list of running daemons; pick one and press enter to stop it
```

An ambient `CODEGRAPH_NO_DAEMON=1` in the environment still forces daemon-off when `codegraph.daemon` is `true`.

### Process hygiene and the CodeGraph 1.4.1 upgrade

CodeGraph is pinned to 1.4.1. Project stores built by older versions migrate automatically on first use; no manual re-index is needed.

Process lifecycle is self-cleaning and always on (no config keys):

- MCP server processes (`codegraph`, `lsp`, `git_bash`) run a parent-liveness watchdog and exit when their parent process dies, so a crashed harness does not leave servers behind.
- A newly started lsp daemon reaps running daemons left over from older versions at startup.
- A best-effort family sweep removes orphaned codegraph and lsp processes at startup on every adapter (the Codex `SessionStart` hook, OpenCode plugin startup, and Senpi session start) and self-throttles via stamp files.

Native Windows installs discover Git Bash before the installer mutates `~/.codex/`. The installer checks `OMO_CODEX_GIT_BASH_PATH`, standard Git for Windows locations such as `C:\Program Files\Git\bin\bash.exe`, and then PATH. If Git Bash is still missing, it prints the install guidance shown here and stops without running `winget` or changing system dependencies:

```powershell
winget install --id Git.Git -e --source winget
where bash
```

For a custom Git Bash location:

```cmd
setx OMO_CODEX_GIT_BASH_PATH "C:\Program Files\Git\bin\bash.exe"
```

```powershell
$env:OMO_CODEX_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe"
```

The installer does not write a global Codex shell config. On Windows it enables the plugin MCP policy for `git_bash`; on non-Windows it keeps the manifest bundled but writes `enabled = false` for that MCP server. The Git Bash hook injects fixed guidance before the first Codex shell-like `Bash` hook call in a session, and again before the first shell-like call after `PostCompact`, recommending `git_bash` before built-in `exec_command`.

To install both editions in one command, use `--platform=both`.

## Telemetry

Anonymous telemetry uses the same PostHog project as oh-my-openagent but emits the distinct event `omo_codex_daily_active`. The event is sent at most once per UTC day per machine from two sources:

| Source | Reason | Trigger |
|--------|--------|---------|
| `install` | `install_completed` | `npx lazycodex-ai install` or `--platform=both` finishes (handled by `src/cli/install-codex/install-codex.ts`) |
| `plugin` | `session_start` | Codex plugin `SessionStart` hook fires (handled by `plugin/components/telemetry/`) |

Both sources share the same SHA256-hashed installation identifier (`sha256("omo-codex:" + hostname)`), suppress PostHog person profiles, and write the daily dedup state to `~/.local/share/omo-codex/posthog-activity.json`.

The captured properties are limited to product/runtime metadata, operating-system metadata, coarse machine shape (`cpu_count`, `cpu_model`, `total_memory_gb`), locale/timezone, shell/terminal hints, `source`, `reason`, and `day_utc`. Telemetry does not send prompt contents, chat transcripts, source files, repository contents, file paths, access tokens, API keys, raw hostnames, Git remotes, usernames, email addresses, or runtime error diagnostics.

Opt out with:

```bash
# Codex-only
export OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0

# Globally (also disables oh-my-openagent telemetry)
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0
```

The identity constants and opt-out behavior are pinned across both sources by `src/telemetry/cross-package-equivalence.test.ts`.

See [Codex Light telemetry](../../docs/reference/codex-telemetry.md) and the [Privacy Policy](../../docs/legal/privacy-policy.md) for the full disclosure.

## Component Sources

The bundled component implementations come from the Sisyphus Labs Codex plugin family:

- [code-yeongyu/codex-rules](https://github.com/code-yeongyu/codex-rules)
- [code-yeongyu/codex-comment-checker](https://github.com/code-yeongyu/codex-comment-checker)
- [code-yeongyu/codex-lsp](https://github.com/code-yeongyu/codex-lsp)
- [code-yeongyu/codex-ultrawork](https://github.com/code-yeongyu/codex-ultrawork)
- [code-yeongyu/codex-ulw-loop](https://github.com/code-yeongyu/codex-ulw-loop)
- [code-yeongyu/codex-start-work-continuation](https://github.com/code-yeongyu/codex-start-work-continuation)
