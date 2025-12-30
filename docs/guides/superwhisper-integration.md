---
title: "SuperWhisper Integration"
description: "Guide for integrating SuperWhisper voice-to-text with OpenCode and OmO plugin"
---

# SuperWhisper Integration Guide

This guide explains how to set up SuperWhisper for voice-driven development with OpenCode and the OmO plugin.

## Overview

[SuperWhisper](https://superwhisper.com) is an AI-powered voice-to-text application that can transform your spoken words into formatted text. When combined with OpenCode + OmO, it enables a powerful voice-driven coding workflow.

### Why Voice-Driven Development?

- **Speed**: Speak faster than you type (150 WPM vs 40 WPM average)
- **Accessibility**: Reduce strain from typing
- **Flow State**: Stay in your IDE while dictating
- **Natural Expression**: Describe what you want naturally

## Quick Start

### 1. Install SuperWhisper

Download from [superwhisper.com](https://superwhisper.com) (macOS, Windows, iOS)

### 2. Generate Your Mode

Run in OpenCode:

```
/superwhisper-mode create opencode-developer
```

This generates a custom SuperWhisper mode optimized for your project.

### 3. Import the Mode

1. Open SuperWhisper settings
2. Go to **Modes**
3. Click **Import Mode**
4. Select the generated JSON file from `.opencode/templates/superwhisper/`

### 4. Configure Context Awareness

Enable all three context types in the mode settings:

| Setting | Enable | Purpose |
|---------|--------|---------|
| Application Context | Yes | Captures current file/editor state |
| Selected Text | Yes | References highlighted code |
| Clipboard Context | Yes | Uses copied code for context |

## The OpenCode Developer Mode

We provide a pre-built SuperWhisper mode in `.opencode/templates/superwhisper/opencode-developer-mode.json`.

### Features

- **Command Detection**: Automatically maps spoken words to slash commands
- **Code Term Recognition**: "use state" becomes "useState"
- **Filler Word Removal**: Cleans up "um", "uh", "like", etc.
- **Context Integration**: References selected/copied code naturally

### Supported Intents

| Spoken Pattern | Detected Intent | Output Format |
|----------------|-----------------|---------------|
| "specify a feature..." | Command | `/specify [requirements]` |
| "plan the implementation..." | Command | `/plan` |
| "create tasks for..." | Command | `/tasks` |
| "implement/build/add..." | Implementation | Action description |
| "where is X / how does X work" | Question | Clear question |
| "find all uses of..." | Exploration | Search request |
| "review the code..." | Command | `/review [focus]` |
| "think through / analyze..." | Deep Analysis | `/try-hard [problem]` |

## Voice Prompting Best Practices

### 1. Start with Clear Intent

**Good:**
> "I want to specify a new authentication feature with OAuth"

**Less Clear:**
> "so like we need some auth stuff maybe OAuth"

### 2. Use Command Keywords

The mode recognizes these keywords and maps them to commands:

| Say This | Gets Mapped To |
|----------|----------------|
| "specify", "describe the feature" | `/specify` |
| "plan", "design", "architect" | `/plan` |
| "break down", "create tasks" | `/tasks` |
| "implement", "build", "code" | `/implement` |
| "review", "check" | `/review` |
| "test", "verify" | `/test` |
| "create PR", "pull request" | `/create-pr` |
| "think through", "analyze deeply" | `/try-hard` |
| "debug", "fix the issue" | `/debug-issue` |

### 3. Reference Context Naturally

**With Selected Code:**
> "refactor this code to use async await"

**With Clipboard:**
> "explain what I just copied"

**With Current File:**
> "add error handling to this function"

### 4. Be Specific About Scope

**Good:**
> "add input validation to the user registration form in the auth module"

**Vague:**
> "add some validation somewhere"

### 5. Chain Workflow Commands

> "let's start the workflow for payment processing - first specify the feature"

This naturally triggers the specify → plan → tasks → implement workflow.

## Advanced Configuration

### Custom Instructions

Customize the mode's AI instructions for your project:

```json
{
  "instructions": "<role>...</role>\n<context>\nProject: [YOUR_PROJECT]\nTech Stack: [YOUR_STACK]\n</context>\n..."
}
```

### Project-Specific Examples

Add examples that match your domain:

```json
{
  "examples": [
    {
      "input": "add a new GraphQL resolver for users",
      "output": "Create a new GraphQL resolver for the users query. Include pagination, filtering, and proper error handling."
    }
  ]
}
```

### Auto-Activation

Configure which apps trigger this mode:

```json
{
  "autoActivation": {
    "applications": ["Terminal", "VS Code", "Cursor"],
    "urls": []
  }
}
```

## Workflow Examples

### Example 1: Starting a New Feature

**Voice:**
> "okay let's specify a new feature for user notifications with email and push support"

**SuperWhisper Output:**
```
/specify Add user notifications system with email and push notification support
```

**OpenCode receives this and starts the /specify workflow**

### Example 2: Debugging

**Voice:**
> "there's a bug where the token expires too early can you debug that"

**SuperWhisper Output:**
```
/debug-issue Token expiration bug: tokens are expiring earlier than expected. Investigate the token TTL and refresh logic.
```

### Example 3: Code Review

**Voice:**
> "review my changes in the auth module focus on security"

**SuperWhisper Output:**
```
/review Focus on security vulnerabilities in the auth module changes.
```

### Example 4: Implementation

**Voice:**
> "add a loading spinner to the submit button that shows while the API call is in progress"

**SuperWhisper Output:**
```
Add a loading spinner to the submit button. Show spinner while API call is in progress, disable the button to prevent double-submission, and restore normal state on completion or error.
```

## Troubleshooting

### Voice Not Recognized Accurately

1. Speak clearly and at moderate pace
2. Use a quality microphone
3. Reduce background noise
4. Check SuperWhisper's voice model settings (try "large-v3" for best accuracy)

### Commands Not Detected

1. Use explicit command words ("specify", "plan", "review")
2. Start with "I want to..." for clearer intent
3. Check that the custom mode is selected in SuperWhisper

### Context Not Captured

1. Ensure context toggles are ON in mode settings
2. For Selected Text: Keep focus on the app with selection when recording
3. For Clipboard: Copy within 3 seconds of recording or during dictation

### Output Too Verbose

Adjust the mode's temperature:

```json
{
  "aiModel": {
    "temperature": 0.2
  }
}
```

Lower temperature = more concise, deterministic output.

## Tips for Power Users

### 1. Keyboard Shortcuts

Set up a global hotkey in SuperWhisper (e.g., `Option+Space`) for instant recording.

### 2. Mode Switching

Create multiple modes:
- **OpenCode Developer**: General development
- **OpenCode Reviewer**: Focused on code review
- **OpenCode Documenter**: Documentation writing

### 3. Alfred/Raycast Integration

SuperWhisper has Alfred and Raycast extensions for quick mode switching and recording.

### 4. Combine with Plan Mode

Use voice to describe problems, then switch OpenCode to Plan mode (`Tab`) for analysis:

> "switch to plan mode and analyze the performance of the database queries"

## Related Resources

- [Voice Prompting Best Practices](./voice-prompting.md)
- [Slash Commands Reference](../reference/commands.md)
- [Agent System Architecture](../architecture/02-agent-system.md)
- [SuperWhisper Official Docs](https://superwhisper.com/docs)
