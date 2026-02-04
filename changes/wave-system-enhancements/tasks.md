# Wave System Enhancements

## TL;DR

> **快速摘要**: 升级 creating-changes skill 使其生成 Prometheus 同等质量的计划，并实现 tasks.md 创建守卫和 Wave 自动激活。
> 
> **交付物**:
> - 升级后的 creating-changes skill（含 QA Scenarios、并行化、Agent Profile）
> - tasks-md-creation-guard hook
> - Wave 自动激活逻辑（tasks > 5）
> 
> **预计工作量**: Medium
> **并行执行**: YES - 3 waves
> **关键路径**: Task 0.1 → Task 1.1 → Task 3.1

---

## Context

### Original Request
实现 Decision #5 (Wave System Improvements)，并升级 creating-changes skill 使其生成与 Prometheus 同等质量的计划。

### Interview Summary
**关键讨论**:
- 需要添加 Agent-Executed QA Scenarios
- 需要添加并行化信息（Wave/依赖矩阵）
- 需要添加 Recommended Agent Profile
- 需要添加 References 章节
- 必须使用 mdsel 读取/修改 .md 文件
- 必须使用 skill-studio 修改 skill

### Research Findings
- Prometheus plan-template.ts: ~424 行，包含详细 QA 场景模板
- creating-changes reference.md: ~545 行，任务模板较简单
- 差距: Prometheus 比 creating-changes 详细 4-5 倍

---

## Work Objectives

### Core Objective
使 creating-changes skill 生成的计划达到 Prometheus 的质量标准。

### Concrete Deliverables
- `src/features/builtin-skills/creating-changes/SKILL.md` (升级)
- `src/features/builtin-skills/creating-changes/reference.md` (升级)
- `src/hooks/tasks-md-creation-guard/` (新建)
- `src/hooks/start-work/index.ts` (修改)

### Definition of Done
- [x] `bun run typecheck` 无错误
- [x] `bun run build` 成功
- [x] creating-changes 任务模板包含 QA Scenarios

### Must NOT Have (Guardrails)
- ❌ 不使用 Read 直接读取大型 .md 文件（必须用 mdsel）
- ❌ 不手动验证（Zero Human Intervention）
- ❌ 不写实现代码到计划中

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION**: 所有验证必须由 Agent 执行。

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: Manual QA (typecheck + build)
- **Framework**: bun test

### Agent-Executed QA (全局)

| 类型 | 工具 | 验证方式 |
|------|------|----------|
| TypeScript | Bash | `bun run typecheck` |
| Build | Bash | `bun run build` |
| .md 文件 | mdsel | 索引并检查章节存在 |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (立即开始):
├── Task 0.1: 升级 creating-changes skill
└── Task 2.1: 创建常量文件

Wave 2 (Wave 1 完成后):
├── Task 1.1: 添加标准任务格式 [依赖: 0.1]
├── Task 2.2: 实现 hook 主逻辑 [依赖: 2.1]
└── Task 2.3: 注册 hook [依赖: 2.2]

Wave 3 (Wave 2 完成后):
├── Task 3.1: 实现自动激活 [依赖: 1.1]
└── Task 4.1: 最终验证 [依赖: 2.3, 3.1]
```

### Dependency Matrix

| Task | Depends On | Blocks | Parallel With |
|------|------------|--------|---------------|
| 0.1 | None | 1.1 | 2.1 |
| 1.1 | 0.1 | 3.1 | 2.2, 2.3 |
| 2.1 | None | 2.2 | 0.1 |
| 2.2 | 2.1 | 2.3 | 1.1 |
| 2.3 | 2.2 | 4.1 | 1.1 |
| 3.1 | 1.1 | 4.1 | None |
| 4.1 | 2.3, 3.1 | None | None (final) |

---

## 工具使用规范

| 操作 | 使用工具 |
|------|----------|
| 读取/修改 `.md` 文件 | `mdsel` (渐进式披露) |
| 修改 skill | `skill-studio` |
| 修改 `.ts` 代码文件 | 标准 Read/Edit |

```bash
# mdsel 命令
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs "文件路径"
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs h2.0 "文件路径"
```

---

## TODOs

### Task 0.1: 升级 creating-changes skill <!-- Risk: Tier-2 -->

**What to do**:
- 使用 mdsel 读取 Prometheus plan-template.ts 的 QA Scenarios 模板
- 使用 mdsel 读取 creating-changes reference.md 的任务模板
- 添加 Agent-Executed QA Scenarios 章节
- 添加 Parallelization 信息
- 添加 Recommended Agent Profile
- 添加 References 章节
- 添加 Zero Human Intervention 原则

**Must NOT do**:
- ❌ 使用 Read 直接读取整个文件
- ❌ 删除现有内容

**Recommended Agent Profile**:
- **Category**: `writing`
  - Reason: 主要是文档编写任务
- **Skills**: [`progressive-disclosure-md`, `skill-studio`]
  - `progressive-disclosure-md`: 读取大型 .md 文件
  - `skill-studio`: 修改 skill 相关文件

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 1 (with 2.1)
- **Blocks**: Task 1.1
- **Blocked By**: None

**References**:
- `src/agents/prometheus/plan-template.ts:116-175` - QA Scenarios 模板格式
- `src/agents/prometheus/plan-template.ts:227-398` - 任务模板完整示例
- `src/features/builtin-skills/creating-changes/reference.md:127-219` - 现有任务模板

**Acceptance Criteria**:
- [x] reference.md 包含 Agent-Executed QA Scenarios 章节
- [x] reference.md 任务模板包含 Parallelization 信息
- [x] reference.md 任务模板包含 Recommended Agent Profile
- [x] reference.md 任务模板包含 References 章节
- [x] SKILL.md 包含 Zero Human Intervention 说明

**Agent-Executed QA Scenarios**:
```
Scenario: 验证 reference.md 包含 QA Scenarios
  Tool: Bash (mdsel)
  Steps:
    1. node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs reference.md
    2. Assert: 输出包含 "Agent-Executed QA" 或 "QA Scenarios"
  Expected: 章节存在于索引中
```

---

### Task 1.1: 添加标准任务格式到 SKILL.md <!-- Risk: Tier-0 -->

**What to do**:
- 使用 mdsel 读取 SKILL.md Step 4 章节
- 在 Step 4 后添加"标准任务格式"章节
- 包含 HTML 注释元数据格式示例

**Must NOT do**:
- ❌ 重写整个文件

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: [`progressive-disclosure-md`]

**Parallelization**:
- **Can Run In Parallel**: NO
- **Blocked By**: Task 0.1
- **Blocks**: Task 3.1

**References**:
- `src/features/builtin-skills/creating-changes/SKILL.md:63-88` - Step 4 位置

**Acceptance Criteria**:
- [x] SKILL.md 包含"标准任务格式"章节
- [x] 包含 HTML 注释示例: `<!-- Risk: Tier-X -->`

---

### Task 2.1: 创建常量文件 <!-- Risk: Tier-1 -->

**What to do**:
- 创建 `src/hooks/tasks-md-creation-guard/constants.ts`
- 定义 TASKS_MD_PATTERN, ERROR_MESSAGE, INTERCEPTED_TOOLS

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 1 (with 0.1)
- **Blocks**: Task 2.2
- **Blocked By**: None

**References**:
- `src/hooks/prometheus-md-only/constants.ts` - 类似 hook 常量模式

**Acceptance Criteria**:
- [x] 文件创建成功
- [x] 导出 TASKS_MD_PATTERN, ERROR_MESSAGE, INTERCEPTED_TOOLS

---

### Task 2.2: 实现 hook 主逻辑 <!-- Risk: Tier-2 -->

**What to do**:
- 创建 `src/hooks/tasks-md-creation-guard/index.ts`
- 实现 PreToolUse 拦截逻辑
- 实现 PostToolUse 跟踪 skill 使用

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 2 (with 1.1)
- **Blocks**: Task 2.3
- **Blocked By**: Task 2.1

**References**:
- `src/hooks/prometheus-md-only/index.ts` - 类似拦截模式
- `src/hooks/notepad-write-guard/index.ts` - 写入守卫模式

**Acceptance Criteria**:
- [x] 导出 `createTasksMdCreationGuardHook`
- [x] PreToolUse 拦截 Write/Edit/MultiEdit
- [x] 文件不存在时阻止，已存在时允许
- [x] `bun run typecheck` 通过

---

### Task 2.3: 注册 hook <!-- Risk: Tier-1 -->

**What to do**:
- 在 `src/hooks/index.ts` 添加导出
- 在 `src/config/schema.ts` 添加到 HookNameSchema
- 在 `src/index.ts` 导入并注册

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: NO
- **Blocked By**: Task 2.2
- **Blocks**: Task 4.1

**References**:
- `src/hooks/index.ts:1-100` - 现有导出模式
- `src/config/schema.ts:109-143` - HookNameSchema 位置

**Acceptance Criteria**:
- [x] Hook 从 index.ts 导出
- [x] 添加到 HookNameSchema
- [x] `bun run build` 成功

---

### Task 3.1: 实现自动激活 <!-- Risk: Tier-2 -->

**What to do**:
- 修改 `src/hooks/start-work/index.ts`
- 添加任务计数逻辑
- 任务 > 5 时跳过 Question，自动激活 Wave

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: NO
- **Blocked By**: Task 1.1
- **Blocks**: Task 4.1

**References**:
- `src/hooks/start-work/index.ts:41-76` - generateExecutionModePrompt 函数

**Acceptance Criteria**:
- [x] 任务 > 5 自动激活 Wave 模式
- [x] 任务 ≤ 5 显示 Question
- [x] 支持 "use sequential" 覆盖
- [x] `bun run typecheck` 通过

---

### Task 4.1: 最终验证 <!-- Risk: Tier-0 -->

**What to do**:
- 运行 typecheck
- 运行 build
- 验证所有文件就位

**Recommended Agent Profile**:
- **Category**: `quick`
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: NO (final)
- **Blocked By**: Task 2.3, 3.1
- **Blocks**: None

**Acceptance Criteria**:
- [x] `bun run typecheck` → 无错误
- [x] `bun run build` → 成功

**Agent-Executed QA Scenarios**:
```
Scenario: 验证构建成功
  Tool: Bash
  Steps:
    1. bun run typecheck
    2. Assert: exit code 0
    3. bun run build
    4. Assert: exit code 0
  Expected: 两个命令都成功
```

---

## Commit Strategy

| After Task | Message | Files |
|------------|---------|-------|
| 0.1 | `docs(skill): upgrade creating-changes to Prometheus quality` | SKILL.md, reference.md |
| 2.3 | `feat(hooks): add tasks-md-creation-guard hook` | hooks/, schema.ts, index.ts |
| 3.1 | `feat(hooks): auto-activate wave mode for >5 tasks` | start-work/index.ts |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck  # Expected: 0 errors
bun run build      # Expected: success
```

### Final Checklist
- [x] creating-changes skill 包含 QA Scenarios 模板
- [x] tasks-md-creation-guard hook 已注册
- [x] Wave 自动激活已实现
- [x] 所有 Must NOT Have 均未违反
