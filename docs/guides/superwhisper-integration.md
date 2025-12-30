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

### 2. Generate and Install Your Mode

Run in OpenCode:

```
/superwhisper-mode create opencode-developer
```

This generates a custom SuperWhisper mode optimized for your project and installs it directly to your SuperWhisper directory (`~/Documents/superwhisper/modes/`). No manual import needed!

The command automatically:
- Detects your project type and tech stack
- Generates context-aware mode instructions
- Creates project-specific examples
- Installs to SuperWhisper device
- Registers the mode in settings

### 3. Activate Your Mode

1. Open SuperWhisper
2. Go to Settings → Modes
3. Your new mode should appear in the list (e.g., "OpenCode - oh-my-opencode")
4. Select it to make it active

### 4. Configure Context Awareness

Enable all three context types in the mode settings (these are enabled by default in generated modes):

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

## Managing Modes with /superwhisper-mode

The `/superwhisper-mode` command provides complete device management for SuperWhisper custom modes. All operations work directly with your local SuperWhisper installation.

### SuperWhisper Directory Structure

```
~/Documents/superwhisper/
├── modes/                    # Mode JSON files
│   ├── custom-ABCD.json     # Custom modes (4-char random key)
│   ├── default.json         # Built-in default mode
│   └── meeting.json         # Built-in meeting mode
└── settings/
    └── settings.json        # Contains modeKeys array (active modes)
```

### Available Operations

| Command | Description | Example |
|---------|-------------|---------|
| `list` | List all modes on device | `/superwhisper-mode list` |
| `create [name]` | Create and install new mode | `/superwhisper-mode create planning-mode` |
| `update [name]` | Update existing mode | `/superwhisper-mode update opencode-developer` |
| `delete [name]` | Remove mode from device | `/superwhisper-mode delete test-mode` |
| `export [name]` | Export mode to project | `/superwhisper-mode export opencode-developer` |
| `import` | Import mode from project | `/superwhisper-mode import` |

### list - List All Modes

Lists all SuperWhisper modes currently installed on your device.

```
/superwhisper-mode list
```

**Output:**
```
SuperWhisper Modes on Device:
─────────────────────────────
  custom-PSJF    Planning Mode
  custom-NBTW    OpenCode Developer
  default        Default
  meeting        Meeting Notes
─────────────────────────────
Total: 4 modes
```

### create - Create and Install Mode

Creates a new mode optimized for your project and installs it directly to SuperWhisper.

```
/superwhisper-mode create opencode-developer
```

The command automatically:
1. Reads project context (tech stack, frameworks, structure)
2. Discovers available slash commands
3. Generates a unique mode key (e.g., `custom-XKCD`)
4. Creates mode JSON with project-specific settings
5. Writes to `~/Documents/superwhisper/modes/{key}.json`
6. Updates `settings.json` to register the mode

**SuperWhisper Mode JSON Format:**

```json
{
  "key": "custom-XKCD",
  "name": "OpenCode - ProjectName",
  "description": "Project description",
  "type": "custom",
  "version": 1,
  
  "languageModelEnabled": true,
  "languageModelID": "sw-claude-4p5-sonnet",
  
  "contextFromActiveApplication": true,
  "contextFromSelection": true,
  "contextFromClipboard": true,
  "contextTemplate": "Use the context below to inform your response.\n\nContext: ",
  
  "activationApps": ["Terminal", "VS Code", "Cursor", "Zed"],
  "activationSites": [],
  
  "prompt": "ROLE: You are an AI post-processor...",
  "promptExamples": [
    {
      "id": "uuid-1",
      "input": "specify a new feature for user login",
      "output": "/specify Add user authentication feature"
    }
  ],
  
  "voiceModelID": "nvidia_parakeet-v2_476MB",
  "language": "en",
  "realtimeOutput": false,
  "adjustOutputVolume": true
}
```

**Key Fields:**

| Field | Purpose |
|-------|---------|
| `key` | Unique identifier (e.g., `custom-ABCD`) |
| `name` | Display name in SuperWhisper UI |
| `prompt` | AI instructions for transforming voice input |
| `promptExamples` | Training examples for intent detection |
| `contextFrom*` | Enable context sources (app, selection, clipboard) |
| `activationApps` | Apps that auto-activate this mode |
| `languageModelID` | AI model for post-processing |

### update - Update Existing Mode

Updates an existing mode with new settings or examples.

```
/superwhisper-mode update opencode-developer
```

You can update:
- Custom instructions (the `prompt` field)
- Training examples (`promptExamples`)
- Auto-activation apps (`activationApps`)
- Mode name

The command finds the mode by name, reads the current JSON, applies your requested changes, and writes it back.

### delete - Remove Mode

Removes a mode from your SuperWhisper installation.

```
/superwhisper-mode delete test-mode
```

This operation:
1. Removes the mode key from `settings.json`
2. Deletes the mode file from `~/Documents/superwhisper/modes/`

**Warning:** Built-in modes (default, meeting) cannot be deleted.

### export - Export to Project

Exports a mode from your device to the project repository for sharing.

```
/superwhisper-mode export opencode-developer
```

Copies the mode from `~/Documents/superwhisper/modes/{key}.json` to `.opencode/templates/superwhisper/{mode-name}.json`. This allows you to:
- Version control your custom modes
- Share modes with team members
- Transfer modes between machines

### import - Import from Project

Imports a mode from project templates to your device.

```
/superwhisper-mode import
```

The command:
1. Lists available mode templates in `.opencode/templates/superwhisper/`
2. Lets you select which to import
3. Generates a new unique key (if needed)
4. Installs to your SuperWhisper directory
5. Registers in settings

## Advanced Configuration

### Custom Instructions (Manual Editing)

For advanced customization, you can manually edit mode files in `~/Documents/superwhisper/modes/`. However, we recommend using `/superwhisper-mode update` for safer modifications.

Example prompt structure:

```json
{
  "prompt": "ROLE: You are an AI post-processor for voice-to-text.\n\nCONTEXT:\n- Project: [YOUR_PROJECT]\n- Tech Stack: [YOUR_STACK]\n\nPROCESSING RULES:\n1. Intent detection\n2. Command mapping\n3. Speech cleanup\n..."
}
```

### Project-Specific Examples

The `/superwhisper-mode create` command automatically generates examples based on your project type. For React projects:

```json
{
  "promptExamples": [
    {
      "id": "uuid-1",
      "input": "create a new component for the header",
      "output": "Create a Header component in src/components/Header.tsx with proper TypeScript types."
    },
    {
      "id": "uuid-2", 
      "input": "add a use state hook for loading",
      "output": "Add a useState hook to track loading state: const [isLoading, setIsLoading] = useState(false)"
    }
  ]
}
```

### Auto-Activation

Control which applications automatically activate your mode:

```json
{
  "activationApps": ["Terminal", "iTerm2", "Warp", "VS Code", "Cursor", "Zed"],
  "activationSites": []
}
```

When you focus one of these apps, SuperWhisper automatically switches to this mode.

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
