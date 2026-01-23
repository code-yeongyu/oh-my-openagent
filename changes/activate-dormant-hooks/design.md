# Design: Activate Dormant Hooks

## Problem Statement

审查发现项目中存在 **9 个未生效的 hooks**：
- 3 个"死代码"：已创建实例但未在生命周期中调用
- 6 个"未注册"：代码完整但未在 index.ts 中导入和使用

这些 hooks 包含重要功能（TDD 强制、失败升级、Subagent 验证等），却从未执行。

## Root Cause Analysis

| 类别 | 原因 |
|------|------|
| 死代码 (3) | 创建了实例但忘记在生命周期处理器中添加调用 |
| 未注册 (6) | 开发中断，代码完成但未完成 index.ts 集成 |
| 事件名不匹配 | `planning-flow-guide` 使用 `PostToolUse` 而非 SDK 的 `tool.execute.after` |

## Solution Overview

### Phase 1: 修复死代码 (3 hooks)

| Hook | 修复方式 |
|------|----------|
| `skill-suggestion` | 在 `chat.message` 中添加调用 |
| `planning-flow-guide` | 修复事件名 + 在 `tool.execute.after` 中调用 |
| `tdd-guard` | 在 4 个生命周期中添加调用 |

### Phase 2: 激活高优先级 hooks (3 hooks)

| Hook | 激活范围 |
|------|----------|
| `failure-counter` | 仅主 Session (Sisyphus) |
| `subagent-verification` | 仅主 Session (Sisyphus) |
| `background-compaction` | 仅主 Session (Sisyphus) |

### Phase 3: 激活可选 hooks (3 hooks) - 默认禁用

| Hook | 激活范围 |
|------|----------|
| `codebase-assessment` | 仅主 Session |
| `debugging-injector` | 全局 (与 failure-counter 二选一) |
| `lsp-diagnostics-enforcer` | 全局 |
| `phase-flow-enforcer` | 仅主 Session |

### Phase 4: 配置与文档

- 更新 `HookNameSchema` 添加新 hook 名称
- 更新 `AGENTS.md` 文档同步实际状态
- 添加配置说明

## Scope

### IN Scope
- 修复 3 个死代码 hooks 的调用
- 注册并激活 3 个高优先级 hooks
- 注册 4 个可选 hooks (默认禁用)
- 更新配置 schema
- 更新文档

### OUT of Scope
- 修改 hook 内部逻辑
- 添加新功能
- 性能优化

## Technical Design

### 作用域分类

```
┌─────────────────────────────────────────────────────────────┐
│                    主 Session 专用                           │
│  skill-suggestion, planning-flow-guide, failure-counter,    │
│  subagent-verification, background-compaction,              │
│  codebase-assessment, phase-flow-enforcer                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    全局生效                                  │
│  tdd-guard, debugging-injector, lsp-diagnostics-enforcer   │
│  (作用于所有写代码的 agents)                                 │
└─────────────────────────────────────────────────────────────┘
```

### 激活顺序 (index.ts)

```typescript
// chat.message 链
await keywordDetector?.["chat.message"]?.(input, output);
await skillSuggestion?.["chat.message"]?.(input, output);  // NEW
await tddGuard?.["chat.message"]?.(input, output);         // NEW
// ...existing...

// tool.execute.before 链
// ...existing...
await tddGuard?.["tool.execute.before"]?.(input, output);  // NEW

// tool.execute.after 链
// ...existing...
await tddGuard?.["tool.execute.after"]?.(input, output);           // NEW
await planningFlowGuide?.["tool.execute.after"]?.(input, output);  // NEW
await failureCounter?.["tool.execute.after"]?.(input, output);     // NEW
await subagentVerification?.["tool.execute.after"]?.(input, output); // NEW
await lspDiagnosticsEnforcer?.["tool.execute.after"]?.(input, output); // NEW (optional)

// event 链
await tddGuard?.event(input);  // NEW
```

## Risks & Mitigations

| 风险 | 缓解措施 |
|------|----------|
| TDD Guard 阻断正常开发 | 默认 `enabled: false`，需显式启用 |
| Failure Counter 误判 | 5 分钟窗口 + 成功时重置 |
| 性能影响 | hooks 已有 early return 优化 |

## Success Criteria

- [ ] 所有 9 个 hooks 可通过配置启用
- [ ] 高优先级 3 个 hooks 默认启用
- [ ] TDD Guard 通过 `/tdd on` 可启用
- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过
- [ ] 文档与代码同步
