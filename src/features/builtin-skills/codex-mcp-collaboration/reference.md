# Reference: codex-mcp-collaboration

Codex MCP is advisory. Keep sandbox read-only and rewrite all implementations yourself.

## Tool Guardrails

- Required params: `PROMPT`, `cd` (repo root). Optional: `SESSION_ID` to continue a thread.
- Always set `sandbox: "read-only"`; ask for unified diff prototypes only.
- Capture and reuse `SESSION_ID` during the same effort.

## Prompts

### 1) Analysis refinement (after first-pass analysis)
```typescript
mcp_codex_codex({
  PROMPT: `User need: ${userNeed}
My first-pass plan: ${outline}
请完善需求分析，补充遗漏风险，并给出改进后的实施计划。只输出要点。`,
  cd: "C:/github/oh-my-opencode-update",
  sandbox: "read-only"
})
```

### 2) Prototype before coding (mandatory pre-implementation)
```typescript
mcp_codex_codex({
  PROMPT: `任务: ${taskSummary}
请给出代码实现原型（unified diff patch），包含必要测试。严禁实际修改代码，仅供参考。`,
  cd: "C:/github/oh-my-opencode-update",
  sandbox: "read-only",
  SESSION_ID: "${sessionId}"
})
```

### 3) Post-change review (immediately after coding)
```typescript
mcp_codex_codex({
  PROMPT: `请 review 代码改动是否满足需求并指出风险。
BASE_SHA: ${baseSha}
HEAD_SHA: ${headSha}
关注: 行为偏差、遗漏场景、性能/安全/并发隐患、测试缺口。`,
  cd: "C:/github/oh-my-opencode-update",
  sandbox: "read-only",
  SESSION_ID: "${sessionId}"
})
```

## Workflow Guardrails

- Trigger each call as soon as its condition is met; none are optional.
- Log Codex guidance; record what you accept or reject and why.
- If Codex conflicts with your judgment, prefer the safer, reasoned path and note the divergence.
