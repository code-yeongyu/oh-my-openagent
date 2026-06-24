# claude-code-compat-core — Claude Code Compatibility Loaders (Core)

**Generated:** 2026-06-16

[packages/AGENTS.md](../AGENTS.md)

## OVERVIEW

Harness-neutral Core that discovers and translates Claude Code plugins, commands, agents, skills, and MCP configs into structures that harness adapters can consume.

Npm package: `@oh-my-opencode/claude-code-compat-core`. Barrel-exported from `src/index.ts`. Consumed by `omo-opencode` via thin shim re-exports under [`packages/omo-opencode/src/features/claude-code-*/`](../omo-opencode/src/features/).

Type-check with `bun run typecheck` (tsgo). Tests are co-located as `*.test.ts` inside each feature dir.

## LOADERS

| Feature dir | What it loads | Key entry |
|-------------|---------------|-----------|
| `claude-code-plugin-loader/` | Claude Code plugins (commands, skills, agents, MCP servers, hooks) | `loader.ts` (`PluginComponentsResult`) |
| `claude-code-mcp-loader/` | `.mcp.json` configs (user/project/local) into OpenCode SDK format | `loader.ts` |
| `claude-code-command-loader/` | Slash commands from markdown files in project and config dirs | `loader.ts` |
| `claude-code-agent-loader/` | Agent definitions from markdown and JSON configs | `loader.ts` |

## SHARED

`src/shared/` has 17 barrel-exported helpers for config-dir resolution, frontmatter parsing, model sanitization, path resolution, and Bun shims. Key entry: `shared/index.ts`.

## NOTES

- **Env allowlist:** The MCP loader expands `${VAR}` placeholders only for variables listed in `mcp_env_allowlist` (user-only, security). Implemented in `env-expander.ts` and `configure-allowed-env-vars.ts`.
- **Scope filtering:** Both plugin and MCP loaders filter by scope (`user`/`project`/`local`). See `scope-filter.ts` in each loader dir.
- **Plugin discovery:** `discovery.ts` walks Claude Code plugin directories; `plugin-path-resolver.ts`, `install-path-resolver.ts`, and `plugin-manifest.ts` map installed artifacts to loadable structures.
