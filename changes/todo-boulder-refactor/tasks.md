# Tasks: Todo/Boulder 任务追踪系统重构

## Context

**Goal**: 解耦 Todo 和 Boulder 两套任务追踪机制，实现会话级别隔离

**Key Decisions**:
1. Todo enforcer 只检测 OpenCode Todo API
2. Boulder 只对 session_ids 中的会话生效
3. 互斥机制按会话维度判断

---

## Phase 1: Todo Enforcer 纯净化

### Task 1.1: 移除 Todo Enforcer 对 Boulder 的依赖

**Description:**
修改 `todo-continuation-enforcer.ts`，移除对 `boulder.json` 的读取和依赖逻辑。

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.ts`

**What to do:**
1. 移除 `readBoulderState` 导入和调用
2. 移除 `readPlanProgress` 相关逻辑
3. 只使用 OpenCode Todo API (`ctx.client.session.todo()`) 获取任务列表
4. 保留 `isInCompactionCooldown` 检查（这是独立的冷却机制）

**What NOT to do:**
- 不要移除 continuation mutex 检查（这是互斥机制，需要保留）
- 不要改变 CONTINUATION_PROMPT 模板

**Acceptance Criteria:**
- [ ] `todo-continuation-enforcer.ts` 不再导入 `readBoulderState`
- [ ] `todo-continuation-enforcer.ts` 不再导入 `readPlanProgress`
- [ ] Todo enforcer 只通过 `ctx.client.session.todo()` 获取任务
- [ ] 现有测试通过

---

### Task 1.2: 更新 Todo Enforcer 测试

**Description:**
更新测试用例，移除与 Boulder 相关的测试场景。

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.test.ts`

**What to do:**
1. 移除涉及 `boulder.json` 的测试用例
2. 添加新测试：验证 Todo enforcer 只使用 Todo API
3. 保留 compaction cooldown 相关测试

**Acceptance Criteria:**
- [ ] 所有测试通过
- [ ] 无 Boulder 相关的 mock 或测试

---

## Phase 2: Boulder 会话隔离

### Task 2.1: 增强 Boulder 会话检查逻辑

**Description:**
修改 `atlas/index.ts`，确保 Boulder continuation 只对 `session_ids` 中的会话生效。

**Files:**
- Modify: `src/hooks/atlas/index.ts`

**What to do:**
1. 在 `session.idle` 处理中，检查 `boulderState.session_ids.includes(sessionID)`
2. 如果当前会话不在 `session_ids` 中，跳过 Boulder continuation
3. 添加日志记录被跳过的原因

**Acceptance Criteria:**
- [ ] 非 Boulder 会话不触发 Boulder continuation
- [ ] 日志清晰记录跳过原因
- [ ] `/start-work` 创建的会话正常工作

---

### Task 2.2: 优化互斥机制

**Description:**
修改互斥逻辑，使其按会话维度判断。

**Files:**
- Modify: `src/hooks/continuation-mutex.ts`
- Modify: `src/hooks/todo-continuation-enforcer.ts`

**What to do:**
1. 互斥检查时，只有当前会话在 Boulder 的 `session_ids` 中时，才让 Todo 让位
2. 其他会话的 Todo continuation 正常工作，不受 Boulder 影响

**Acceptance Criteria:**
- [ ] Boulder 会话：Todo 让位给 Boulder
- [ ] 非 Boulder 会话：Todo 正常工作
- [ ] 互斥机制日志清晰

---

## Phase 3: 验证与清理

### Task 3.1: 端到端测试

**Description:**
手动验证整个流程。

**What to do:**
1. 测试场景 A：新会话使用 todowrite，验证 continuation 正常
2. 测试场景 B：运行 /start-work，验证 Boulder 只在当前会话生效
3. 测试场景 C：Boulder 会话 + 新会话并行，验证互不干扰

**Acceptance Criteria:**
- [ ] 场景 A 通过
- [ ] 场景 B 通过
- [ ] 场景 C 通过

---

### Task 3.2: 构建验证

**Description:**
确保代码质量。

**What to do:**
1. `bun run typecheck` - 0 错误
2. `bun test` - 全部通过
3. `bun run build` - 构建成功

**Acceptance Criteria:**
- [ ] typecheck 通过
- [ ] 测试通过
- [ ] 构建成功

---

## Legend

- `[ ]` = Pending
- `[x]` = Complete
- `[~]` = In Progress

## Dependencies

```
Task 1.1 → Task 1.2 (测试依赖实现)
Task 2.1 → Task 2.2 (互斥依赖会话隔离)
Task 1.2 + Task 2.2 → Task 3.1 (端到端依赖所有实现)
Task 3.1 → Task 3.2 (构建验证在最后)
```
