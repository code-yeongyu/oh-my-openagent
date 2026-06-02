---
name: rules
description: Use when the user asks about Codex Rules behavior, injected project rules, supported rule file locations, matching, or environment configuration.
---

# Codex Rules

Codex Rules is automatic once the plugin is enabled. It injects:

- static project instructions on `SessionStart` and `UserPromptSubmit`
- matching file-specific rules after Codex `apply_patch` by default

Dynamic `PostToolUse` output is injected as additional context and is deduplicated per plugin data session. Codex Rules does not rewrite tool output.

Supported project sources:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTEXT.md`
- `.sisyphus/rules/**/*.md`
- `.claude/rules/**/*.md`
- `.cursor/rules/**/*.md`
- `.github/instructions/**/*.md`
- `.github/copilot-instructions.md`

Supported environment knobs:

- `CODEX_RULES_DISABLED=1`
- `CODEX_RULES_MODE=both|static|dynamic|off`
- `CODEX_RULES_MAX_RULE_CHARS=<number>`
- `CODEX_RULES_MAX_RESULT_CHARS=<number>`
- `CODEX_RULES_ENABLED_SOURCES=AGENTS.md,.sisyphus/rules`

The legacy `PI_RULES_*` variables are accepted as fallbacks for users migrating from `pi-rules`.
