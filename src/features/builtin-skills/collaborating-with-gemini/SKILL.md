---
name: collaborating-with-gemini
description: Delegates coding tasks to Gemini CLI for prototyping, debugging, and code review. Use when needing algorithm implementation, bug analysis, or code quality feedback. Supports multi-turn sessions via SESSION_ID.
---

## When to Use This Skill

Trigger when any of these applies:
- You need a second opinion on code architecture or implementation
- You want to prototype algorithms or code snippets quickly
- You need debugging assistance or bug analysis
- You want code review feedback from a different AI model

## Not For / Boundaries

- Not for direct file modifications (Gemini runs in read-only mode by default)
- Not for tasks requiring real-time web access
- Required: `--cd` (workspace path) and `--PROMPT` (task description)

## Available Models

| Model ID | Strengths | Use Case |
|----------|-----------|----------|
| `gemini-3-pro-preview` | Strong coding ability, deep reasoning | Complex code review, architecture design, algorithm implementation |
| `gemini-3-flash-preview` | Fast response, cost-effective | Quick code checks, simple debugging, rapid prototyping |
| `gemini-2.5-pro` | Very low cost, decent capability | Budget-conscious tasks, simple code analysis |
| `gemini-2.5-flash` | Ultra-fast, minimal cost | Not recommended for coding tasks |
| `gemini-2.5-flash-lite` | Fastest, lowest cost | Not recommended for coding tasks |

**Recommendation:**
- **Default (no --model)**: Uses CLI's configured default model
- **Code review/architecture**: Use `gemini-3-pro-preview`
- **Quick checks/prototyping**: Use `gemini-3-flash-preview`
- **Budget mode**: Use `gemini-2.5-pro`

## Quick Start

```bash
# Default model (recommended for most cases)
python scripts/gemini_bridge.py --cd "/path/to/project" --PROMPT "Your task"

# Specify model explicitly
python scripts/gemini_bridge.py --cd "/path/to/project" --PROMPT "Your task" --model "gemini-3-pro-preview"
```

**Output:** JSON with `success`, `SESSION_ID`, `agent_messages`, and optional `error`.

## Parameters

```
usage: gemini_bridge.py [-h] --PROMPT PROMPT --cd CD [--sandbox] [--SESSION_ID SESSION_ID] [--return-all-messages] [--model MODEL]

Gemini Bridge

options:
  -h, --help            show this help message and exit
  --PROMPT PROMPT       Instruction for the task to send to gemini.
  --cd CD               Set the workspace root for gemini before executing the task.
  --sandbox             Run in sandbox mode. Defaults to `False`.
  --SESSION_ID SESSION_ID
                        Resume the specified session of the gemini. Defaults to empty string, start a new session.
  --return-all-messages
                        Return all messages (e.g. reasoning, tool calls, etc.) from the gemini session. Set to `False` by default, only the agent's final reply message is
                        returned.
  --model MODEL         The model to use for the gemini session. See Available Models section for valid options.
```

## Multi-turn Sessions

**Always capture `SESSION_ID`** from the first response for follow-up:

```bash
# Initial task
python scripts/gemini_bridge.py --cd "/project" --PROMPT "Analyze auth in login.py"

# Continue with SESSION_ID
python scripts/gemini_bridge.py --cd "/project" --SESSION_ID "uuid-from-response" --PROMPT "Write unit tests for that"
```

## Examples

### Example 1: Code Review with Gemini 3 Pro
- Input: Complex TypeScript file needing architecture review
- Steps:
  ```bash
  python scripts/gemini_bridge.py --cd "/project" --PROMPT "Review src/index.ts for architecture issues" --model "gemini-3-pro-preview"
  ```
- Expected output: Detailed code review with improvement suggestions

### Example 2: Quick Debugging with Gemini 3 Flash
- Input: Error message needing quick diagnosis
- Steps:
  ```bash
  python scripts/gemini_bridge.py --cd "/project" --PROMPT "Debug this error: TypeError at line 42" --model "gemini-3-flash-preview"
  ```
- Expected output: Fast diagnosis and fix suggestions

### Example 3: Budget Code Analysis
- Input: Simple code requiring basic analysis
- Steps:
  ```bash
  python scripts/gemini_bridge.py --cd "/project" --PROMPT "Explain what this function does" --model "gemini-2.5-pro"
  ```
- Expected output: Basic code explanation at minimal cost

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `ModelNotFoundError (404)` | Invalid model ID | Use exact model IDs from Available Models table |
| Cannot type in terminal | Vim mode enabled | Set `"vimMode": false` in `~/.gemini/settings.json` |
| `FileNotFoundError` | Gemini CLI not installed | Run `npm install -g @google/gemini-cli` |
| Empty `agent_messages` | Gemini performing tool call | Use `SESSION_ID` to continue conversation |

## Maintenance

- Sources: [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- Last updated: 2026-02-03
- Known limits: Model availability depends on Google account permissions
