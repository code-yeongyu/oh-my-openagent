# Contributing to Oh My OpenCode

First off, thanks for taking the time to contribute! This document provides guidelines and instructions for contributing to oh-my-opencode.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Development Setup](#development-setup)
  - [Testing Your Changes Locally](#testing-your-changes-locally)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
  - [Build Commands](#build-commands)
  - [Code Style & Conventions](#code-style--conventions)
- [Making Changes](#making-changes)
  - [Adding a New Agent](#adding-a-new-agent)
  - [Adding a New Hook](#adding-a-new-hook)
  - [Adding a New Tool](#adding-a-new-tool)
  - [Adding a New MCP Server](#adding-a-new-mcp-server)
- [Pull Request Process](#pull-request-process)
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

- **Bun** (latest version) - The only supported package manager
- **TypeScript 5.7.3+** - For type checking and declarations
- **OpenCode 1.0.150+** - For testing the plugin

### Development Setup

```bash
# Clone the repository
git clone https://github.com/code-yeongyu/oh-my-opencode.git
cd oh-my-opencode

# Install dependencies (bun only - never use npm/yarn)
bun install

# Build the project
bun run build
```

### Testing Your Changes Locally

After making changes, you can test your local build in OpenCode:

1. **Build the project**:
   ```bash
   bun run build
   ```

2. **Update your OpenCode config** (`~/.config/opencode/opencode.json` or `opencode.jsonc`):
   ```json
   {
     "plugin": [
       "file:///absolute/path/to/oh-my-opencode/dist/index.js"
     ]
   }
   ```
   
   For example, if your project is at `/Users/yourname/projects/oh-my-opencode`:
   ```json
   {
     "plugin": [
       "file:///Users/yourname/projects/oh-my-opencode/dist/index.js"
     ]
   }
   ```

   > **Note**: Remove `"oh-my-opencode"` from the plugin array if it exists, to avoid conflicts with the npm version.

3. **Restart OpenCode** to load the changes.

4. **Verify** the plugin is loaded by checking for OmO agent availability or startup messages.

## Project Structure

```
oh-my-opencode/
├── src/
│   ├── agents/        # AI agents (OmO, oracle, librarian, explore, etc.)
│   ├── hooks/         # 21 lifecycle hooks
│   ├── tools/         # LSP (11), AST-Grep, Grep, Glob, etc.
│   ├── mcp/           # MCP server integrations (context7, grep_app)
│   ├── features/      # Claude Code compatibility layers
│   ├── config/        # Zod schemas and TypeScript types
│   ├── auth/          # Google Antigravity OAuth
│   ├── shared/        # Common utilities
│   └── index.ts       # Main plugin entry (OhMyOpenCodePlugin)
├── script/            # Build utilities (build-schema.ts, publish.ts)
├── assets/            # JSON schema
└── dist/              # Build output (ESM + .d.ts)
```

## Development Workflow

### Build Commands

```bash
# Type check only
bun run typecheck

# Full build (ESM + TypeScript declarations + JSON schema)
bun run build

# Clean build output and rebuild
bun run rebuild

# Build schema only (after modifying src/config/schema.ts)
bun run build:schema
```

### Code Style & Conventions

| Convention | Rule |
|------------|------|
| Package Manager | **Bun only** (`bun run`, `bun build`, `bunx`) |
| Types | Use `bun-types`, not `@types/node` |
| Directory Naming | kebab-case (`ast-grep/`, `claude-code-hooks/`) |
| File Operations | Never use bash commands (mkdir/touch/rm) for file creation in code |
| Tool Structure | Each tool: `index.ts`, `types.ts`, `constants.ts`, `tools.ts`, `utils.ts` |
| Hook Pattern | `createXXXHook(input: PluginInput)` function naming |
| Exports | Barrel pattern (`export * from "./module"` in index.ts) |

**Anti-Patterns (Do Not Do)**:
- Using npm/yarn instead of bun
- Using `@types/node` instead of `bun-types`
- Suppressing TypeScript errors with `as any`, `@ts-ignore`, `@ts-expect-error`
- Generic AI-generated comment bloat
- Direct `bun publish` (use GitHub Actions only)
- Local version modifications in `package.json`

## Making Changes

### Adding a New Agent

1. Create a new `.ts` file in `src/agents/`
2. Define the agent configuration following existing patterns
3. Add to `builtinAgents` in `src/agents/index.ts`
4. Update `src/agents/types.ts` if needed
5. Run `bun run build:schema` to update the JSON schema

```typescript
// src/agents/my-agent.ts
import type { AgentConfig } from "./types";

export const myAgent: AgentConfig = {
  name: "my-agent",
  model: "anthropic/claude-sonnet-4-5",
  description: "Description of what this agent does",
  prompt: `Your agent's system prompt here`,
  temperature: 0.1,
  // ... other config
};
```

### Adding a New Hook

1. Create a new directory in `src/hooks/` (kebab-case)
2. Implement `createXXXHook()` function returning event handlers
3. Export from `src/hooks/index.ts`

```typescript
// src/hooks/my-hook/index.ts
import type { PluginInput } from "@opencode-ai/plugin";

export function createMyHook(input: PluginInput) {
  return {
    onSessionStart: async () => {
      // Hook logic here
    },
  };
}
```

### Adding a New Tool

1. Create a new directory in `src/tools/` with required files:
   - `index.ts` - Main exports
   - `types.ts` - TypeScript interfaces
   - `constants.ts` - Constants and tool descriptions
   - `tools.ts` - Tool implementations
   - `utils.ts` - Helper functions
2. Add to `builtinTools` in `src/tools/index.ts`

### Adding a New MCP Server

1. Create configuration in `src/mcp/`
2. Add to `src/mcp/index.ts`
3. Document in README if it requires external setup

## Pull Request Process

1. **Fork** the repository and create your branch from `dev`
2. **Make changes** following the conventions above
3. **Build and test** locally:
   ```bash
   bun run typecheck  # Ensure no type errors
   bun run build      # Ensure build succeeds
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
- [ ] Tested locally with OpenCode
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
- **Code Patterns**: Review existing implementations in `src/`
- **Issues**: Open an issue for bugs or feature requests
- **Discussions**: Start a discussion for questions or ideas

---

Thank you for contributing to Oh My OpenCode! Your efforts help make AI-assisted coding better for everyone.
