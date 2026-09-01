---
name: comment-checker
description: Use when Codex needs to understand or respond to automatic comment-checker feedback emitted after an edit-like PostToolUse hook.
---

# Codex Comment Checker

The plugin registers a `PostToolUse` hook for successful `apply_patch`, `write`, `edit`, `multi_edit`, and `multiedit` calls.

When comment-checker reports a warning after a patch, Codex receives blocking feedback and should fix or explain the flagged comment before moving on.

## Scope

- No MCP tool is exposed.
- Non-edit tools are ignored by this plugin.
- Missing checker binaries emit no hook output so normal Codex work can continue.
