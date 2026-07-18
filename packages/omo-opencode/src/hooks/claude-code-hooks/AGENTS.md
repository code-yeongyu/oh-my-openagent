# src/hooks/claude-code-hooks/ (Claude Code Compatibility)

**Generated:** 2026-07-17 (7d664b96b)

## OVERVIEW

~2850 LOC across 23 files. Claude Code `settings.json` compatibility layer. Parses CC hooks config and maps CC hook events (PreToolUse, PostToolUse, Stop, Notification, PreCompact, Session*) to OpenCode event handlers.

## WHAT IT DOES

1. Parses Claude Code `settings.json` hooks config (PreToolUse, PostToolUse, Stop, Notification, PreCompact, SessionStart/End, Subagent*, etc.) from `.claude/settings.json` and `.claude/settings.local.json` (`config.ts`)
2. Maps CC hook events to OpenCode event handlers (`claude-code-hooks-hook.ts`)
3. Dispatches CC hook commands (shell via zsh, or HTTP) and reads PermissionDecision / stop / suppress output (`dispatch-hook.ts`, `execute-http-hook.ts`)
4. Loads plugin extended config (`opencode-cc-plugin.json`) from plural OpenCode config dirs + project, merging `disabledHooks` (`config-loader.ts`)

## CC → OPENCODE HOOK MAPPING

| CC Hook | OpenCode Event |
|---------|---------------|
| PreToolUse | tool.execute.before |
| PostToolUse | tool.execute.after |
| Notification | event (session.idle) |
| Stop | event (session.idle) |

## PERMISSIONS & DISABLED HOOKS

- PreToolUse hooks return a `PermissionDecision` (`allow` / `deny` / `ask`); legacy `approve` / `block` are mapped. `permission_mode` (`default` / `plan` / `acceptEdits` / `bypassPermissions`) is forwarded to CC hooks.
- `disabledHooks` in `opencode-cc-plugin.json` disables specific hook commands by regex per event type. `config-loader.ts` `isHookCommandDisabled()` checks a command against the configured patterns.

```json
{
  "disabledHooks": {
    "PreToolUse": ["bash-forever", "^dangerous-"],
    "PostToolUse": ["telemetry"]
  }
}
```

## PLUGIN CONFIG LOADING

`config-loader.ts` loads `opencode-cc-plugin.json` from every OpenCode config dir returned by `getOpenCodeConfigDirs({ binary: "opencode" })` (plural), plus the project-local `.opencode/opencode-cc-plugin.json`. User dirs are merged in reverse order so later (custom) dirs override earlier (default) ones; project config overrides all. Only `disabledHooks` is merged. Result is cached 30s (`CONFIG_CACHE_TTL_MS`); the cache key includes `process.cwd()` and the joined user paths.

## FILES

| File | Purpose |
|------|---------|
| `claude-code-hooks-hook.ts` | `createClaudeCodeHooksHook()`: main factory, maps OpenCode events to CC handlers |
| `config.ts` | Parse CC `settings.json` hooks config from `.claude/` (matchers + hook actions) |
| `config-loader.ts` | Load `opencode-cc-plugin.json` (plural config dirs + project), merge `disabledHooks`, cache; `isHookCommandDisabled()` |
| `dispatch-hook.ts` | `dispatchHook()`: run a CC hook command (shell via zsh, or HTTP) |
| `execute-http-hook.ts` | Execute HTTP-type CC hooks |
| `plugin-config.ts` | `DEFAULT_CONFIG` (forceZsh, zshPath) |
| `pre-tool-use.ts` / `post-tool-use.ts` / `stop.ts` / `user-prompt-submit.ts` / `pre-compact.ts` | Per-event CC hook handlers |
| `handlers/` | OpenCode event handlers (tool-execute-before/after, chat-message, pre-compact, session-event) |
| `types.ts` | CC type definitions |
