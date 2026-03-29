# Architecture

Architectural decisions and patterns for oh-my-opencode.

## Config Schema System

- Located in `src/config/schema/`
- Zod v4 for validation
- Schemas export both Zod schema and TypeScript types
- Config uses snake_case keys
- Multi-level config: project → user → defaults

## MCP System

Three-tier MCP system:
1. Built-in: `src/mcp/` - remote HTTP MCPs
2. Claude Code: `.mcp.json`
3. Skill-embedded: YAML in SKILL.md

Built-in MCPs:
- `websearch.ts` - Exa/Tavily web search
- `context7.ts` - Context7 documentation
- `grep_app.ts` - Grep.app code search

## Tool/Agent Factory Pattern

All tools/agents use `createXXX()` factory functions.
