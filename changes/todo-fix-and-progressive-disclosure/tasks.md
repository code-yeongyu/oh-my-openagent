# Tasks: TODO Bug Fix + Progressive-Disclosure Integration

## Context

### Original Request
用户反馈三个问题：
1. TODO CONTINUATION 在没有激活任务时仍然触发
2. 希望将 progressive-disclosure-md skill 集成为内置功能
3. prometheus-md-only hook 只允许写入 `changes/` 目录，应该也允许 `.sisyphus/`

### Interview Summary
- **变更 1**: 无 task + 无 todo 时完全停止；有 todo 时继续提醒
- **变更 2**: >200 words 时激活，强制性集成

### Metis Review
- Gate `readPlanProgress()` behind `boulderState?.active_plan`
- Mirror existing builtin skill pattern from `src/features/builtin-skills/mdsel/`
- Define size thresholds clearly (200 words)

---

## Work Objectives

### Core Objective
修复 TODO CONTINUATION bug 并集成 progressive-disclosure-md 作为内置强制 skill

### Concrete Deliverables
- 修复后的 `src/hooks/todo-continuation-enforcer.ts`
- 新建 `src/features/builtin-skills/progressive-disclosure-md/` 目录
- 新建 `src/hooks/mdsel-enforcer/` hook
- 更新 `src/config/schema.ts` 配置项
- 完整测试覆盖

### Definition of Done
- [x] `bun test` 全部通过
- [x] 无 boulder 时不触发 tasks.md 扫描
- [x] 读取 >200 words 的 .md 时被阻止
- [x] 写入 .md 时强制 outline 工作流

### Must Have
- Bug 修复：boulder 检查逻辑
- Skill 集成：SKILL.md + CLI 复制
- Hook 实现：PreToolUse 阻止逻辑
- 配置项：enabled, minWords

### Must NOT Have (Guardrails)
- 不修改 mdsel CLI 本身
- 不修改 boulder-state 模块
- 不修改其他 hook 的行为
- 不添加新的 MCP 服务器
- 不修改 OpenCode TODO API 检查逻辑

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **User wants tests**: TDD
- **Framework**: bun test

### TDD Workflow
每个任务遵循 RED-GREEN-REFACTOR:
1. 写失败测试 → `bun test` → FAIL
2. 实现最小代码 → PASS
3. 重构清理 → 仍然 PASS

---

## Task Flow

```
Phase 0: Prometheus Hook Fix (前置修复)
  0.1

Phase 1: Bug Fix (变更 1)
  1.1 → 1.2 → 1.3 → 1.4

Phase 2: Skill Integration (变更 2)
  2.1 → 2.2 → 2.3 (parallel: 2.4, 2.5) → 2.6 → 2.7

Phase 3: Verification
  3.1 → 3.2
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2.4, 2.5 | 独立的 hook 和 skill 注册 |

| Task | Depends On | Reason |
|------|------------|--------|
| 1.2 | 1.1 | 需要先写测试 |
| 2.3 | 2.2 | 需要先复制 SKILL.md |
| 2.6 | 2.4, 2.5 | 需要 hook 和 skill 都就位 |

---

## TODOs

### Phase 0: 统一路径规范修复 (前置修复) `completed`

- [x] 0.1 统一所有 `.sisyphus/` 路径引用到 `changes/`

  **What to do**:
  系统中存在两套路径约定的不一致，需要统一到 `changes/` 目录：
  
  **需要修改的文件** (~35 处引用):
  1. `src/agents/prometheus-prompt.ts` - 将 `.sisyphus/drafts/` 改为去除或改为 `changes/` 内的草稿概念
  2. `src/agents/prometheus-prompt.ts` - 将 `.sisyphus/plans/` 改为 `changes/<name>/tasks.md`
  3. `src/agents/momus.ts` - 将 `.sisyphus/plans/` 改为 `changes/*/tasks.md`
  4. `src/agents/sisyphus-junior.ts` - 将 `.sisyphus/plans/` 改为 `changes/`
  5. `src/features/boulder-state/storage.ts` - 移除 `.sisyphus/plans/` 优先级，只使用 `changes/`
  6. `src/features/boulder-state/constants.ts` - 移除或更新 `PROMETHEUS_PLANS_DIR`
  7. `src/hooks/keyword-detector/constants.ts` - 更新路径引用
  8. `src/hooks/prometheus-md-only/constants.ts` - 更新工作流说明中的路径
  9. `src/hooks/sisyphus-junior-notepad/constants.ts` - 更新路径引用
  10. `src/hooks/start-work/index.ts` - 确认只搜索 `changes/`

  **正确的目录结构** (根据 creating-changes skill):
  ```
  changes/
  ├── <change-name>/           # 复杂任务
  │   ├── proposal.md
  │   ├── design.md
  │   ├── tasks.md
  │   ├── findings.md
  │   └── progress.md
  └── quick-plans/             # 快速/简单任务
      └── <name>.md
  ```

  **Must NOT do**:
  - 不修改 `prometheus-md-only` 的 `ALLOWED_PATH_PREFIXES`（它已经正确限制为 `changes/`）
  - 不创建 `.sisyphus/` 目录
  - 不破坏现有的 `changes/` 目录结构

  **Parallelizable**: NO (前置任务，影响范围大)

  **References**:
  - `src/features/builtin-skills/creating-changes/SKILL.md` - 正确的目录规范
  - `src/agents/prometheus-prompt.ts` - 主要修改点
  - `src/agents/momus.ts` - 主要修改点
  - `src/features/boulder-state/storage.ts` - 搜索逻辑修改点

  **Acceptance Criteria**:
  - [x] 所有 `.sisyphus/drafts/` 引用已移除或更新
  - [x] 所有 `.sisyphus/plans/` 引用已改为 `changes/*/tasks.md`
  - [x] `bun run typecheck` → PASS
  - [x] `bun test` → PASS
  - [x] Prometheus 工作流文档与实际行为一致

  **Commit**: YES
  - Message: `fix(agents): unify plan paths to changes/ directory (remove .sisyphus/ references)`
  - Files: 多个文件
  - Pre-commit: `bun test`

---

### Phase 1: TODO CONTINUATION Bug Fix `completed`

- [x] 1.1 编写 todo-continuation-enforcer 测试用例

  **What to do**:
  - 创建测试文件或在现有测试中添加用例
  - 测试场景：boulderState = null 时不调用 readPlanProgress
  - 测试场景：有 OpenCode TODO 但无 boulder 时仍触发
  - 测试场景：有 boulder 时正常工作

  **Must NOT do**:
  - 不修改现有通过的测试
  - 不测试 boulder-state 模块本身

  **Parallelizable**: NO (first task)

  **References**:
  - `src/hooks/todo-continuation-enforcer.ts:L572-L586` - 需要修复的 planProgress 调用
  - `src/hooks/todo-continuation-enforcer.ts:L737` - 需要修复的 hasIncomplete 判断
  - `src/hooks/todo-continuation-enforcer.test.ts` - 现有测试文件

  **Acceptance Criteria**:
  - [x] 测试文件创建/更新
  - [x] `bun test todo-continuation` → FAIL (测试存在但实现未修复)

  **Commit**: NO (groups with 1.2)

---

- [x] 1.2 修复 planProgress 调用条件

  **What to do**:
  - 在 L572 处添加 `boulderState?.active_plan` 检查
  - 修改代码：`const planProgress = boulderState?.active_plan ? readPlanProgress(ctx.directory) : null`

  **Must NOT do**:
  - 不改变函数签名
  - 不修改 readPlanProgress 函数本身

  **Parallelizable**: NO (depends on 1.1)

  **References**:
  - `src/hooks/todo-continuation-enforcer.ts:L520-L524` - boulderState 读取位置
  - `src/hooks/todo-continuation-enforcer.ts:L572` - 修复点
  - `src/features/plan-progress-reader/reader.ts:L141-L146` - readPlanProgress 实现

  **Acceptance Criteria**:
  - [x] 代码修改完成
  - [x] `bun test todo-continuation` → PASS

  **Commit**: YES
  - Message: `fix(hooks): gate planProgress behind active boulder check`
  - Files: `src/hooks/todo-continuation-enforcer.ts`
  - Pre-commit: `bun test todo-continuation`

---

- [x] 1.3 修复 hasIncomplete 判断逻辑

  **What to do**:
  - 在 L737 处修改判断逻辑
  - 修改代码：`const hasIncomplete = apiIncompleteCount > 0 || (boulderState?.active_plan && fileIncompleteCount > 0)`

  **Must NOT do**:
  - 不改变 apiIncompleteCount 的计算逻辑

  **Parallelizable**: NO (depends on 1.2)

  **References**:
  - `src/hooks/todo-continuation-enforcer.ts:L735-L737` - 修复点
  - `src/hooks/todo-continuation-enforcer.ts:L725-L732` - apiIncompleteCount 计算

  **Acceptance Criteria**:
  - [x] 代码修改完成
  - [x] `bun test todo-continuation` → PASS

  **Commit**: YES
  - Message: `fix(hooks): only use fileIncompleteCount when boulder is active`
  - Files: `src/hooks/todo-continuation-enforcer.ts`
  - Pre-commit: `bun test todo-continuation`

---

- [x] 1.4 验证 Bug 修复完整性

  **What to do**:
  - 运行完整测试套件
  - 手动验证：创建 tasks.md 但不激活 boulder，确认不触发

  **Must NOT do**:
  - 不跳过任何测试

  **Parallelizable**: NO (depends on 1.3)

  **References**:
  - `src/hooks/todo-continuation-enforcer.test.ts` - 测试文件
  - `src/features/boulder-state/storage.ts` - boulder 状态读取

  **Acceptance Criteria**:
  - [x] `bun test` → 全部 PASS
  - [x] 手动验证通过

  **Commit**: NO (verification only)

---

### Phase 2: Progressive-Disclosure-MD Integration `completed`

- [x] 2.1 创建 builtin skill 目录结构

  **What to do**:
  - 创建 `src/features/builtin-skills/progressive-disclosure-md/` 目录
  - 创建 index.ts 导出文件

  **Must NOT do**:
  - 不复制完整 CLI 代码（复用现有 mdsel CLI）

  **Parallelizable**: NO (first task in phase)

  **References**:
  - `src/features/builtin-skills/mdsel/` - 现有结构参考
  - `src/features/builtin-skills/index.ts` - 导出注册点

  **Acceptance Criteria**:
  - [x] 目录创建
  - [x] index.ts 存在

  **Commit**: NO (groups with 2.2)

---

- [x] 2.2 复制并适配 SKILL.md

  **What to do**:
  - 从 `~/.claude/skills/progressive-disclosure-md/SKILL.md` 复制内容
  - 适配路径为 builtin skill 路径
  - 添加强制性集成说明

  **Must NOT do**:
  - 不修改 skill 的核心功能描述
  - 不删除重要的工作流规则

  **Parallelizable**: NO (depends on 2.1)

  **References**:
  - `~/.claude/skills/progressive-disclosure-md/SKILL.md` - 源文件
  - `src/features/builtin-skills/mdsel/SKILL.md` - 格式参考

  **Acceptance Criteria**:
  - [x] SKILL.md 创建
  - [x] 路径已适配

  **Commit**: YES
  - Message: `feat(skills): add progressive-disclosure-md builtin skill`
  - Files: `src/features/builtin-skills/progressive-disclosure-md/`
  - Pre-commit: `bun run typecheck`

---

- [x] 2.3 创建 mdsel-enforcer hook 骨架

  **What to do**:
  - 创建 `src/hooks/mdsel-enforcer/` 目录
  - 创建 index.ts, types.ts, constants.ts
  - 定义 MIN_WORDS = 200 常量

  **Must NOT do**:
  - 不实现完整逻辑（先写测试）

  **Parallelizable**: NO (depends on 2.2)

  **References**:
  - `src/hooks/comment-checker/` - hook 结构参考
  - `src/hooks/prometheus-md-only/` - PreToolUse block 模式参考

  **Acceptance Criteria**:
  - [x] 目录结构创建
  - [x] 常量定义完成
  - [x] `bun run typecheck` → PASS

  **Commit**: NO (groups with 2.4)

---

- [x] 2.4 实现 mdsel-enforcer PreToolUse 逻辑

  **What to do**:
  - 实现 Read 工具的 PreToolUse 检查
  - 检测 .md 文件且 >200 words 时返回 block
  - 实现 Write 工具的 Outline 工作流检查

  **Must NOT do**:
  - 不阻止小型 .md 文件
  - 不阻止非 .md 文件

  **Parallelizable**: YES (with 2.5)

  **References**:
  - `src/hooks/prometheus-md-only/index.ts` - block 返回模式
  - `src/hooks/comment-checker/index.ts` - 文件内容检查模式

  **Acceptance Criteria**:
  - [x] PreToolUse 逻辑实现
  - [x] `bun test mdsel-enforcer` → PASS

  **Commit**: YES
  - Message: `feat(hooks): implement mdsel-enforcer PreToolUse blocking`
  - Files: `src/hooks/mdsel-enforcer/`
  - Pre-commit: `bun test mdsel-enforcer`

---

- [x] 2.5 注册 skill 到 skills.ts

  **What to do**:
  - 在 `src/features/builtin-skills/skills.ts` 中添加 progressive-disclosure-md
  - 确保正确的 scope 和优先级

  **Must NOT do**:
  - 不修改其他 skill 的定义

  **Parallelizable**: YES (with 2.4)

  **References**:
  - `src/features/builtin-skills/skills.ts:L1-L100` - 现有 skill 注册模式
  - `src/features/builtin-skills/types.ts` - 类型定义

  **Acceptance Criteria**:
  - [x] Skill 注册完成
  - [x] `bun run typecheck` → PASS

  **Commit**: YES
  - Message: `feat(skills): register progressive-disclosure-md in skills.ts`
  - Files: `src/features/builtin-skills/skills.ts`
  - Pre-commit: `bun run typecheck`

---

- [x] 2.6 添加配置项到 schema.ts

  **What to do**:
  - 在 `src/config/schema.ts` 添加 progressive-disclosure 配置
  - 添加 enabled, minWords, enforceOutlineWorkflow 选项

  **Must NOT do**:
  - 不修改现有配置项
  - 不破坏 schema 兼容性

  **Parallelizable**: NO (depends on 2.4, 2.5)

  **References**:
  - `src/config/schema.ts` - 现有配置结构
  - `src/config/types.ts` - 类型导出

  **Acceptance Criteria**:
  - [x] 配置项添加
  - [x] `bun run build:schema` → PASS
  - [x] `bun run typecheck` → PASS

  **Commit**: YES
  - Message: `feat(config): add progressive-disclosure skill configuration`
  - Files: `src/config/schema.ts`
  - Pre-commit: `bun run build:schema && bun run typecheck`

---

- [x] 2.7 注册 hook 到 index.ts

  **What to do**:
  - 在 `src/hooks/index.ts` 注册 mdsel-enforcer hook
  - 添加到 PreToolUse 执行链

  **Must NOT do**:
  - 不修改执行顺序中的其他 hook

  **Parallelizable**: NO (depends on 2.6)

  **References**:
  - `src/hooks/index.ts` - hook 注册点
  - `src/index.ts` - 插件入口

  **Acceptance Criteria**:
  - [x] Hook 注册完成
  - [x] `bun run typecheck` → PASS
  - [x] `bun test` → PASS

  **Commit**: YES
  - Message: `feat(hooks): register mdsel-enforcer in hook chain`
  - Files: `src/hooks/index.ts`
  - Pre-commit: `bun test`

---

### Phase 3: Final Verification `completed`

- [x] 3.1 运行完整测试套件

  **What to do**:
  - `bun test` 运行所有测试
  - `bun run typecheck` 类型检查
  - `bun run build` 构建验证

  **Must NOT do**:
  - 不跳过任何测试
  - 不忽略类型错误

  **Parallelizable**: NO (final verification)

  **References**:
  - `package.json` - 测试和构建脚本

  **Acceptance Criteria**:
  - [x] `bun test` → 全部 PASS
  - [x] `bun run typecheck` → 0 errors
  - [x] `bun run build` → 成功

  **Commit**: NO (verification only)

---

- [x] 3.2 更新 HookNameSchema

  **What to do**:
  - 在 `src/config/schema.ts` 的 HookNameSchema 中添加 "mdsel-enforcer"
  - 确保可以通过配置禁用

  **Must NOT do**:
  - 不删除现有 hook 名称

  **Parallelizable**: NO (depends on 3.1)

  **References**:
  - `src/config/schema.ts:HookNameSchema` - hook 名称枚举

  **Acceptance Criteria**:
  - [x] Hook 名称添加
  - [x] `bun run build:schema` → PASS

  **Commit**: YES
  - Message: `feat(config): add mdsel-enforcer to HookNameSchema`
  - Files: `src/config/schema.ts`
  - Pre-commit: `bun run build:schema`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1.2 | `fix(hooks): gate planProgress behind active boulder check` | todo-continuation-enforcer.ts | bun test |
| 1.3 | `fix(hooks): only use fileIncompleteCount when boulder is active` | todo-continuation-enforcer.ts | bun test |
| 2.2 | `feat(skills): add progressive-disclosure-md builtin skill` | progressive-disclosure-md/ | bun run typecheck |
| 2.4 | `feat(hooks): implement mdsel-enforcer PreToolUse blocking` | mdsel-enforcer/ | bun test |
| 2.5 | `feat(skills): register progressive-disclosure-md in skills.ts` | skills.ts | bun run typecheck |
| 2.6 | `feat(config): add progressive-disclosure skill configuration` | schema.ts | bun run build:schema |
| 2.7 | `feat(hooks): register mdsel-enforcer in hook chain` | index.ts | bun test |
| 3.2 | `feat(config): add mdsel-enforcer to HookNameSchema` | schema.ts | bun run build:schema |

---

## Success Criteria

### Verification Commands
```bash
bun test                    # Expected: all pass
bun run typecheck           # Expected: 0 errors
bun run build               # Expected: success
bun run build:schema        # Expected: success
```

### Final Checklist
- [x] TODO CONTINUATION bug 已修复
- [x] 无 boulder 时不扫描 tasks.md
- [x] progressive-disclosure-md skill 已注册
- [x] mdsel-enforcer hook 已实现
- [x] >200 words 的 .md 被阻止直接读取
- [x] 写入 .md 强制 outline 工作流
- [x] 配置项可禁用功能
- [x] 所有测试通过
