# OpenCode Configuration

This directory contains the OpenCode AI agent configuration for this project.

## Directory Structure

```
.opencode/
├── opencode.json              # Main configuration file
├── project-context.yaml       # Project context configuration
├── agent/                     # Agent definitions (FLAT structure)
│   ├── orchestrator.md        # Main entry point (OpenCode-only)
│   ├── context-steward.md     # Path validation
│   ├── historian.md           # Audit trail
│   └── ... (25 total agents)
├── command/                   # Custom slash commands (33 total)
│   ├── orchestrator.md        # Delegates to orchestrator agent
│   ├── init-project.md        # Project initialization
│   └── ... (33 total commands)
├── tool/                      # Custom tools (TypeScript)
│   ├── init-project/          # Project initialization tool
│   ├── linear-branch/         # Linear branch name tool
│   ├── linear-update-status/  # Linear status update tool
│   ├── mintlify-sync/         # Documentation sync tool
│   └── read-context/          # Project context reader
├── templates/                 # Templates for project initialization
│   ├── agents/                # Agent templates
│   ├── git-hooks/             # Git hook templates
│   ├── linear/                # Linear templates
│   ├── scripts/               # Script templates
│   └── validation/            # Validation templates
├── instructions/              # Global instruction files
│   ├── cursor-opencode-sync.md    # Sync translation guide
│   ├── sync-maintenance.md        # Maintenance procedures
│   └── ... (other instructions)
├── docs/                      # OpenCode-specific documentation
├── skills/                    # OpenCode skills
└── archive/                   # Migration archive
```

## OpenCode-Only Features

These features exist only in OpenCode and are NOT synced from Cursor.

### OpenCode-Only Agents (4)

| Agent | Location | Purpose |
|-------|----------|---------|
| **orchestrator** | `.opencode/agent/orchestrator.md` | Task delegation orchestrator - routes requests to optimal specialized agents using tool-based delegation |
| **agent-engineer** | `.opencode/agent/agent-engineer.md` | OpenCode agent development - creates and maintains OpenCode agent definitions |
| **research** | `.opencode/agent/research.md` | Research tasks - handles research/investigate tasks with web fetching and codebase exploration |
| **conversation-auditor** | `.opencode/agent/conversation-auditor.md` | Conversation compliance - audits conversations for compliance (user-invoked only) |

### OpenCode-Only Commands (2)

| Command | Location | Purpose |
|---------|----------|---------|
| **init-project** | `.opencode/command/init-project.md` | Initialize a new OpenCode project with proper structure, agents, and configuration |
| **orchestrator** | `.opencode/command/orchestrator.md` | Delegates to the orchestrator agent for intelligent workflow routing |

### Custom Tools (5)

| Tool | Location | Purpose |
|------|----------|---------|
| **init-project** | `.opencode/tool/init-project/` | Project initialization with tech detection, agent generation, and Linear setup |
| **linear-branch** | `.opencode/tool/linear-branch/` | Get git branch name for a Linear issue |
| **linear-update-status** | `.opencode/tool/linear-update-status/` | Update Linear issue status with optional comment |
| **mintlify-sync** | `.opencode/tool/mintlify-sync/` | Validate and sync documentation to Mintlify |
| **read-context** | `.opencode/tool/read-context/` | Read and parse project context configuration |

## Key Differences from Cursor

| Aspect | Cursor | OpenCode |
|--------|--------|----------|
| **Agent Structure** | Flat (`.cursor/agents/*.md`) | Flat (`.opencode/agent/*.md`) |
| **Agent Format** | Simple markdown | YAML frontmatter + structured sections |
| **Delegation** | `@Agent-Name` mentions | `task(subagent_type: "agent-name")` |
| **Orchestrator** | `conductor.md` (command) | `orchestrator.md` (agent with tools) |
| **Custom Tools** | N/A | `.opencode/tool/` directory |
| **Project Init** | Manual setup | `/init-project` command |

### YAML Frontmatter (Required for OpenCode Agents)

```yaml
---
mode: subagent
model: claude-sonnet-4-20250514
temperature: 0.5
tools:
  read: true
  write: true
  task: true
description: Brief agent description
---
```

### Delegation Pattern

```markdown
# Cursor format
@Product-Strategist Plan user authentication feature

# OpenCode format
task(
  description: "Plan user authentication feature",
  prompt: "Define requirements for user authentication feature.",
  subagent_type: "product-strategist"
)
```

## Shared Resources

These resources are shared between Cursor and OpenCode (stored in `.cursor/`):

| Resource | Location | Purpose |
|----------|----------|---------|
| **Specs** | `.cursor/specs/` | Feature specification folders |
| **Memory** | `.cursor/memory/` | Constitution, architecture, tech-stack, glossary |
| **Templates** | `.cursor/templates/` | Spec templates (spec-template.md, plan-template.md, etc.) |
| **Scripts** | `.cursor/scripts/` | Bash scripts (create-feature.sh, etc.) |
| **Rules** | `.cursor/rules/` | Project rules (organized by category) |
| **Changelog** | `.cursor/changelog/` | Project-level changelog |

## Configuration Overview

### opencode.json

The main configuration file includes:

- **Model Configuration**: Default models for AI interactions
- **Permissions**: Controls for file editing, bash commands, and web fetching
- **MCP Servers**: Model Context Protocol servers (e.g., Linear)
- **LSP Servers**: Language Server Protocol configurations (added per-project)
- **Instructions**: Global instruction files to include

### MCP Servers

#### Linear

The Linear MCP server is configured for project management integration. Requires `LINEAR_API_KEY` environment variable:

```bash
export LINEAR_API_KEY="your-api-key-here"
```

Get your API key from [Linear Settings > API](https://linear.app/settings/api).

## Sync with Cursor

For maintaining sync between Cursor and OpenCode:

- **Translation Guide**: `.opencode/instructions/cursor-opencode-sync.md`
- **Sync Checklist**: `.cursor/scripts/sync-checklist.md`
- **Maintenance Procedures**: `.opencode/instructions/sync-maintenance.md`

### Sync Statistics (LIF-54)

| Metric | Count |
|--------|-------|
| Shared Agents | 21 |
| OpenCode-Only Agents | 4 |
| Total Commands | 33 |
| Commands Ported | 20 |
| Commands Skipped | 2 |
| OpenCode-Only Commands | 2 |

## Usage

1. Ensure OpenCode is installed
2. Set required environment variables (e.g., `LINEAR_API_KEY`)
3. Run `opencode` in the project directory
4. OpenCode will automatically load this configuration

## Notes

- Never commit API keys or secrets to this directory
- Use environment variable references: `{env:VARIABLE_NAME}`
- LSP servers must be installed on the system to function
- Agent names use flat structure (no subdirectories)
- Cursor is source of truth for shared agents; sync preserves OpenCode format
