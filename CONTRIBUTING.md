# Contributing to Oh My OpenCode

First off, thanks for taking the time to contribute! This document provides guidelines and instructions for contributing to oh-my-opencode.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Language Policy](#language-policy)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Development Setup](#development-setup)
  - [Testing Your Changes Locally](#testing-your-changes-locally)
- [Development Environment](#development-environment)
- [Credentials & Isolation](#credentials--isolation)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
  - [Build Commands](#build-commands)
  - [Code Style & Conventions](#code-style--conventions)
- [Making Changes](#making-changes)
  - [Adding a New Agent](#adding-a-new-agent)
  - [Adding a New Hook](#adding-a-new-hook)
  - [Adding a New Tool](#adding-a-new-tool)
  - [Adding a New MCP Server](#adding-a-new-mcp-server)
- [QA Discipline](#qa-discipline)
- [Pull Request Process](#pull-request-process)
  - [PR Checklist](#pr-checklist)
- [Publishing](#publishing)
- [Getting Help](#getting-help)

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to make better tools together.

## Language Policy

**English is the primary language for all communications in this repository.**

This includes:

- Issues and bug reports
- Pull requests and code reviews
- Documentation and comments
- Discussions and community interactions

### Why English?

- **Global Accessibility**: English allows contributors from all regions to collaborate effectively
- **Consistency**: A single language keeps discussions organized and searchable
- **Open Source Best Practice**: Most successful open-source projects use English as the lingua franca

### Need Help with English?

If English isn't your first language, don't worry! We value your contributions regardless of perfect grammar. You can:

- Use translation tools to help compose messages
- Ask for help from other community members
- Focus on clear, simple communication rather than perfect prose

## Getting Started

### Prerequisites

- **Bun** 1.3.12 (CI-pinned) - The only package manager for the workspace itself
- **Node** 24 - Required for vendored packages (lsp-tools-mcp, lsp-daemon, git-bash-mcp) and the Codex plugin build via npm
- **git** - Version control
- **tmux** (optional) - Enables the `interactive_bash` tool and Team Mode visualization

### Development Setup

```bash
# Clone the repository (with the frontend provenance submodules)
git clone --recurse-submodules https://github.com/code-yeongyu/oh-my-openagent.git
cd oh-my-openagent

# If you cloned without --recurse-submodules, initialize them now (non-fatal offline):
git submodule update --init --recursive

# Install dependencies (bun only - never use npm/yarn)
bun install

# Build the project (materializes the frontend third-party references from the submodules)
bun run build
```

> The frontend skill's brand / taste / ui-ux references are third-party content kept ONLY as pinned git submodules under `packages/shared-skills/upstreams/`. The repo contains zero committed copies; the build materializes them into `packages/shared-skills/skills/frontend/references/` (gitignored locally, shipped in the published package). `script/agent/setup.sh` runs the submodule init + materialize for you (both non-fatal, so an offline checkout still builds, just without the brand refs).

### Testing Your Changes Locally

After making changes, you can test your local build in OpenCode:

1. **Build the project**:

   ```bash
   bun run build
   ```

2. **Update your OpenCode config** (`~/.config/opencode/opencode.json` or `opencode.jsonc`):

   Built dist (after `bun run build`):

   ```json
   {
     "plugin": ["file:///absolute/path/to/oh-my-openagent/dist/index.js"]
   }
   ```

   Source mode (no build needed):

   ```json
   {
     "plugin": ["file:///absolute/path/to/oh-my-openagent/packages/omo-opencode/src/index.ts"]
   }
   ```

   The path must be **absolute** and contain a recognizable project name plus `(src|dist)/index.(ts|js)`. A relative `file://./...` path will not be detected by the installer.

   > **Note**: Remove `"oh-my-openagent"` or `"oh-my-opencode"` from the plugin array if they exist, to avoid conflicts with the npm version.

3. **Restart OpenCode** to load the changes.

4. **Verify** the plugin is loaded by checking for OmO agent availability or startup messages.

## Development Environment

The cross-harness one-command bootstrap is the single source of truth for all development environments.

- **`script/agent/setup.sh`** verifies Bun, Node, and git, warns if tmux is missing, runs `bun install`, initializes the frontend provenance submodules and materializes their references (both non-fatal so an offline checkout still builds), and builds when `dist/index.js` is missing or `OMO_AGENT_FORCE_BUILD=1` is set.
- **`script/agent/cleanup.sh`** removes regenerable transients by default. Pass `--deep` to also drop `dist/` and `node_modules/`; it leaves the `packages/shared-skills/upstreams/` submodules in place.
- **`script/agent/cleanup-hook.sh`** launches cleanup from Claude Code `SessionEnd` without blocking shutdown.

All harnesses delegate to these scripts:

| Harness | Wiring |
| ------- | ------ |
| GitHub Codespaces / VS Code Dev Containers | `.devcontainer/devcontainer.json` runs `postCreateCommand: script/agent/setup.sh` on `.devcontainer/Dockerfile` (Node 24 + Bun 1.3.12 + tmux) |
| Plain Docker | `script/agent/docker-dev.sh` builds the Dockerfile and opens a shell |
| Cursor cloud agents | `.cursor/environment.json` `install` runs setup on environment creation |
| Claude Code | `.claude/settings.json` `SessionStart` hook runs setup; `SessionEnd` hook launches cleanup |
| Codex App (local environments) | `.codex/setup.sh` runs at project root on worktree creation |
| OpenCode (this plugin's own harness) | reads `AGENTS.md` + `CLAUDE.md` (a symlink); run `script/agent/setup.sh` directly |

The single source of truth is the `script/agent/` dev-environment contract: `setup.sh`, `cleanup.sh`, and harness launchers such as `cleanup-hook.sh`. Maintenance means keeping those scripts, harness wiring files, and pinned Dockerfile versions in sync.

## Credentials & Isolation

`.env.example` is the committed injection point. Copy it to `.env` (gitignored) once and fill in your keys:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `OPENCODE_SERVER_PASSWORD` (optional)

Both `setup.sh` and `qa-sandbox.sh` auto-source `.env`, so credentials are set once per machine and never prompted again.

For QA isolation, run:

```bash
source script/agent/qa-sandbox.sh
```

This exports an isolated, throwaway environment with its own `XDG_*` directories and a fresh `CODEX_HOME` under a `mktemp` directory. It also sets `OPENCODE_DISABLE_AUTOUPDATE=1` and `OPENCODE_DISABLE_MODELS_FETCH=1`. QA never reads or writes the host's real `~/.config/opencode` or `~/.codex`. This mirrors the conventions used by the `opencode-qa` and `codex-qa` skills.

For containerized environments (Codespaces, Dev Containers, Docker), see [`.devcontainer/README.md`](.devcontainer/README.md). It documents injecting provider credentials (via `.env`, Codespaces secrets, or `remoteEnv`) and bind-mounting your `~/.codex`, `~/.claude`, and `~/.config/opencode` config into the container so OpenCode, Codex, and Claude Code all work inside it.

## Project Structure

The repository is a monorepo with layered packages under `packages/`.

```
oh-my-opencode/
├── packages/
│   ├── omo-opencode/          # OpenCode Ultimate edition adapter and build entry
│   │   └── src/
│   │       ├── index.ts         # Thin wrapper default-exporting PluginModule via createPluginModule()
│   │       ├── plugin-config.ts # JSONC multi-level config (Zod v4)
│   │       ├── agents/          # agent factories (Sisyphus, Hephaestus, Oracle, ...)
│   │       ├── hooks/           # lifecycle hooks, 5-tier composition (see AGENTS.md for current counts)
│   │       ├── tools/           # native tool dirs, config-gated (LSP via MCP, ast-grep via skill)
│   │       ├── mcp/             # built-in MCPs: remote (websearch, context7, grep_app) + local stdio (lsp, codegraph)
│   │       ├── features/        # feature modules (background-agent, skill-loader, tmux, MCP-OAuth, boulder-state, monitor, ...)
│   │       ├── config/          # Zod v4 schema system
│   │       ├── shared/          # Cross-cutting utilities
│   │       ├── cli/             # CLI: install, run, doctor, mcp-oauth, boulder, ulw-loop (Commander.js)
│   │       ├── plugin/          # OpenCode hook handlers + 5-tier hook composition
│   │       └── plugin-handlers/ # 6-phase config loading pipeline
│   ├── omo-codex/               # Codex Light edition / lazycodex
│   ├── utils/                   # Core package
│   ├── model-core/              # Core package
│   ├── prompts-core/            # Core package
│   ├── rules-engine/            # Core package
│   ├── agents-md-core/          # Core package
│   ├── comment-checker-core/    # Core package
│   ├── hashline-core/           # Core package
│   ├── boulder-state/           # Core package
│   ├── telemetry-core/          # Core package
│   ├── lsp-core/                # Core package
│   ├── mcp-stdio-core/          # Core package
│   ├── tmux-core/               # Core package
│   ├── claude-code-compat-core/ # Core package
│   ├── skills-loader-core/      # Core package
│   ├── mcp-client-core/         # Core package
│   ├── openclaw-core/           # Core package
│   ├── team-core/               # Core package
│   ├── delegate-core/           # Core package
│   ├── lsp-tools-mcp/           # MCP package
│   ├── lsp-daemon/              # MCP package
│   ├── git-bash-mcp/            # MCP package
│   ├── shared-skills/           # Cross-harness SKILL.md bundle
│   └── web/                     # Marketing site (Next.js 15 + Cloudflare Workers)
└── dist/                        # Build output (ESM + .d.ts)
```

The multi-harness refactor is in progress. See `ROADMAP.md` for the current state.

## Development Workflow

### Build Commands

```bash
# Type check only
bun run typecheck

# Full build (ESM + TypeScript declarations + JSON schema)
bun run build

# Clean build output
bun run clean

# Rebuild from scratch
bun run clean && bun run build

# Build schema only (after modifying packages/omo-opencode/src/config/schema/)
bun run build:schema

# Run the root Bun test suite
bun test

# Run the Codex Light compatibility suite
bun run test:codex
```

Tests are co-located as `*.test.ts` files and follow a given/when/then style.

### Code Style & Conventions

| Convention       | Rule                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| Package Manager  | **Bun only** (`bun run`, `bun build`, `bunx`)                             |
| Types            | Use `bun-types`, not `@types/node`                                        |
| Directory Naming | kebab-case (`ast-grep/`, `claude-code-hooks/`)                            |
| File Operations  | Never use bash commands (mkdir/touch/rm) for file creation in code        |
| Tool Structure   | `index.ts` (barrel), `types.ts`, `constants.ts`, and concern-split implementation files named after what they do. Generic catch-all dump modules are banned (see `.omo/rules/file-size-architectural-smell.md`). |
| Hook Pattern     | `createXXXHook(deps)` function naming                                     |
| Exports          | Barrel pattern (`export * from "./module"` in index.ts)                   |

**Anti-Patterns (Do Not Do)**:

- Using npm/yarn instead of bun
- Using `@types/node` instead of `bun-types`
- Suppressing TypeScript errors with `as any`, `@ts-ignore`, `@ts-expect-error`
- Generic AI-generated comment bloat
- Direct `bun publish` (use GitHub Actions only)
- Local version modifications in `package.json`

## Making Changes

### Adding a New Agent

1. Create a new `.ts` file in `packages/omo-opencode/src/agents/`
2. Export a factory `createXyzAgent(model): AgentConfig` where `AgentConfig` is imported from `@opencode-ai/sdk`
3. Set the static `.mode` property on the factory to `"primary"`, `"subagent"`, or `"all"`
4. Add the factory to the `agentSources` record in `packages/omo-opencode/src/agents/builtin-agents.ts`
5. Add the new name to the `BuiltinAgentName` union in `packages/omo-opencode/src/agents/types.ts` AND to `BuiltinAgentNameSchema` (plus `OverridableAgentNameSchema` if it should be user-overridable) in `packages/omo-opencode/src/config/schema/agent-names.ts`. The schema enum is what `build:schema` emits, so updating only `types.ts` will not change the published JSON schema.
6. Run `bun run build:schema` to regenerate the JSON schema
7. Special agents (Sisyphus, Hephaestus, Atlas, Prometheus) have dedicated wiring under `packages/omo-opencode/src/agents/builtin-agents/`; a plain subagent only needs the `agentSources` entry from step 4

```typescript
// packages/omo-opencode/src/agents/my-agent.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export function createMyAgent(model: string): AgentConfig {
  return {
    name: "my-agent",
    model,
    description: "Description of what this agent does",
    prompt: `Your agent's system prompt here`,
    temperature: 0.1,
    // ... other config
  };
}

createMyAgent.mode = "subagent" as const;
```

### Adding a New Hook

1. Create a new directory in `packages/omo-opencode/src/hooks/` (kebab-case)
2. Implement `createXyzHook(deps)` returning an object keyed by OpenCode hook names (for example `"tool.execute.before"`, `"chat.message"`, `"event"`) whose values are `(input, output) => void` handlers
3. Re-export from `packages/omo-opencode/src/hooks/index.ts`
4. Wire the hook into the matching tier composer in `packages/omo-opencode/src/plugin/hooks/create-*-hooks.ts` (Session / ToolGuard / Transform / Continuation / Skill) via `safeHook()`
5. Add the hook name to `HookNameSchema` in `packages/omo-opencode/src/config/schema/hooks.ts`

```typescript
// packages/omo-opencode/src/hooks/my-hook/index.ts
export function createMyHook(deps: { logger: Logger }) {
  return {
    "chat.message": async (input: ChatMessageInput, output: ChatMessageOutput) => {
      // Hook logic here
    },
  };
}
```

### Adding a New Tool

1. Create a new directory in `packages/omo-opencode/src/tools/<name>/`
2. Export a factory `createXyzTool(ctx): ToolDefinition` built with `tool({...})` from `@opencode-ai/plugin`
3. Register the factory in the `ToolRegistryFactories` type and `defaultToolRegistryFactories` record in `packages/omo-opencode/src/plugin/tool-registry-factories.ts`
4. Wire it into `createCoreTools()` in `tool-registry-core-tools.ts` for always-on tools, or a gated record in `tool-registry-gated-tools.ts` spread in `packages/omo-opencode/src/plugin/tool-registry.ts`
5. Export from `packages/omo-opencode/src/tools/index.ts`

### Adding a New MCP Server

1. Create a config factory in `packages/omo-opencode/src/mcp/<name>.ts` returning a `RemoteMcpConfig` (type `"remote"`, url) or `LocalMcpConfig` (type `"local"`, command)
2. Register it inside `createBuiltinMcps()` in `packages/omo-opencode/src/mcp/index.ts`
3. Add the MCP name to `McpNameSchema` in `packages/omo-opencode/src/mcp/types.ts`
4. Document in README if it requires external setup

## QA Discipline

Any change to `packages/omo-opencode` (the OpenCode side) must be QA'd with the `opencode-qa` skill. Any change to `packages/omo-codex` (the Codex Light side) must be QA'd with the `codex-qa` skill. Record QA evidence under `.omo/evidence/<date>-<slug>/`.

"It typechecks" or "`bun test` is green" is not QA. You must drive the real harness and record the observed behavior.

## Pull Request Process

1. **Fork** the repository and create your branch from `dev`
2. **Make changes** following the conventions above
3. **Build and test** locally:
   ```bash
   bun run typecheck  # Ensure no type errors
   bun run build      # Ensure build succeeds
   bun test           # Run the root test suite
   bun run test:codex # Run the Codex Light compatibility suite
   ```
4. **Test in OpenCode** using the local build method described above
5. **Commit** with clear, descriptive messages:
   - Use present tense ("Add feature" not "Added feature")
   - Reference issues if applicable ("Fix #123")
6. **Push** to your fork and create a Pull Request
7. **Describe** your changes clearly in the PR description

### PR Checklist

- [ ] Code follows project conventions
- [ ] `bun run typecheck` passes
- [ ] `bun run build` succeeds
- [ ] `bun test` passes
- [ ] `bun run test:codex` passes (if Codex-side changed)
- [ ] Tested locally with OpenCode
- [ ] QA evidence recorded under `.omo/evidence/` (if harness-connected changes)
- [ ] Updated documentation if needed (README, AGENTS.md)
- [ ] No version changes in `package.json`

## Publishing

**Important**: Publishing is handled exclusively through GitHub Actions.

- **Never** run `bun publish` directly (OIDC provenance issues)
- **Never** modify `package.json` version locally
- Maintainers use GitHub Actions workflow_dispatch:
  ```bash
  gh workflow run publish -f bump=patch  # or minor/major
  ```

## Getting Help

- **Project Knowledge**: Check `AGENTS.md` for detailed project documentation
- **Code Patterns**: Review existing implementations in `packages/omo-opencode/src/`
- **Issues**: Open an issue for bugs or feature requests
- **Discussions**: Start a discussion for questions or ideas

---

Thank you for contributing to Oh My OpenCode! Your efforts help make AI-assisted coding better for everyone.
