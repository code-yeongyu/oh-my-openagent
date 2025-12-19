# oh-my-opencode Glossary

<!--
TEMPLATE METADATA:
Version: 1.0.0
Purpose: Project glossary for oh-my-opencode
Last Updated: 2025-12-17

MAINTENANCE:
- WHO: Any team member, Documentation Master, or Product Strategist
- WHEN: New domain terms introduced, acronyms used, concepts need clarification
- HOW: Use /update-context glossary or edit directly
-->

## Terms & Definitions

### A

- **Agent**: An AI model configuration with a specific system prompt, model selection, and tool permissions
- **Antigravity**: Google OAuth authentication plugin for Gemini models

### B

- **Background Task**: A long-running task that executes in a separate session
- **Barrel Export**: Pattern of re-exporting all module exports from index.ts

### C

- **Claude Code Loader**: Feature that loads commands/agents/skills from Claude Code format
- **Constitution**: Core principles document governing project development

### H

- **Hook**: A lifecycle event handler that can intercept and modify OpenCode behavior

### L

- **LSP**: Language Server Protocol - provides IDE features like go-to-definition
- **Linear**: Project management tool integrated via MCP

### M

- **MCP**: Model Context Protocol - standard for AI model integrations
- **Memory**: Project context files (constitution, architecture, tech-stack, glossary)

### O

- **OmO**: "Oh My OpenCode" - the primary orchestrator agent
- **OpenCode**: The AI coding assistant that oh-my-opencode extends

### P

- **Plugin**: An extension module that adds capabilities to OpenCode

### S

- **Spec-Driven Development**: Workflow where specifications drive implementation
- **Subagent**: An agent that can only be invoked by other agents (mode: subagent)

### T

- **Tool**: A function that agents can call to perform actions

## Acronyms

- **ADR**: Architecture Decision Record - documents significant design decisions
- **AST**: Abstract Syntax Tree - code structure representation
- **LSP**: Language Server Protocol - IDE feature protocol
- **MCP**: Model Context Protocol - AI integration standard
- **SDK**: Software Development Kit - development tools/libraries
- **XDG**: X Desktop Group - standard for config file locations

## Domain Concepts

### Plugin Architecture

oh-my-opencode follows the OpenCode plugin architecture where a single Plugin function is exported that registers:
- Agents (AI configurations)
- Tools (callable functions)
- Hooks (lifecycle handlers)
- MCPs (external integrations)
- Commands (slash commands)

### Multi-Model Strategy

Different AI models are used for different tasks based on their strengths:
- Claude: Complex reasoning, code generation
- GPT: Strategic thinking, review
- Gemini: UI/UX, multimodal
- Grok: Fast exploration

### Governance System

The governance system ensures workflow compliance through:
- Context Steward: Path validation
- Historian: Audit trail
- Linear Injector: Issue context

## Project-Specific Terminology

| Term | Project Meaning | Common Meaning |
|------|-----------------|----------------|
| OmO | Primary orchestrator agent | N/A |
| Oracle | GPT-based advisor agent | Fortune teller |
| Librarian | Multi-repo analysis agent | Book keeper |
| Explore | Fast codebase explorer agent | General exploration |

## Related Resources

- Constitution: `.cursor/memory/constitution.md`
- Architecture: `.cursor/memory/architecture.md`
- Tech Stack: `.cursor/memory/tech-stack.md`

**Last Updated**: 2025-12-17
