# src/hooks/claude-code-hooks/ — Claude Code 兼容性

**生成时间:** 2026-05-15

## 概述

跨 19 个文件约 2110 行。提供 Claude Code settings.json 兼容层。解析 CC 权限规则并将 CC 钩子（PreToolUse、PostToolUse）映射到 OpenCode 钩子。

## 功能

1. 解析 Claude Code `settings.json` 权限格式
2. 将 CC 钩子类型映射到 OpenCode 事件类型
3. 执行 CC 权限规则（每工具允许/拒绝）
4. 支持 CC `.claude/settings.json` 和 `.claude/settings.local.json`

## CC → OPENCODE 钩子映射

| CC 钩子 | OpenCode 事件 |
|---------|---------------|
| PreToolUse | tool.execute.before |
| PostToolUse | tool.execute.after |
| Notification | event (session.idle) |
| Stop | event (session.idle) |

## 权限系统

CC 权限格式：
```json
{
  "permissions": {
    "allow": ["Edit", "Write"],
    "deny": ["Bash(rm:*)"]
  }
}
```

通过 shared/ 中的 permission-compat 转换为 OpenCode 工具限制。

## 文件

关键文件：`settings-loader.ts`（解析 CC 设置）、`hook-mapper.ts`（CC→OC 映射）、`permission-handler.ts`（规则执行）、`types.ts`（CC 类型定义）。
