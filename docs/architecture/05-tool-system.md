---
title: "Tool System"
description: "Architecture and implementation of the OhMyOpenCode Tool System"
---

# Tool System

The OhMyOpenCode (OMO) Tool System provides a comprehensive set of capabilities that extend AI agents' ability to interact with the codebase, external services, and the user. These tools are modular, type-safe, and integrated into the plugin's lifecycle.

## Overview

Tools in OhMyOpenCode are built using the `@opencode-ai/plugin` framework. They are registered in the plugin's `tool` property and are available to agents based on their configuration. The system provides deep language analysis (LSP), structural search (AST-Grep), project governance, and agent orchestration.

### Tool Registration Pattern

Tools are either defined as static objects or created via factory functions that take the `PluginInput` context. This allows tools to access the filesystem, MCP servers, and other plugin features.

```typescript
// src/tools/index.ts
export const builtinTools = {
  lsp_hover,
  ast_grep_search,
  grep,
  glob,
  slashcommand,
  skill,
  // ...
}

// In plugin entry (src/index.ts)
export class OhMyOpenCodePlugin implements Plugin {
  async init(input: PluginInput) {
    return {
      tools: {
        ...builtinTools,
        linear_branch: createLinearBranchTool(input),
        read_context: createReadContextTool(input),
        create_spec_folder: createSpecFolderTool(input),
        call_omo_agent: createCallOmoAgent(input, backgroundManager),
        look_at: createLookAt(input),
        // ...
      }
    }
  }
}
```

## Tool Categories

| Category | Tools | Purpose |
|----------|-------|---------|
| **LSP** | 11 tools | Deep language analysis and refactoring via Language Server Protocol. |
| **AST-Grep** | 2 tools | Structural code search and rewriting using abstract syntax trees. |
| **Search** | 2 tools | Fast regex-based content search (ripgrep) and file pattern matching. |
| **Governance** | 5 tools | Enforcement of project standards and integration with Linear. |
| **Agent** | 2 tools | Orchestration of specialized sub-agents and multimodal analysis. |
| **Interactive** | 3 tools | Direct user interaction, slash commands, and skills. |

---

## LSP Tools Deep Dive

The LSP tools provide a bridge to language servers, enabling features like type-checking, navigation, and automated refactoring across various languages.

### Available LSP Tools

- **`lsp_hover`**: Get type information, documentation, and signature for a symbol at a specific position.
- **`lsp_goto_definition`**: Jump to the source definition of a symbol (variable, function, class, etc.).
- **`lsp_find_references`**: Find all usages/references of a symbol across the entire workspace.
- **`lsp_document_symbols`**: Get a hierarchical outline of all symbols in a single file.
- **`lsp_workspace_symbols`**: Search for symbols by name across the entire workspace (supports fuzzy matching).
- **`lsp_diagnostics`**: Get all errors, warnings, and hints for a file from the language server.
- **`lsp_servers`**: List all available LSP servers and check if they are installed.
- **`lsp_prepare_rename`**: Check if a symbol at a specific position can be renamed.
- **`lsp_rename`**: Rename a symbol across the entire workspace.
- **`lsp_code_actions`**: Get available code actions (quick fixes, refactorings) for a range in the file.
- **`lsp_code_action_resolve`**: Resolve and apply a specific code action.

### Connection Management

All LSP tools use a centralized `LSPServerManager` that handles spawning, initializing, and cleaning up language server processes. Servers are started on demand based on file extensions and are automatically stopped after a period of inactivity (default 5 minutes).

---

## AST-Grep Tools

AST-Grep provides structural search and replace capabilities that understand code hierarchy, making them more reliable than regex for complex refactorings.

### Pattern Syntax

AST-Grep uses meta-variables to match code structures:
- **`$VAR`**: Matches a single AST node (e.g., a variable name, an expression).
- **`$$$`**: Matches multiple AST nodes (e.g., function arguments, statements in a block).

**Example Pattern**: `console.log($MSG)` matches any `console.log` call and captures the argument in `$MSG`.

### Capabilities

- **Supported Languages (25)**: `bash`, `c`, `cpp`, `csharp`, `css`, `elixir`, `go`, `haskell`, `html`, `java`, `javascript`, `json`, `kotlin`, `lua`, `nix`, `php`, `python`, `ruby`, `rust`, `scala`, `solidity`, `swift`, `typescript`, `tsx`, `yaml`.
- **Search vs Replace**:
    - **`ast_grep_search`**: Finds matches and provides context lines.
    - **`ast_grep_replace`**: Performs structural rewriting. It supports a `dryRun` mode (default: true) to preview changes.

---

## Governance Tools

Governance tools ensure that agents follow project conventions and maintain synchronization with project management tools.

- **`linear_branch`**: Gets or generates the canonical branch name for a Linear issue (e.g., `feature/LIF-123-user-auth`). If Linear is unavailable, it generates a fallback name.
- **`linear_update_status`**: Updates a Linear issue's status (`todo`, `in_progress`, `in_review`, `done`, `canceled`) and optionally adds a progress comment.
- **`linear_create_issue`**: Creates new Linear issues directly from the agent conversation.
- **`read_context`**: Reads `project-context.yaml` to provide agents with knowledge of the tech stack, architecture, and coding standards.
- **`create_spec_folder`**: Initializes a standardized directory structure for new features (e.g., `LIF-123-feat-name/`), including templates for `spec.md`, `plan.md`, `tasks.md`, and `status.md`.

---

## Agent & Interactive Tools

### Agent Invocation

- **`call_omo_agent`**: Invokes specialized sub-agents like `explore` (for fast codebase mapping) or `librarian` (for documentation analysis).
    - **Synchronous**: Waits for the sub-agent to complete and returns its response.
    - **Background**: Launches the task asynchronously; results can be retrieved via `background_output`.
- **`look_at`**: Uses the `multimodal-looker` agent to analyze images, PDFs, or complex diagrams and extract specific information.

### Interactive Tools

- **`slashcommand`**: Executes predefined slash commands (e.g., `/commit`, `/plan`) by expanding them into detailed system prompts based on markdown files in `.opencode/command/` or `~/.config/opencode/command/`.
- **`skill`**: Loads and executes "skills"—reusable sets of instructions and references stored in `.claude/skills/`.
- **`interactive_bash`**: Executes commands via `tmux`, allowing for persistent sessions and background process management. It includes safety checks to block certain dangerous subcommands.

---

## Tool Creation Pattern

All tools follow a standardized structure using the `tool()` function from `@opencode-ai/plugin`.

```typescript
import { tool } from "@opencode-ai/plugin"

export const my_custom_tool = tool({
  description: "Clear description of what the tool does.",
  args: {
    param1: tool.schema.string().describe("Description of param1"),
    param2: tool.schema.number().optional().describe("Description of param2"),
  },
  execute: async (args, context) => {
    try {
      // Implementation logic
      return "Result string"
    } catch (e) {
      return `Error: ${e.message}`
    }
  }
})
```

## Integration with Hooks

Tools are deeply integrated with the [Hook System](/architecture/04-hook-system):
- **Governance**: Hooks like `governance-path-validator` and `governance-historian` monitor tool execution to ensure path discipline and maintain an audit trail.
- **Safety**: The `tool-output-truncator` hook automatically handles large outputs from tools like `grep` or `lsp_find_references` to prevent context window overflow.
- **Context**: The `rules-injector` and `directory-readme-injector` hooks provide tools with additional context about the files they are operating on.
