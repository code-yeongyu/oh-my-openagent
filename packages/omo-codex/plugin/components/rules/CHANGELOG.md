# Changelog

## Unreleased

- Restrict the default `PostToolUse` hook matcher to Codex's canonical `apply_patch` tool name.
- Add opt-in `NODE_DEBUG=codex-rules` phase timing logs for `PostToolUse` debugging.
- Harden dynamic hook coverage for additional-context JSON output, disabled/static modes, failed tool responses, and duplicate suppression.
- Remove redundant apply_patch path scanning and stale tracked-tool constants.
- Use portable Codex hook interpolation and add package smoke coverage for hook entrypoints.
- Cap recursive rule directory scans and run CI on Windows in addition to Ubuntu and macOS.
- Replace the external glob matcher dependency with an internal matcher so clean Codex plugin installs run without `node_modules`.

## 0.1.0 - 2026-05-15

- Port `pi-rules` rule loading, matching, formatting, truncation, and deduplication to a Codex plugin.
- Add `SessionStart`, `UserPromptSubmit`, and `PostToolUse` hooks for static and file-specific context injection.
- Add persistent per-session deduplication under Codex plugin data.
- Add Codex-aware path extraction for read, write, edit, multi-edit, `apply_patch`, and shell command payloads.
- Add tests, CI, release workflow, marketplace metadata, and local install support.
