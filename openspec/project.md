# Enterprise SaaS Engineer Toolbelt - Project Overview

An extension to oh-my-opencode that transforms it from an AI coding assistant plugin into a comprehensive enterprise SaaS engineer toolbelt with knowledge governance.

## Vision

Create an "oh-my-zsh for enterprise engineering" - a unified interface where AI agents help engineers with their complete daily workflow: debugging, deploying, testing, reviewing, incident response, and knowledge management.

## Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Bun (>=1.0)
- **Package Manager**: Bun
- **Base Platform**: oh-my-opencode (OpenCode plugin)
- **Memory Layer**: Mem0 (multi-layer AI memory)
- **Protocol**: Model Context Protocol (MCP)
- **Target Users**: Enterprise engineering teams (50-500 engineers)

## Project Structure

```
src/
├── features/
│   ├── knowledge-repo/        # Knowledge governance (Git-like commits)
│   ├── mem0-memory/           # Mem0 MCP adapter
│   └── builtin-skills/        # Enterprise skills (/knowledge, /debug, etc.)
├── hooks/
│   └── knowledge-monitor/     # Session knowledge monitoring
├── tools/
│   └── knowledge/             # Knowledge query/propose tools
├── agents/
│   └── knowledge-curator.ts   # Knowledge lifecycle agent
└── mcp/                       # MCP server configurations
```

## Conventions

### Code Style
- TypeScript strict mode enabled
- Async/await for all asynchronous operations
- Barrel exports via index.ts
- Factory pattern: `createXXXHook()`, `createXXXTool()`
- BDD test comments: `#given`, `#when`, `#then`

### Agent Design
- Temperature: 0.1 for code agents, max 0.3
- Model selection by capability (see AGENTS.md)
- Progressive disclosure: metadata → instructions → resources
- Agent-centric design: workflows, not API wrappers

### Knowledge Management
- Immutable commits (append-only)
- Layer hierarchy: Company → Org → Project
- Constraint-based conflict detection
- Severity levels: INFO, WARN, BLOCK

### MCP Integration
- Prefer official MCPs over community
- Build only when no quality option exists
- Enterprise-ready = auth, security, scalability

## Error Handling

- Let errors bubble to CLI level
- Use native Error types with descriptive messages
- No try-catch in utility functions
- Exit codes: 0 (success), 1 (error), 2 (misuse)

## Testing Strategy

- Unit tests with Vitest
- BDD-style assertions
- Mock external services
- Integration tests for MCP adapters

## Enterprise Tools Integration

### Paid (Enterprise License Required)
- Datadog - Observability
- Jira/Confluence - Project management (via mcp-atlassian)
- GitHub Enterprise - Source control
- AWS/GCP - Cloud infrastructure
- Slack - Communication

### Free/OSS
- Grafana, Prometheus, Sentry - Monitoring
- Playwright - Testing
- Mem0 - AI Memory
- Linear, Notion - PM alternatives

## Anti-Patterns

| Category | Forbidden |
|----------|-----------|
| Type Safety | `as any`, `@ts-ignore`, `@ts-expect-error` |
| Package Manager | npm, yarn, npx (use bun) |
| Agent Design | High temp (>0.3), sequential calls, broad tool access |
| Knowledge | Mutable history, orphaned knowledge, skipped conflicts |
| MCP | Building when official exists, community for critical path |

## Success Metrics

- 80% reduction in context-switching between tools
- 50% faster onboarding for new engineers
- 90% knowledge retrieval accuracy
- Zero high-severity constraint violations in production
