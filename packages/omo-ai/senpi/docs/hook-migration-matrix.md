# Senpi Hook Migration Matrix

This matrix accounts for every Codex hook JSON file in `packages/omo-codex/plugin/hooks`.

| Codex hook | Status | Senpi event | Component | Matcher | Reason |
| --- | --- | --- | --- | --- | --- |
| `post-compact-resetting-git-bash-mcp-reminder.json` | deferred | | git-bash | `manual\|auto` | Deferred until omo-ai declares a Senpi Git Bash MCP component surface and trust/install flow. |
| `post-compact-resetting-lsp-diagnostics-cache.json` | ported | PostCompact | lsp | `manual\|auto` | Senpi supports PostCompact command hooks. |
| `post-compact-resetting-project-rule-cache.json` | ported | PostCompact | rules | `manual\|auto` | Senpi supports PostCompact command hooks. |
| `post-tool-use-checking-codegraph-init-guidance.json` | deferred | | codegraph | `^(codegraph[._].*\|mcp__codegraph__.*)$` | Deferred until omo-ai declares a Senpi CodeGraph component/MCP surface. |
| `post-tool-use-checking-comments.json` | ported | PostToolUse | comment-checker | `^(apply_patch\|write\|Write\|edit\|Edit\|multi_edit\|multiedit\|MultiEdit)$` | Senpi supports PostToolUse command hooks with tool matchers. |
| `post-tool-use-checking-lsp-diagnostics.json` | ported | PostToolUse | lsp | `^(apply_patch\|write\|Write\|edit\|Edit\|multi_edit\|multiedit\|MultiEdit)$` | Senpi supports PostToolUse command hooks with tool matchers. |
| `post-tool-use-checking-thread-title-hygiene.json` | deferred | | teammode | `^(create_thread\|codex_app\\.create_thread)$` | Deferred because the matcher targets Codex thread tools that are not a Senpi hook/tool surface. |
| `post-tool-use-matching-project-rules.json` | ported | PostToolUse | rules | `^apply_patch$` | Senpi supports PostToolUse command hooks with tool matchers. |
| `pre-tool-use-enforcing-unlimited-goal-budget.json` | deferred | | ulw-loop | `^create_goal$` | Deferred because create_goal is a Codex goal-management tool surface, not a Senpi hook target. |
| `pre-tool-use-recommending-git-bash-mcp.json` | deferred | | git-bash | `^Bash$` | Deferred until omo-ai declares a Senpi Git Bash MCP component surface and install guidance. |
| `session-start-checking-auto-update.json` | deferred | | auto-update | `^startup$` | Deferred because omo-ai v1 must not implement installer/settings/trust behavior yet. |
| `session-start-checking-bootstrap-provisioning.json` | deferred | | bootstrap | | Deferred because omo-ai v1 must not implement installer/settings/trust behavior yet. |
| `session-start-checking-codegraph-bootstrap.json` | deferred | | codegraph | | Deferred until omo-ai declares a Senpi CodeGraph component/MCP surface. |
| `session-start-loading-project-rules.json` | ported | SessionStart | rules | | Senpi supports SessionStart command hooks. |
| `session-start-recording-session-telemetry.json` | ported | SessionStart | telemetry | | Senpi supports SessionStart command hooks. |
| `stop-checking-start-work-continuation.json` | ported | Stop | start-work-continuation | | Senpi supports Stop command hooks for top-level session completion. |
| `subagent-stop-checking-start-work-continuation.json` | unsupported-v1 | | start-work-continuation | | Senpi v1 explicitly does not support SubagentStop and this must not be emulated with Stop. |
| `subagent-stop-verifying-lazycodex-executor-evidence.json` | unsupported-v1 | | lazycodex-executor-verify | `^lazycodex-executor$` | Senpi v1 explicitly does not support SubagentStop and this must not be emulated with Stop. |
| `user-prompt-submit-checking-ultrawork-trigger.json` | ported | UserPromptSubmit | ultrawork | | Senpi supports UserPromptSubmit command hooks. |
| `user-prompt-submit-checking-ulw-loop-steering.json` | ported | UserPromptSubmit | ulw-loop | | Senpi supports UserPromptSubmit command hooks. |
| `user-prompt-submit-loading-project-rules.json` | ported | UserPromptSubmit | rules | | Senpi supports UserPromptSubmit command hooks. |
