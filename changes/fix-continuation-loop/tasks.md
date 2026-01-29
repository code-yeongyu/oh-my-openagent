# Fix BOULDER/TODO CONTINUATION Infinite Loop

## Context

### Original Request
修复 session `ses_3fdc3723bffePl79UTDhkbP4Te` 中发现的无限循环问题：
- 40+ 次 `BOULDER CONTINUATION` 触发
- 7+ 次 `TODO CONTINUATION` 触发
- 7 次 compaction（最后 15 秒内连续 3 次）
- 任务状态卡在 32/33，1 个被 Bun segfault 阻塞

### Root Cause Analysis
1. **任务阻塞后仍触发 CONTINUATION**: AI 明确报告 "任务被阻塞，需要用户介入"，但系统忽略
2. **双重 CONTINUATION 注入**: `todo-continuation-enforcer.ts` 和 `atlas/index.ts` 同时触发
3. **无重试上限**: 同一任务可以无限重试
4. **无阻塞退出机制**: 检测到循环时没有暂停或用户干预选项

### Research Findings
- `todo-continuation-enforcer.ts` (897 行): 在 `session.idle` 事件时检测未完成任务并注入 TODO CONTINUATION
- `atlas/index.ts` (1005 行): 在 `session.idle` 事件时检测 boulder 状态并注入 BOULDER CONTINUATION
- 两者都有 compaction cooldown 检查，但没有阻塞状态检测
- 现有 `GIT_PUBLISH_KEYWORDS` 可作为阻塞检测的参考模式

---

## Work Objectives

### Core Objective
防止在任务被外部因素阻塞时，系统无限循环注入 CONTINUATION 指令。

### Concrete Deliverables
1. 阻塞检测机制 (`src/shared/blocked-task-detector.ts`)
2. 重试计数器 (`src/features/boulder-state/retry-tracker.ts`)
3. 修改后的 `todo-continuation-enforcer.ts`
4. 修改后的 `atlas/index.ts`
5. 单元测试文件

### Definition of Done
- [x] `bun test` 全部通过
- [x] 当 AI 报告 "blocked/无法继续/需要用户介入" 时，CONTINUATION 停止触发
- [x] 同一任务重试 3 次后自动标记为 blocked
- [x] BOULDER CONTINUATION 触发时跳过 TODO CONTINUATION

### Must Have
- 阻塞关键词检测 (blocked, 无法继续, 需要用户介入, segfault, cannot complete)
- 重试计数器 (每任务最多 3 次)
- 双重触发互斥机制
- 阻塞状态持久化到 boulder.json

### Must NOT Have (Guardrails)
- 不修改正常任务流程的行为
- 不删除现有的 compaction cooldown 逻辑
- 不破坏 `awaiting_user` 状态检测
- 不影响后台任务管理

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test, 100+ test files)
- **User wants tests**: YES (TDD)
- **Framework**: bun test

### TDD Workflow
每个任务遵循 RED-GREEN-REFACTOR：
1. **RED**: 写失败测试 → `bun test [file]` → FAIL
2. **GREEN**: 实现最小代码 → PASS
3. **REFACTOR**: 清理 → 保持 GREEN

---

## Task Flow

```
Task 1 (阻塞检测器) → Task 2 (重试计数器) → Task 3 (TODO enforcer修改)
                                          ↘ Task 4 (Atlas修改) 
Task 3,4 完成后 → Task 5 (互斥机制) → Task 6 (集成测试)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 3, 4 | 独立文件，可并行 |

| Task | Depends On | Reason |
|------|------------|--------|
| 3 | 1, 2 | 需要阻塞检测器和重试计数器 |
| 4 | 1, 2 | 需要阻塞检测器和重试计数器 |
| 5 | 3, 4 | 需要两个 enforcer 都修改完成 |
| 6 | 5 | 集成测试需要所有功能就位 |

---

## TODOs

- [x] 1. 创建阻塞任务检测器

  **What to do**:
  - 创建 `src/shared/blocked-task-detector.ts`
  - 实现 `isBlockedResponse(content: string): boolean`
  - 检测阻塞关键词：blocked, 无法继续, 需要用户介入, segfault, cannot complete, 被阻塞, remains blocked, still blocked, need user, requires user
  - 返回 true 当 AI 响应表明任务被阻塞

  **Must NOT do**:
  - 不误判正常的 "继续?" 提问
  - 不检测非阻塞的失败（如编译错误可修复）

  **Parallelizable**: NO (基础模块)

  **References**:
  - `src/hooks/todo-continuation-enforcer.ts:87-111` - `GIT_PUBLISH_KEYWORDS` 关键词检测模式
  - `src/hooks/todo-continuation-enforcer.ts:150-163` - `getAwaitingType` / `matchesContinuePattern` 模式
  - `.sisyphus/notepads/final-fixes/findings.md` - 实际阻塞案例 (Bun segfault)

  **Acceptance Criteria**:
  - [x] 测试文件 `src/shared/blocked-task-detector.test.ts` 创建
  - [x] `isBlockedResponse("任务被 Bun segfault 阻塞")` → true
  - [x] `isBlockedResponse("任务完成，继续下一个?")` → false
  - [x] `bun test src/shared/blocked-task-detector.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(shared): add blocked task detector for continuation loop prevention`
  - Files: `src/shared/blocked-task-detector.ts`, `src/shared/blocked-task-detector.test.ts`

---

- [x] 2. 创建重试计数器

  **What to do**:
  - 创建 `src/features/boulder-state/retry-tracker.ts`
  - 实现 `RetryTracker` 类：
    - `increment(taskId: string): number` - 增加重试次数，返回当前次数
    - `isMaxRetries(taskId: string, max?: number): boolean` - 检查是否达到上限（默认 3）
    - `reset(taskId: string): void` - 重置计数
    - `getBlockedTasks(): string[]` - 获取所有被阻塞的任务
  - 状态持久化到 `.sisyphus/retry-state.json`

  **Must NOT do**:
  - 不修改 boulder.json 结构（使用独立文件）
  - 不在内存中丢失状态（需持久化）

  **Parallelizable**: NO (基础模块)

  **References**:
  - `src/features/boulder-state/storage.ts` - boulder 状态存储模式
  - `src/hooks/todo-continuation-enforcer.ts:40-55` - `SessionState` 状态管理模式
  - `src/hooks/compaction-state.ts` - 跨 hook 共享状态模式

  **Acceptance Criteria**:
  - [x] 测试文件 `src/features/boulder-state/retry-tracker.test.ts` 创建
  - [x] `tracker.increment("task-1")` 返回 1, 2, 3...
  - [x] `tracker.isMaxRetries("task-1")` 在第 3 次后返回 true
  - [x] 状态在进程重启后保持（文件持久化）
  - [x] `bun test src/features/boulder-state/retry-tracker.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(boulder-state): add retry tracker for blocked task detection`
  - Files: `src/features/boulder-state/retry-tracker.ts`, `src/features/boulder-state/retry-tracker.test.ts`

---

- [x] 3. 修改 todo-continuation-enforcer 添加阻塞检测

  **What to do**:
  - 导入 `isBlockedResponse` 和 `RetryTracker`
  - 在 `session.idle` 处理中，检查最后一条 AI 响应是否包含阻塞关键词
  - 如果检测到阻塞，调用 `retryTracker.increment(currentTaskId)`
  - 如果达到重试上限，显示 toast 并跳过注入
  - 添加 `blockedTasksDetected` 状态到 `SessionState`

  **Must NOT do**:
  - 不删除现有的 `GIT_PUBLISH_KEYWORDS` 检测
  - 不修改 `CONTINUATION_PROMPT` 内容
  - 不影响正常完成的任务流程

  **Parallelizable**: YES (with 4)

  **References**:
  - `src/hooks/todo-continuation-enforcer.ts:530-571` - `awaiting_user` 检测模式（可复用）
  - `src/hooks/todo-continuation-enforcer.ts:700-728` - 消息获取和关键词检测
  - `src/shared/blocked-task-detector.ts` - 阻塞检测器（Task 1 产出）

  **Acceptance Criteria**:
  - [x] 当 AI 说 "任务被阻塞" 时，不注入 TODO CONTINUATION
  - [x] 重试 3 次后显示 toast "Task blocked after 3 retries"
  - [x] 正常任务流程不受影响
  - [x] `bun test src/hooks/todo-continuation-enforcer.test.ts` → PASS

  **Commit**: YES
  - Message: `fix(todo-enforcer): add blocked task detection to prevent infinite loop`
  - Files: `src/hooks/todo-continuation-enforcer.ts`, `src/hooks/todo-continuation-enforcer.test.ts`

---

- [x] 4. 修改 atlas hook 添加阻塞检测

  **What to do**:
  - 导入 `isBlockedResponse` 和 `RetryTracker`
  - 在 `session.idle` 处理中，检查最后一条 AI 响应
  - 如果检测到阻塞，增加重试计数
  - 如果达到重试上限，设置 boulder phase 为 `blocked` 并跳过注入
  - 在 `injectContinuation` 前检查重试状态

  **Must NOT do**:
  - 不删除现有的 `CONTINUATION_COOLDOWN_MS` 检测
  - 不修改 `BOULDER_CONTINUATION_PROMPT` 内容
  - 不影响 Phase 3 完成流程

  **Parallelizable**: YES (with 3)

  **References**:
  - `src/hooks/atlas/index.ts:652-750` - `session.idle` 处理逻辑
  - `src/hooks/atlas/index.ts:564-622` - `injectContinuation` 函数
  - `src/features/boulder-state/storage.ts` - phase 状态更新

  **Acceptance Criteria**:
  - [x] 当 AI 说 "任务被阻塞" 时，不注入 BOULDER CONTINUATION
  - [x] 重试 3 次后设置 boulder phase 为 `blocked`
  - [x] 正常 boulder 流程不受影响
  - [x] `bun test src/hooks/atlas/index.test.ts` → PASS

  **Commit**: YES
  - Message: `fix(atlas): add blocked task detection to prevent infinite continuation`
  - Files: `src/hooks/atlas/index.ts`, `src/hooks/atlas/index.test.ts`

---

- [x] 5. 添加双重触发互斥机制

  **What to do**:
  - 创建 `src/hooks/continuation-mutex.ts` 共享模块
  - 实现 `ContinuationMutex` 类：
    - `tryAcquire(sessionId: string, source: "boulder" | "todo"): boolean`
    - `release(sessionId: string): void`
    - `isHeldBy(sessionId: string): "boulder" | "todo" | null`
  - 在 atlas hook 和 todo-enforcer 中使用互斥锁
  - BOULDER 优先级高于 TODO

  **Must NOT do**:
  - 不造成死锁
  - 不阻塞正常的单一触发

  **Parallelizable**: NO (depends on 3, 4)

  **References**:
  - `src/hooks/compaction-state.ts` - 跨 hook 共享状态模式
  - `src/hooks/todo-continuation-enforcer.ts:826-832` - compaction 检测互斥示例

  **Acceptance Criteria**:
  - [x] 测试文件 `src/hooks/continuation-mutex.test.ts` 创建
  - [x] BOULDER 触发时，TODO 被跳过
  - [x] 单一触发正常工作
  - [x] `bun test src/hooks/continuation-mutex.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(hooks): add continuation mutex to prevent double injection`
  - Files: `src/hooks/continuation-mutex.ts`, `src/hooks/continuation-mutex.test.ts`

---

- [x] 6. 优化 observer-detector 提示显示

  **What to do**:
  - 修改 `src/hooks/observer-detector/index.ts`
  - 将 `console.warn` 改为 `log()` 函数（使用 `src/shared/logger.ts`）
  - 添加去重机制：同一消息在 30 秒内不重复显示
  - 添加配置选项 `observer_detector.log_level: "debug" | "warn" | "silent"`
  - 默认使用 "debug" 级别（不在输入框附近显示）

  **Must NOT do**:
  - 不删除检测逻辑本身
  - 不影响 L2 分析触发机制

  **Parallelizable**: YES (独立于其他任务)

  **References**:
  - `src/hooks/observer-detector/index.ts:30-41` - 当前 console.warn 调用
  - `src/hooks/observer-detector/detector.ts:51,75,91` - 警告消息生成
  - `src/shared/logger.ts` - 日志模块

  **Acceptance Criteria**:
  - [x] observer 警告不再阻挡输入框
  - [x] 同一警告 30 秒内不重复
  - [x] 可通过配置调整日志级别
  - [x] `bun test src/hooks/observer-detector/index.test.ts` → PASS

  **Commit**: YES
  - Message: `fix(observer-detector): reduce log noise and improve display location`
  - Files: `src/hooks/observer-detector/index.ts`, `src/hooks/observer-detector/index.test.ts`

---

- [x] 7. 集成测试和验证

  **What to do**:
  - 创建 `src/hooks/continuation-loop-prevention.test.ts` 集成测试
  - 测试场景：
    1. 正常任务完成 → CONTINUATION 正常触发
    2. AI 报告阻塞 → CONTINUATION 停止
    3. 重试 3 次 → 任务标记为 blocked
    4. BOULDER + TODO 同时触发 → 只有 BOULDER 生效
  - 运行全量测试确保无回归

  **Must NOT do**:
  - 不跳过任何现有测试
  - 不删除失败的测试

  **Parallelizable**: NO (depends on 5, 6)

  **References**:
  - `src/hooks/todo-continuation-enforcer.test.ts` - 现有测试模式
  - `src/hooks/atlas/index.test.ts` - atlas 测试模式

  **Acceptance Criteria**:
  - [x] 集成测试覆盖所有场景
  - [x] `bun test` 全量通过
  - [x] 无新增的 LSP 错误

  **Commit**: YES
  - Message: `test(hooks): add integration tests for continuation loop prevention`
  - Files: `src/hooks/continuation-loop-prevention.test.ts`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(shared): add blocked task detector` | blocked-task-detector.ts, *.test.ts | bun test |
| 2 | `feat(boulder-state): add retry tracker` | retry-tracker.ts, *.test.ts | bun test |
| 3 | `fix(todo-enforcer): add blocked detection` | todo-continuation-enforcer.ts, *.test.ts | bun test |
| 4 | `fix(atlas): add blocked detection` | atlas/index.ts, *.test.ts | bun test |
| 5 | `feat(hooks): add continuation mutex` | continuation-mutex.ts, *.test.ts | bun test |
| 6 | `test(hooks): add integration tests` | continuation-loop-prevention.test.ts | bun test |

---

## Success Criteria

### Verification Commands
```bash
bun test                           # Expected: all pass
bun test src/shared/blocked-task-detector.test.ts  # Expected: pass
bun test src/features/boulder-state/retry-tracker.test.ts  # Expected: pass
bun test src/hooks/continuation-mutex.test.ts  # Expected: pass
bun test src/hooks/continuation-loop-prevention.test.ts  # Expected: pass
```

### Final Checklist
- [x] AI 报告 "blocked" 时 CONTINUATION 停止
- [x] 重试 3 次后任务标记为 blocked
- [x] BOULDER + TODO 不会双重触发
- [x] 正常任务流程不受影响
- [x] 所有测试通过
- [x] 无 LSP 错误
