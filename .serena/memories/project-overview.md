# Oh My OpenCode - Project Overview

## Purpose
OpenCode plugin that extends Claude Code/AmpCode with multi-model agent orchestration, LSP tools, AST-Grep search, and MCP integrations. "oh-my-zsh for OpenCode".

## Tech Stack
- **Runtime**: Bun (exclusively)
- **Language**: TypeScript (ESNext, ESM)
- **Framework**: @opencode-ai/plugin SDK
- **Types**: bun-types (not @types/node)
- **Schema**: Zod for validation
- **Auth**: Google Antigravity OAuth

## Key Directories
- `src/agents/` - AI agents (OmO, oracle, librarian, etc.)
- `src/hooks/` - 21+ lifecycle hooks
- `src/tools/` - LSP, AST-Grep, Grep, Glob, background-task, look-at, call-omo-agent
- `src/mcp/` - MCP servers (context7, websearch_exa, grep_app)
- `src/features/` - Background agent, Claude Code loaders, orchestration
- `src/config/` - Zod schema, tool-config

## Agent Hierarchy (LIF-62)
- **team-lead**: OmO (can delegate to anyone)
- **manager**: implementation-specialist (can delegate to specialists)
- **specialist**: backend-typescript, frontend-react, etc. (cannot delegate)
- **advisor**: oracle (read-only, strategic guidance)
- **utility**: explore, librarian (read-only, research)

## Orchestration Components (LIF-62)
Location: `src/features/orchestration/`
- `DelegationTracker` - Tracks delegation chains, detects loops
- `MaxTurnsEnforcer` - Limits turns per session
- `RetryMiddleware` - Handles retryable errors with backoff

## Commands
```bash
bun run typecheck   # Type check
bun run build       # Build (ESM + declarations + schema)
bun run rebuild     # Clean + Build
```

## Important Notes
- No test framework configured
- Never run `bun publish` directly - use GitHub Actions
- Never bump version locally - managed by CI
