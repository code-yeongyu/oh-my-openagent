# oh-my-opencode Technology Stack

<!--
TEMPLATE METADATA:
Version: 1.0.0
Purpose: Technology stack documentation for oh-my-opencode
Last Updated: 2025-12-17

MAINTENANCE:
- WHO: Strategic Architect, Implementation Specialist, or DevOps Specialist
- WHEN: New frameworks/libraries added, major version upgrades, infrastructure changes
- HOW: Use /update-context tech-stack or edit directly

UPDATE TRIGGERS:
- After dependency updates (package.json changes)
- After adding new integrations
- After infrastructure changes
-->

## Core Technologies

### Language & Runtime

- **Language**: TypeScript 5.7+
- **Runtime**: Bun >= 1.0.0
- **Types**: bun-types (NOT @types/node)

### Frameworks & Libraries

- **@opencode-ai/plugin**: ^1.0.150 - OpenCode plugin SDK
- **@ast-grep/napi**: ^0.40.0 - AST-based code search
- **@ast-grep/cli**: ^0.40.0 - AST-Grep CLI
- **Hono**: ^4.10.4 - HTTP server for OAuth flows
- **Zod**: ^4.1.8 - Schema validation
- **picomatch**: ^4.0.2 - Glob pattern matching
- **@openauthjs/openauth**: ^0.4.3 - Google OAuth
- **@code-yeongyu/comment-checker**: ^0.5.0 - Code comment analysis
- **xdg-basedir**: ^5.1.0 - XDG directory paths

### Development Tools

- **Build Tool**: Bun (bun build + tsc --emitDeclarationOnly)
- **Testing**: Not configured (future work)
- **Linting**: TypeScript strict mode

### Infrastructure

- **Deployment**: npm registry (oh-my-opencode package)
- **CI/CD**: GitHub Actions (workflow_dispatch for publishing)
- **Monitoring**: None (plugin runs within OpenCode)

### External Services

- **Linear**: Project management via MCP
- **Context7**: Library documentation via MCP
- **Websearch (Exa)**: Web search via MCP
- **Grep.app**: Code search via MCP
- **DeepWiki**: Repository documentation via MCP

## Version Constraints

- Minimum Bun version: 1.0.0
- Minimum OpenCode version: 1.0.132 (earlier versions have config bugs)
- Node.js: Not used (Bun runtime only)

## Conventions

- **Code style**: TypeScript strict, 2-space indent, double quotes
- **Naming**: kebab-case files, camelCase functions, PascalCase classes
- **File structure**: Barrel exports via index.ts

## Dependency Management

- **Package manager**: Bun
- **Lock file**: bun.lock
- **Update policy**: Manual updates, test before upgrading
- **Trusted dependencies**: @ast-grep/cli, @ast-grep/napi, @code-yeongyu/comment-checker

## Agent Models

| Agent | Model | Purpose |
|-------|-------|---------|
| OmO | anthropic/claude-opus-4-5 | Primary orchestrator |
| oracle | openai/gpt-5.2 | Strategic advisor |
| librarian | opencode/big-pickle | Multi-repo analysis |
| explore | opencode/grok-code | Fast exploration |
| frontend-ui-ux-engineer | google/gemini-3-pro-preview | UI generation |
| document-writer | google/gemini-3-pro-preview | Documentation |
| multimodal-looker | google/gemini-2.5-flash | Image/PDF analysis |

**Last Updated**: 2025-12-17
