# Reference: executing-plans

## Codex Collaboration

本 Skill 与 Codex (via CodexMCP) 协作，分工如下:

- **Claude Code**: 重写为生产级代码、架构一致性审查
- **Codex**: 生成代码原型、逻辑正确性审查、bug 定位

### 调用时机

1. **编码前**: 向 Codex 请求代码原型 (unified diff patch)
2. **编码后**: 请求 Codex 审查代码改动

### 调用方式

```typescript
// 获取代码原型
mcp_codex_codex({
  PROMPT: "为 Task {taskId} 生成 unified diff patch，要求:\n1. 仅输出 diff，不实际修改\n2. {具体要求}",
  cd: "{项目根目录}",
  sandbox: "read-only",
  SESSION_ID: session.implementSession
})

// 代码审查
mcp_codex_codex({
  PROMPT: "请审查以下代码改动，检查逻辑正确性和潜在 bug:\n\n{diff 内容}",
  cd: "{项目根目录}",
  sandbox: "read-only",
  SESSION_ID: session.reviewSession
})
```

## Commit Message Format

```
[Task {id}] {brief description}

- {change 1}
- {change 2}

Risk-Tier: {0-3}
```

## Status File Format

`.fusion/status.json`:

```json
{
  "changeName": "feature-x",
  "startedAt": "2024-01-15T09:00:00Z",
  "tasks": {
    "1.1": {
      "status": "complete",
      "sha": "abc123def456",
      "message": "[Task 1.1] Add user model",
      "completedAt": "2024-01-15T10:30:00Z"
    },
    "1.2": {
      "status": "in-progress"
    }
  },
  "codexSessions": {
    "planningSession": "uuid-1",
    "implementSession": "uuid-2",
    "reviewSession": "uuid-3"
  }
}
```

## Best Practices

- One commit per task (or logical sub-unit)
- Run tests before committing
- Don't skip Codex review for Tier 2-3 tasks
- Keep prototype as reference, rewrite for production quality
- Use `sandbox: "read-only"` to prevent Codex from modifying files
