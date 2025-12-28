---
title: "MCP Integration"
description: "Architecture and configuration of the Model Context Protocol (MCP) system in OhMyOpenCode."
---

# MCP Integration

The OhMyOpenCode (OMO) plugin leverages the **Model Context Protocol (MCP)** to integrate with external services and tools. This system allows OMO agents to access real-time documentation, search the web, and find code examples across public repositories.

## Overview

The MCP integration in OMO consists of two main parts:
1.  **Builtin MCPs**: A set of pre-configured remote MCP servers provided by the plugin.
2.  **Claude Code MCP Loader**: A compatibility layer that loads MCP configurations from standard Claude Code configuration files (`.mcp.json`).

## Builtin MCPs

OMO includes several builtin remote MCPs that are enabled by default. These provide essential capabilities for research and documentation lookup.

| MCP | URL | Purpose |
| :--- | :--- | :--- |
| `context7` | `https://mcp.context7.com/mcp` | Official library documentation and API references. |
| `websearch_exa` | `https://mcp.exa.ai/mcp?tools=web_search_exa` | Real-time web search powered by Exa AI. |
| `grep_app` | `https://mcp.grep.app` | Global GitHub code search via grep.app. |

### Disabling Builtin MCPs

Builtin MCPs can be disabled in the `oh-my-opencode.json` configuration file:

```json
{
  "disabled_mcps": ["websearch_exa"]
}
```

## Claude Code MCP Loader

To ensure compatibility with the wider Claude ecosystem, OMO automatically loads MCP configurations from `.mcp.json` files.

### Configuration Paths

The loader searches for configuration files in the following order (later paths override earlier ones if server names collide):

1.  **User**: `~/.claude/.mcp.json`
2.  **Project**: `./.mcp.json` (Project root)
3.  **Local**: `./.claude/.mcp.json` (Local project overrides)

### Environment Variable Expansion

OMO supports environment variable expansion within MCP configuration files. This is particularly useful for sensitive information like API keys.

**Supported Syntax:**
- `${VARIABLE_NAME}`: Expands to the value of the environment variable.
- `${VARIABLE_NAME:-default_value}`: Expands to the variable value, or a default if the variable is unset.

Example:
```json
"env": {
  "MY_API_KEY": "${MY_API_KEY}"
}
```

## MCP Server Configuration Format

OMO supports both `stdio` (local) and `http`/`sse` (remote) MCP servers. The configuration format follows the standard Claude Code structure.

### Local Server (stdio)
Used for running MCP servers locally via command line.

```json
{
  "mcpServers": {
    "my-local-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "env": {
        "SOME_KEY": "${SOME_KEY}"
      },
      "disabled": false
    }
  }
}
```

### Remote Server (http/sse)
Used for connecting to hosted MCP endpoints.

```json
{
  "mcpServers": {
    "my-remote-service": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MY_API_KEY}"
      }
    }
  }
}
```

## Integration Architecture

### Loading Process
1.  The plugin loads its own configuration (`oh-my-opencode.json`).
2.  Builtin MCPs are initialized, filtering out any listed in `disabled_mcps`.
3.  The `loadMcpConfigs()` function scans the standard paths for `.mcp.json` files.
4.  Configurations are transformed from Claude Code format to OMO's internal `McpServerConfig` format.
5.  All MCPs are merged into the final plugin configuration passed to OpenCode.

### Transformation Logic
The `transformMcpServer` utility handles the conversion:
- `http` or `sse` types are converted to `type: "remote"`.
- `stdio` types (or default) are converted to `type: "local"`, with the `command` and `args` combined into a single array.

## Usage by Agents

### Librarian Agent
The `librarian` agent is the primary consumer of the research-oriented MCPs (`context7`, `websearch_exa`, `grep_app`). It uses these to provide accurate technical information and code examples.
