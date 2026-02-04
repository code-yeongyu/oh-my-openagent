# collaborating-with-codex

A Claude Code **Agent Skill** that bridges Claude with OpenAI Codex CLI for multi-model collaboration on coding tasks.

## Overview

This Skill enables Claude to delegate coding tasks to Codex CLI, combining the strengths of multiple AI models. Codex handles algorithm implementation, debugging, and code analysis while Claude orchestrates the workflow and refines the output.

## Features

- **Multi-turn sessions**: Maintain conversation context across multiple interactions via `SESSION_ID`
- **Sandboxed execution**: Three security levels (`read-only`, `workspace-write`, `danger-full-access`)
- **JSON output**: Structured responses for easy parsing and integration
- **Image support**: Attach images to prompts for visual context
- **Cross-platform**: Windows path escaping handled automatically

## Installation

1. Ensure [Codex CLI](https://github.com/openai/codex) is installed and available in your PATH
2. Copy this Skill to your Claude Code skills directory:
   - User-level: `~/.claude/skills/collaborating-with-codex/`
   - Project-level: `.claude/skills/collaborating-with-codex/`

## Usage

### Basic

```bash
python scripts/codex_bridge.py --cd "/path/to/project" --PROMPT "Analyze the authentication flow"
```

### Multi-turn Session

```bash
# Start a session
python scripts/codex_bridge.py --cd "/project" --PROMPT "Review login.py for security issues"
# Response includes SESSION_ID

# Continue the session
python scripts/codex_bridge.py --cd "/project" --SESSION_ID "uuid-from-response" --PROMPT "Suggest fixes for the issues found"
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--PROMPT` | Yes | Task instruction |
| `--cd` | Yes | Workspace root directory |
| `--sandbox` | No | Security level: `read-only` (default), `workspace-write`, `danger-full-access` |
| `--SESSION_ID` | No | Resume a previous session |
| `--return-all-messages` | No | Include full reasoning trace in output |
| `--image` | No | Attach image files (comma-separated or repeated) |
| `--model` | No | Specify model (use only when explicitly requested) |
| `--yolo` | No | Bypass all approvals (use with caution) |

### Output Format

```json
{
  "success": true,
  "SESSION_ID": "uuid",
  "agent_messages": "Codex response text",
  "all_messages": []
}
```

## License

MIT License. See [LICENSE](LICENSE) for details.
