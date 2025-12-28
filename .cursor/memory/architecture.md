# oh-my-opencode System Architecture

<!--
TEMPLATE METADATA:
Version: 1.0.0
Purpose: Architecture documentation for oh-my-opencode plugin
Last Updated: 2025-12-17

MAINTENANCE:
- WHO: Strategic Architect agent, or project maintainer
- WHEN: Major architectural changes, new components, significant refactoring
- HOW: Use /update-context architecture or edit directly

UPDATE TRIGGERS:
- After creating ADRs in .cursor/memory/decisions/
- After implementing features that change architecture
- After quarterly architecture reviews
-->

## Architecture Overview

### High-Level Design

oh-my-opencode is an OpenCode plugin that extends the base OpenCode experience with custom agents, hooks, tools, and MCP integrations. It follows the `@opencode-ai/plugin` SDK patterns, exporting a single Plugin function that registers all extensions.

The architecture is **plugin-based** with clear separation between:
- **Agents**: AI model configurations and system prompts
- **Hooks**: Lifecycle event handlers
- **Tools**: Custom tool implementations
- **MCPs**: Model Context Protocol server configurations
- **Features**: Higher-level feature modules

### Key Components

- **OhMyOpenCodePlugin** (`src/index.ts`): Main plugin entry point that registers all components
- **Agents** (`src/agents/`): AI agent definitions (OmO, oracle, librarian, explore, frontend, document-writer, multimodal-looker)
- **Hooks** (`src/hooks/`): 21 lifecycle hooks for various enhancements
- **Tools** (`src/tools/`): Custom tools including LSP (11), AST-Grep, Grep, Glob, background-task, look-at, skill, slashcommand, interactive-bash
- **MCPs** (`src/mcp/`): MCP server configurations (context7, websearch_exa, grep_app)
- **Features** (`src/features/`): Terminal, Background agent, Claude Code loaders
- **Config** (`src/config/`): Zod schema and TypeScript types
- **Auth** (`src/auth/antigravity/`): Google OAuth for Gemini models

### Data Flow

```
User Request
    ↓
OpenCode Core
    ↓
OhMyOpenCodePlugin.config() → Registers agents, tools, MCPs, commands
    ↓
OhMyOpenCodePlugin.event() → Lifecycle events (session, tool execution)
    ↓
Hook Chain → Each hook processes/transforms
    ↓
Tool Execution → Custom tools handle specific operations
    ↓
Response to User
```

### Integration Points

- **OpenCode Core**: Via `@opencode-ai/plugin` SDK
- **Linear**: Via built-in linear tools (LINEAR_API_KEY required)
- **Context7**: Via MCP for library documentation
- **Websearch**: Via Exa MCP for web search
- **Grep.app**: Via MCP for code search
- **Google OAuth**: Via Antigravity for Gemini model auth

## Architecture Decisions

See `.cursor/memory/decisions/` for Architecture Decision Records:
- ADR-001: Agent Orchestration Pattern
- ADR-002: Background Task Design
- ADR-003: Governance Hooks

## Recent Changes

### 2025-12-17 - Governance Hooks Added

- **What**: Added governance hooks (path-validator, historian, linear-injector)
- **Why**: Enable spec-driven workflow enforcement
- **Impact**: All tool executions now pass through governance validation

### 2025-12-15 - Multi-Model Agent System

- **What**: Implemented 7 agents with different AI models
- **Why**: Leverage model strengths for different tasks
- **Impact**: Users can now use specialized agents for different work types

## Planned Changes

- [ ] Add comprehensive test framework
- [ ] Implement caching for LSP connections
- [ ] Add more governance hooks for Linear integration
- [ ] Create agent performance metrics

**Last Updated**: 2025-12-17
