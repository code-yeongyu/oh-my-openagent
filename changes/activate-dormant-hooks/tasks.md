# Tasks: Activate Dormant Hooks

## Context

### Original Request
审查 hooks 发现 9 个未生效，需要激活它们。

### Design Reference
See `design.md` for full technical design.

---

## Work Objectives

### Core Objective
修复 3 个死代码 hooks，注册并激活 6 个未注册 hooks。

### Concrete Deliverables
- `src/index.ts` - 添加 hook 导入和调用
- `src/hooks/index.ts` - 导出新 hooks
- `src/hooks/planning-flow-guide/index.ts` - 修复事件名
- `src/config/schema.ts` - 添加新 hook 名称到 schema
- `src/hooks/AGENTS.md` - 更新文档

### Definition of Done
- [x] `bun run typecheck` 通过
- [x] `bun test` 通过 (559 pass, 11 pre-existing failures in prometheus-md-only)
- [x] 所有 9 个 hooks 可通过配置控制

### Must NOT Have (Guardrails)
- 不修改 hook 内部业务逻辑
- 不添加新功能
- 不破坏现有 hooks 的行为

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **User wants tests**: Manual verification (hooks 是运行时行为)
- **Framework**: bun test

### Manual Verification
每个 hook 激活后：
1. `bun run typecheck` → 无错误
2. `bun test` → 所有测试通过
3. 检查 hook 可通过 `disabled_hooks` 配置禁用

---

## Task Flow

```
Task 0 (hooks/index.ts 导出)
    ↓
Task 1-3 (并行: 修复死代码)
    ↓
Task 4-6 (并行: 激活高优先级)
    ↓
Task 7-10 (并行: 注册可选 hooks)
    ↓
Task 11 (schema 更新)
    ↓
Task 12 (文档更新)
    ↓
Task 13 (最终验证)
```

---

## TODOs

### Phase 0: 准备工作

- [x] 0. 导出新 hooks 从 hooks/index.ts

  **What to do**:
  - 在 `src/hooks/index.ts` 中添加缺失的导出：
    ```typescript
    export { createFailureCounterHook } from "./failure-counter"
    export { createSubagentVerificationHook } from "./subagent-verification"
    export { createBackgroundCompactionHook } from "./background-compaction"
    export { createCodebaseAssessmentHook } from "./codebase-assessment"
    export { createDebugInjectorHook } from "./debugging-injector"
    export { createLspDiagnosticsEnforcerHook } from "./lsp-diagnostics-enforcer"
    export { createPhaseFlowEnforcerHook } from "./phase-flow-enforcer"
    ```

  **Must NOT do**:
  - 不修改已有导出

  **Parallelizable**: NO (后续任务依赖)

  **References**:
  - `src/hooks/index.ts` - 现有导出模式

  **Acceptance Criteria**:
  - [x] 7 个新 hooks 全部导出
  - [x] `bun run typecheck` 通过

  **Commit**: YES (5efebc8)
  - Message: `feat(hooks): export dormant hooks from hooks/index.ts`
  - Files: `src/hooks/index.ts`

---

### Phase 1: 修复死代码 (3 hooks)

- [x] 1. 激活 skill-suggestion hook

  **What to do**:
  - 在 `src/index.ts` 的 `chat.message` 处理器中添加调用：
    ```typescript
    await skillSuggestion?.["chat.message"]?.(input, output);
    ```
  - 位置：在 `keywordDetector` 之后

  **Must NOT do**:
  - 不修改 hook 内部逻辑

  **Parallelizable**: YES (with 2, 3)

  **References**:
  - `src/hooks/skill-suggestion/index.ts:65-137` - chat.message 处理器
  - `src/index.ts:380` - keywordDetector 调用位置

  **Acceptance Criteria**:
  - [x] `skillSuggestion?.[\"chat.message\"]` 在 chat.message 链中被调用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 2, 3)

---

- [x] 2. 激活 planning-flow-guide hook

  **What to do**:
  - 修复 `src/hooks/planning-flow-guide/index.ts`:
    - 将 `PostToolUse` 重命名为 `"tool.execute.after"`
  - 在 `src/index.ts` 的 `tool.execute.after` 中添加调用：
    ```typescript
    await planningFlowGuide?.["tool.execute.after"]?.(input, output);
    ```

  **Must NOT do**:
  - 不修改处理器内部逻辑

  **Parallelizable**: YES (with 1, 3)

  **References**:
  - `src/hooks/planning-flow-guide/index.ts:47` - `PostToolUse` 需改为 `"tool.execute.after"`
  - `src/index.ts:612-628` - tool.execute.after 处理器

  **Acceptance Criteria**:
  - [x] 事件名修复为 `"tool.execute.after"`
  - [x] hook 在 tool.execute.after 链中被调用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 1, 3)

---

- [x] 3. 激活 tdd-guard hook (4 个生命周期)

  **What to do**:
  - 在 `src/index.ts` 添加 4 处调用：
    1. `chat.message`: `await tddGuard?.["chat.message"]?.(input, output);`
    2. `tool.execute.before`: `await tddGuard?.["tool.execute.before"]?.(input, output);`
    3. `tool.execute.after`: `await tddGuard?.["tool.execute.after"]?.(input, output);`
    4. `event`: `await tddGuard?.event(input);`

  **Must NOT do**:
  - 不修改 hook 内部逻辑
  - 默认配置保持 `enabled: false`

  **Parallelizable**: YES (with 1, 2)

  **References**:
  - `src/hooks/tdd-guard/index.ts:111-293` - 4 个处理器
  - `src/hooks/tdd-guard/constants.ts:12-21` - 默认配置 `enabled: false`

  **Acceptance Criteria**:
  - [x] 4 个生命周期全部有调用
  - [x] `bun run typecheck` 通过
  - [x] TDD Guard 默认禁用，需 `/tdd on` 启用

  **Commit**: YES (ef3e92b)
  - Message: `feat(hooks): activate dead code hooks (skill-suggestion, planning-flow-guide, tdd-guard)`
  - Files: `src/index.ts`, `src/hooks/planning-flow-guide/index.ts`
  - Pre-commit: `bun run typecheck`

---

### Phase 2: 激活高优先级 hooks (3 hooks)

- [x] 4. 注册并激活 failure-counter hook

  **What to do**:
  - 在 `src/index.ts` 添加：
    ```typescript
    import { createFailureCounterHook } from "./hooks";
    
    const failureCounter = isHookEnabled("failure-counter")
      ? createFailureCounterHook({ cwd: ctx.directory })
      : null;
    ```
  - 在 `tool.execute.before` 添加调用
  - 在 `tool.execute.after` 添加调用

  **Must NOT do**:
  - 不修改 hook 内部逻辑

  **Parallelizable**: YES (with 5, 6)

  **References**:
  - `src/hooks/failure-counter/index.ts:107-335` - hook 实现
  - `src/hooks/failure-counter/constants.ts:13-20` - 默认配置

  **Acceptance Criteria**:
  - [x] hook 在 tool.execute.before 和 tool.execute.after 中被调用
  - [x] 可通过 `disabled_hooks: ["failure-counter"]` 禁用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 5, 6)

---

- [x] 5. 注册并激活 subagent-verification hook

  **What to do**:
  - 在 `src/index.ts` 添加：
    ```typescript
    const subagentVerification = isHookEnabled("subagent-verification")
      ? createSubagentVerificationHook(ctx)
      : null;
    ```
  - 在 `tool.execute.after` 添加调用

  **Must NOT do**:
  - 不修改 hook 内部逻辑

  **Parallelizable**: YES (with 4, 6)

  **References**:
  - `src/hooks/subagent-verification/index.ts:14-55` - hook 实现

  **Acceptance Criteria**:
  - [x] hook 在 tool.execute.after 中被调用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 4, 6)

---

- [x] 6. 注册并激活 background-compaction hook

  **What to do**:
  - 在 `src/index.ts` 添加：
    ```typescript
    const backgroundCompaction = isHookEnabled("background-compaction")
      ? createBackgroundCompactionHook(backgroundManager)
      : null;
    ```
  - 在 `experimental.session.compacting` 添加调用（如果存在该处理器）
  - 如果不存在，添加新处理器

  **Must NOT do**:
  - 不修改 hook 内部逻辑

  **Parallelizable**: YES (with 4, 5)

  **References**:
  - `src/hooks/background-compaction/index.ts:19-85` - hook 实现
  - 依赖 `backgroundManager` 实例

  **Acceptance Criteria**:
  - [x] hook 在 experimental.session.compacting 中被调用
  - [x] `bun run typecheck` 通过

  **Commit**: YES (31d38a4)
  - Message: `feat(hooks): activate high-priority hooks (failure-counter, subagent-verification, background-compaction)`
  - Files: `src/index.ts`
  - Pre-commit: `bun run typecheck`

---

### Phase 3: 注册可选 hooks (4 hooks) - 默认禁用

- [x] 7. 注册 codebase-assessment hook (可选)

  **What to do**:
  - 在 `src/index.ts` 添加创建和调用
  - 在 `tool.execute.before` 添加调用

  **Parallelizable**: YES (with 8, 9, 10)

  **References**:
  - `src/hooks/codebase-assessment/index.ts:21-94`

  **Acceptance Criteria**:
  - [x] 可通过配置启用/禁用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 8, 9, 10)

---

- [x] 8. 注册 debugging-injector hook (可选)

  **What to do**:
  - 在 `src/index.ts` 添加创建和调用
  - 在 `tool.execute.before` 和 `tool.execute.after` 添加调用

  **Parallelizable**: YES (with 7, 9, 10)

  **References**:
  - `src/hooks/debugging-injector/index.ts:104-221`

  **Acceptance Criteria**:
  - [x] 可通过配置启用/禁用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 7, 9, 10)

---

- [x] 9. 注册 lsp-diagnostics-enforcer hook (可选)

  **What to do**:
  - 在 `src/index.ts` 添加创建和调用
  - 在 `tool.execute.after` 添加调用

  **Parallelizable**: YES (with 7, 8, 10)

  **References**:
  - `src/hooks/lsp-diagnostics-enforcer/index.ts:38-95`

  **Acceptance Criteria**:
  - [x] 可通过配置启用/禁用
  - [x] `bun run typecheck` 通过

  **Commit**: NO (groups with 7, 8, 10)

---

- [x] 10. 注册 phase-flow-enforcer hook (可选)

  **What to do**:
  - 在 `src/index.ts` 添加创建和调用
  - 在 `tool.execute.after` 添加调用

  **Parallelizable**: YES (with 7, 8, 9)

  **References**:
  - `src/hooks/phase-flow-enforcer/index.ts:14-104`

  **Acceptance Criteria**:
  - [x] 可通过配置启用/禁用
  - [x] `bun run typecheck` 通过

  **Commit**: YES (31d38a4)
  - Message: `feat(hooks): register optional hooks (codebase-assessment, debugging-injector, lsp-diagnostics-enforcer, phase-flow-enforcer)`
  - Files: `src/index.ts`
  - Pre-commit: `bun run typecheck`

---

### Phase 4: 配置与文档

- [x] 11. 更新 HookNameSchema

  **What to do**:
  - 在 `src/config/schema.ts` 的 `HookNameSchema` 中添加新 hook 名称：
    ```typescript
    "failure-counter",
    "subagent-verification", 
    "background-compaction",
    "codebase-assessment",
    "debugging-injector",
    "lsp-diagnostics-enforcer",
    "phase-flow-enforcer",
    ```

  **Parallelizable**: NO (依赖前面任务完成)

  **References**:
  - `src/config/schema.ts` - HookNameSchema 定义

  **Acceptance Criteria**:
  - [x] 所有 7 个新 hook 名称添加到 schema
  - [x] `bun run build:schema` 通过

  **Commit**: YES (31d38a4)
  - Message: `feat(config): add new hook names to HookNameSchema`
  - Files: `src/config/schema.ts`

---

- [x] 12. 更新 AGENTS.md 文档

  **What to do**:
  - 更新 `src/hooks/AGENTS.md`:
    - 修改 hook 总数 (31 → 38)
    - 添加新 hooks 到 STRUCTURE 部分
    - 添加新 hooks 到可配置列表

  **Parallelizable**: NO (依赖前面任务完成)

  **References**:
  - `src/hooks/AGENTS.md` - 现有文档

  **Acceptance Criteria**:
  - [x] 文档与代码同步
  - [x] 所有新 hooks 有说明

  **Commit**: YES (31d38a4)
  - Message: `docs(hooks): update AGENTS.md with newly activated hooks`
  - Files: `src/hooks/AGENTS.md`

---

- [x] 13. 最终验证

  **What to do**:
  - 运行完整验证：
    ```bash
    bun run typecheck
    bun run build
    bun test
    ```

  **Parallelizable**: NO (最后执行)

  **Acceptance Criteria**:
  - [x] `bun run typecheck` → 0 errors
  - [x] `bun run build` → 成功
  - [x] `bun test` → 559 pass (11 pre-existing failures in prometheus-md-only, unrelated)

  **Commit**: NO (验证任务)

---

## Commit Strategy

| After Task | Message | Files | Commit |
|------------|---------|-------|--------|
| 0 | `feat(hooks): export dormant hooks from hooks/index.ts` | `src/hooks/index.ts` | 5efebc8 |
| 3 | `feat(hooks): activate dead code hooks` | `src/index.ts`, `src/hooks/planning-flow-guide/index.ts` | ef3e92b |
| 6 | `feat(hooks): activate high-priority hooks` | `src/index.ts` | 31d38a4 |
| 10 | `feat(hooks): register optional hooks` | `src/index.ts` | 31d38a4 |
| 11 | `feat(config): add new hook names to schema` | `src/config/schema.ts` | 31d38a4 |
| 12 | `docs(hooks): update AGENTS.md` | `src/hooks/AGENTS.md` | 31d38a4 |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck  # Expected: 0 errors
bun run build      # Expected: success
bun test           # Expected: all pass
```

### Final Checklist
- [x] 9 个 hooks 全部可通过配置控制
- [x] 3 个高优先级 hooks 默认启用
- [x] 4 个可选 hooks 默认禁用
- [x] TDD Guard 通过 `/tdd on` 可启用
- [x] 文档与代码同步
- [x] 所有测试通过 (559 pass, 11 pre-existing failures unrelated to this plan)
