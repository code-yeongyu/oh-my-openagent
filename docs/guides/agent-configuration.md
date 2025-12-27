---
title: "Agent Configuration"
description: "Master guide for configuring all 24+ specialized agents in OhMyOpenCode."
---

# Agent Configuration

OhMyOpenCode features a powerful, multi-layered agent orchestration system. You can customize every aspect of the 24+ specialized agents—from the models they use to their specific tools and permissions.

## Quick Start

To override an agent's configuration, create or edit `oh-my-opencode.json` in your config directory.

```json
{
  "agents": {
    "oracle": {
      "model": "openai/o1-preview",
      "reasoning_effort": "high",
      "temperature": 1.0
    },
    "explore": {
      "tools": {
        "bash": false
      }
    },
    "frontend-ui-ux-engineer": {
      "disable": true
    }
  }
}
```

## Config Locations

Configuration is loaded from two locations, with the project-level config taking precedence:

1.  **Project**: `.opencode/oh-my-opencode.json` (Project root)
2.  **User**: `~/.config/opencode/oh-my-opencode.json` (Global)

## Configurable Agents

Below is a complete list of all agents available for configuration, grouped by their primary function.

### Core Agents

| Agent | Purpose | Default Model |
| :--- | :--- | :--- |
| `OmO` | **TEAM LEAD**: Primary orchestrator, plans and delegates. | `anthropic/claude-opus-4-5` |
| `OmO-Plan` | **Planning Specialist**: Handles obsessive planning phases. | `anthropic/claude-opus-4-5` |
| `oracle` | **Advisor**: Strategic technical guidance and code review. | `openai/gpt-5.2` |
| `librarian` | **Researcher**: External docs, GitHub, and OSS reference. | `opencode/grok-code` |
| `explore` | **Explorer**: Internal codebase semantic search. | `opencode/grok-code` |

### UI & Documentation

| Agent | Purpose | Default Model |
| :--- | :--- | :--- |
| `frontend-ui-ux-engineer`| Designer-turned-developer for stunning UI work. | `google/gemini-3-pro-preview` |
| `document-writer` | Technical writer for clear, comprehensive docs. | `google/gemini-3-flash-preview` |
| `multimodal-looker` | Visual analyst for PDFs, images, and diagrams. | `google/gemini-3-flash-preview` |
| `docs-publisher` | Site operation specialist (navigation, validation). | `anthropic/claude-sonnet-4-5` |

### Workflow Specialists

These agents power the core workflow commands like `/specify`, `/plan`, and `/tasks`.

| Agent | Purpose | Default Model |
| :--- | :--- | :--- |
| `product-strategist` | Requirements and user stories (`/specify`). | `anthropic/claude-sonnet-4-5` |
| `strategic-planner` | Architecture and technical plans (`/plan`). | `anthropic/claude-sonnet-4-5` |
| `task-planner` | Atomic task breakdown (`/tasks`). | `anthropic/claude-sonnet-4-5` |

### Implementation Specialists

| Agent | Purpose | Default Model |
| :--- | :--- | :--- |
| `implementation-specialist`| Manager for complex multi-domain tasks. | `google/gemini-3-flash-preview` |
| `backend-typescript` | TypeScript/Node.js specialist. | `google/gemini-3-flash-preview` |
| `frontend-react` | React and Next.js specialist. | `google/gemini-3-pro-preview` |
| `backend-rust` | Systems and high-performance Rust specialist. | `google/gemini-3-flash-preview` |
| `backend-python` | Data and Python backend specialist. | `google/gemini-3-flash-preview` |
| `mobile-xcode` | Native iOS/macOS (Swift/SwiftUI) specialist. | `google/gemini-3-pro-preview` |
| `mobile-react-native` | Cross-platform React Native specialist. | `google/gemini-3-pro-preview` |

### AI/ML & Cross-Cutting

| Agent | Purpose | Default Model |
| :--- | :--- | :--- |
| `ai-ml-expert` | RAG, LLM integration, DSPy/Agno specialist. | `google/gemini-3-flash-preview` |
| `agent-specialist` | Multi-agent system design specialist. | `google/gemini-3-flash-preview` |
| `context-learner` | Meta-learning extraction from sessions. | `anthropic/claude-opus-4-5` |
| `security-specialist` | Security audit and vulnerability specialist. | `google/gemini-3-flash-preview` |
| `test-specialist` | Unit, integration, and E2E testing specialist. | `google/gemini-3-flash-preview` |
| `optimization-specialist` | Performance profiling and tuning specialist. | `google/gemini-3-flash-preview` |

## Configuration Options

Each agent can be customized using the following fields in the `agents` object:

| Field | Type | Description |
| :--- | :--- | :--- |
| `model` | `string` | The model ID (e.g., `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`). |
| `temperature` | `number` | Sampling temperature (0.0 to 2.0). Default is typically `0.1` for specialists. |
| `top_p` | `number` | Nucleus sampling (0.0 to 1.0). |
| `max_tokens` | `number` | Maximum tokens to generate in a single response. |
| `maxSteps` | `number` | Maximum number of agentic iterations (tool-use loops). |
| `reasoning_effort`| `string` | For OpenAI o1/o3 models: `"low"`, `"medium"`, or `"high"`. |
| `prompt` | `string` | Override the entire system prompt for the agent. |
| `description` | `string` | Change how other agents see and use this agent. |
| `tools` | `object` | Enable/disable specific tools (e.g., `{ "bash": false }`). |
| `permission` | `object` | Set tool-specific permissions (`"allow"`, `"ask"`, `"deny"`). |
| `disable` | `boolean` | Completely disable the agent. |
| `mode` | `string` | Agent role: `"subagent"`, `"primary"`, or `"all"`. |
| `color` | `string` | Hex color for agent's UI elements (e.g., `"#FF0000"`). |

### Global Agent Settings

Beyond individual agent overrides, you can control agents globally in the root of `oh-my-opencode.json`:

| Field | Type | Description |
| :--- | :--- | :--- |
| `disabled_agents` | `string[]` | Array of agent names to completely disable. |
| `omo_agent` | `object` | Configure the OmO orchestrator (e.g., `{ "disabled": true }`). |

```json
{
  "disabled_agents": ["mobile-xcode", "mobile-react-native"],
  "omo_agent": {
    "disabled": false
  }
}
```

## Workflow Commands and Agents

OhMyOpenCode maps specific slash commands to specialized agents. Configuring these agents allows you to tune the behavior of the entire workflow.

| Command | Primary Agent | Purpose |
| :--- | :--- | :--- |
| `/specify` | `product-strategist` | Requirements gathering and spec writing. |
| `/plan` | `strategic-planner` | Architecture and implementation planning. |
| `/tasks` | `task-planner` | Decomposing plans into atomic tasks. |
| `/implement` | `implementation-specialist` | Feature implementation and manager coordination. |
| `/review` | `oracle` | Code review and architectural analysis. |
| `/test` | `test-specialist` | Unit and integration test generation. |

### Passthrough Parameters

Any additional fields added to the configuration are passed directly to the model provider. This allows you to use provider-specific features even if they aren't explicitly in the schema.

```json
{
  "agents": {
    "oracle": {
      "presence_penalty": 0.5,
      "frequency_penalty": 0.3
    }
  }
}
```

## Model-Specific Examples

### Anthropic (Claude)
Use `thinking` to enable Claude's extended thinking (for Opus 4.5 or Sonnet 3.7+).

```json
{
  "agents": {
    "OmO": {
      "model": "anthropic/claude-opus-4-5",
      "thinking": {
        "type": "enabled",
        "budget_tokens": 32000
      }
    }
  }
}
```

### OpenAI
Use `reasoning_effort` for o1 and o3 models.

```json
{
  "agents": {
    "oracle": {
      "model": "openai/o1-preview",
      "reasoning_effort": "high"
    }
  }
}
```

### Google (Gemini)
Gemini models often benefit from high `max_tokens` for long-form generation.

```json
{
  "agents": {
    "document-writer": {
      "model": "google/gemini-1.5-pro",
      "max_tokens": 8192
    }
  }
}
```

## Permissions and Safety

You can control agent behavior with fine-grained permissions:

```json
{
  "agents": {
    "implementation-specialist": {
      "permission": {
        "edit": "allow",
        "bash": {
          "git": "allow",
          "rm": "ask",
          "npm": "deny"
        },
        "webfetch": "ask",
        "external_directory": "deny"
      }
    }
  }
}
```

## Handling Unsupported Parameters

If you provide a parameter that the underlying model provider does not support, most providers will **silently ignore** it. No error will be thrown, but the parameter will have no effect.

## Use Case Examples

### High-Reasoning Advisor
Configure `oracle` to use OpenAI's o1 model with maximum reasoning effort for architectural reviews.

```json
{
  "agents": {
    "oracle": {
      "model": "openai/o1",
      "reasoning_effort": "high",
      "maxSteps": 1,
      "description": "Consult for complex architectural decisions only."
    }
  }
}
```

### Creative Frontend Engineer
Boost the `temperature` for the `frontend-ui-ux-engineer` to get more creative and varied design choices.

```json
{
  "agents": {
    "frontend-ui-ux-engineer": {
      "temperature": 1.2,
      "color": "#FF69B4"
    }
  }
}
```

### Restricted Exploration
Disable `bash` access for the `explore` agent to ensure it only uses `read`, `grep`, and `lsp` tools.

```json
{
  "agents": {
    "explore": {
      "tools": {
        "bash": false
      }
    }
  }
}
```

### Disable Unused Agents
Disable agents for platforms you aren't currently using to reduce the orchestrator's delegation options.

```json
{
  "disabled_agents": [
    "mobile-xcode",
    "mobile-react-native",
    "backend-rust"
  ]
}
```

## Reference Configuration

Here is a full reference configuration demonstrating various overrides.

```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  "disabled_agents": ["backend-rust"],
  "agents": {
    "OmO": {
      "model": "anthropic/claude-opus-4-5",
      "thinking": { "type": "enabled", "budget_tokens": 32000 }
    },
    "oracle": {
      "model": "openai/o1",
      "reasoning_effort": "high"
    },
    "frontend-ui-ux-engineer": {
      "model": "google/gemini-3-pro-preview",
      "temperature": 1.2
    },
    "explore": {
      "permission": {
        "bash": "deny"
      }
    },
    "test-specialist": {
      "disable": true
    }
  }
}
```
