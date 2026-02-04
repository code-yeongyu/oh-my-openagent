# collaborating-with-gemini

A Claude Code **Agent Skill** that bridges Claude with Google Gemini CLI for multi-model collaboration on coding tasks.

## Overview

This Skill enables Claude to delegate coding tasks to Gemini CLI, combining the strengths of multiple AI models. Gemini handles algorithm implementation, debugging, and code analysis while Claude orchestrates the workflow and refines the output.

## Features

- **Multi-turn sessions**: Maintain conversation context across multiple interactions via `SESSION_ID`
- **Sandboxed execution**: Optional sandbox mode for isolated execution
- **JSON output**: Structured responses for easy parsing and integration
- **Cross-platform**: Windows path escaping handled automatically

## Installation

1. Ensure [Gemini CLI](https://github.com/google-gemini/gemini-cli) is installed and available in your PATH
2. Copy this Skill to your Claude Code skills directory:
   - User-level: `~/.claude/skills/collaborating-with-gemini/`
   - Project-level: `.claude/skills/collaborating-with-gemini/`

## Usage

### Basic

```bash
python scripts/gemini_bridge.py --cd "/path/to/project" --PROMPT "Analyze the authentication flow"
```

### Multi-turn Session

```bash
# Start a session
python scripts/gemini_bridge.py --cd "/project" --PROMPT "Review login.py for security issues"
# Response includes SESSION_ID

# Continue the session
python scripts/gemini_bridge.py --cd "/project" --SESSION_ID "uuid-from-response" --PROMPT "Suggest fixes for the issues found"
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--PROMPT` | Yes | Task instruction |
| `--cd` | Yes | Workspace root directory |
| `--sandbox` | No | Run in sandbox mode (default: off) |
| `--SESSION_ID` | No | Resume a previous session |
| `--return-all-messages` | No | Include full reasoning trace in output |
| `--model` | No | Specify model (use only when explicitly requested) |

### Output Format

```json
{
  "success": true,
  "SESSION_ID": "uuid",
  "agent_messages": "Gemini response text",
  "all_messages": []
}
```

## License

MIT License. See [LICENSE](LICENSE) for details.
