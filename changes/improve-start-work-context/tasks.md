# Tasks: improve-start-work-context

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

---

## Context Merge Instructions (MANDATORY)

### For start-work (首次执行)

**Step 1**: 调用 progressive-disclosure-md skill 合并 proposal + design 到 tasks.md

```bash
# Index source files
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs changes/{name}/proposal.md
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs changes/{name}/design.md

# Extract and merge these sections:
# From proposal.md:
#   - h2.0 (Problem Statement)
#   - h2.2 (Success Criteria)
# From design.md:
#   - h2.0 (Goal)
#   - h2.1 (Architecture)
#   - h2.4 (Key Decisions)

# Prepend to tasks.md with <!-- MERGED CONTEXT --> markers
```

**Step 2**: 解析未完成任务写入 todo（见下方通用指令）

### For boulder/todo continuation (后续 session)

**Step 1**: 调用 progressive-disclosure-md skill 读取已合并的 tasks.md

```bash
# 读取 tasks.md 中的任务列表
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs changes/{name}/tasks.md
```

**Step 2**: 解析未完成任务写入 todo（见下方通用指令）

### 通用：解析任务写入 todo

解析每个 `### Task X.Y: [Title]` 并使用 `todowrite`：

```
- id: "task-X.Y"
- content: "[Title] - [Description 第一句]"
- priority: Phase 1 = high, Phase 2 = medium, Phase 3+ = low
- status: 根据 checkbox 状态
  - `[x]` = completed
  - `[ ]` = pending
  - `[~]` = in_progress
```

**重要**：只写入未完成的任务（`[ ]` 或 `[~]`），跳过已完成的（`[x]`）

---

## Phase 1: 修改 start-work 模板

### Task 1.1: 添加上下文合并指令到 start-work 模板 <!-- Risk: Tier-2 -->

**Description:**
在 start-work 模板中添加使用 progressive-disclosure-md 合并 proposal + design 到 tasks.md 的指令。

**Files:**
- Modify: `src/features/builtin-commands/templates/start-work.ts` - 添加合并指令

**Acceptance Criteria:**
- [ ] 模板包含调用 progressive-disclosure-md 的具体命令
- [ ] 指定从 proposal.md 合并 Problem Statement (h2.0) 和 Success Criteria (h2.2)
- [ ] 指定从 design.md 合并 Goal (h2.0), Architecture (h2.1), Key Decisions (h2.4)
- [ ] 包含检测已合并标记 `<!-- MERGED CONTEXT -->` 跳过重复合并的逻辑

**TDD Test Cases:**
1. **Test**: start-work template should include merge instructions
   - **Given**: 读取 start-work 模板内容
   - **When**: 检查模板
   - **Then**: 包含 `progressive-disclosure-md` 和具体的 h2.x 选择器

**Edge Cases:**
- progressive-disclosure-md 未安装：提示用户运行安装脚本

**Dependencies:** None

---

### Task 1.2: 添加 todo 写入指令到 start-work 模板 <!-- Risk: Tier-2 -->

**Description:**
在 start-work 模板中添加将未完成任务解析为独立 todo items 的指令。

**Files:**
- Modify: `src/features/builtin-commands/templates/start-work.ts` - 添加 todo 写入指令

**Acceptance Criteria:**
- [ ] 模板指示解析 `### Task X.Y` 格式的任务标题
- [ ] 根据 checkbox 状态设置 todo status（`[x]`=completed, `[ ]`=pending）
- [ ] 只写入未完成的任务到 todo
- [ ] 指定 priority 根据 Phase 递减（Phase 1 = high）

**TDD Test Cases:**
1. **Test**: start-work template should include todo write instructions
   - **Given**: 读取 start-work 模板内容
   - **When**: 检查模板
   - **Then**: 包含 `todowrite` 和 checkbox 状态检测逻辑

**Edge Cases:**
- 任务数量为 0：报错退出
- 所有任务已完成：报告完成状态

**Dependencies:** Task 1.1

---

## Phase 2: 修改 boulder/todo continuation 注入

### Task 2.1: 修改 boulder continuation 注入逻辑 <!-- Risk: Tier-2 -->

**Description:**
修改现有的 boulder continuation 注入，添加调用 progressive-disclosure-md 读取 tasks.md 并写入 todo 的指令。

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.ts` - 添加 progressive-disclosure-md 指令

**Acceptance Criteria:**
- [ ] 注入提示包含调用 progressive-disclosure-md 读取 tasks.md 的指令
- [ ] 注入提示包含解析未完成任务写入 todo 的指令
- [ ] 注入提示说明根据 checkbox 状态设置 todo status

**TDD Test Cases:**
1. **Test**: boulder continuation should include context instructions
   - **Given**: 读取 todo-continuation-enforcer 的注入内容
   - **When**: 检查注入模板
   - **Then**: 包含 `progressive-disclosure-md` 和 todo 写入指令

**Edge Cases:**
- tasks.md 未合并：正常读取，合并上下文在 start-work 完成

**Dependencies:** None

---

### Task 2.2: 修改 todo continuation 注入逻辑 <!-- Risk: Tier-2 -->

**Description:**
修改现有的 todo continuation 注入，添加相同的指令。

**Files:**
- Modify: `src/hooks/todo-continuation-enforcer.ts` - 在 todo continuation 部分添加指令

**Acceptance Criteria:**
- [ ] todo continuation 注入也包含 progressive-disclosure-md 指令
- [ ] 与 boulder continuation 使用相同的指令格式

**TDD Test Cases:**
1. **Test**: todo continuation should include context instructions
   - **Given**: 读取 todo continuation 的注入内容
   - **When**: 检查注入模板
   - **Then**: 包含 `progressive-disclosure-md` 和 todo 写入指令

**Edge Cases:**
- 无

**Dependencies:** Task 2.1

---

## Phase 3: 测试验证

### Task 3.1: 端到端测试 start-work 流程 <!-- Risk: Tier-2 -->

**Description:**
手动测试 start-work 流程，验证合并和 todo 写入是否正常工作。

**Files:**
- 无代码修改，手动测试

**Acceptance Criteria:**
- [ ] start-work 后 tasks.md 包含 `<!-- MERGED CONTEXT -->` 标记
- [ ] tasks.md 包含 Problem Statement, Success Criteria, Goal, Architecture, Key Decisions
- [ ] todoread 显示未完成任务作为独立 todo items
- [ ] 已完成任务（`[x]`）不在 todo 中或状态为 completed

**TDD Test Cases:**
- 手动验证

**Edge Cases:**
- 无

**Dependencies:** Task 1.1, Task 1.2

---

### Task 3.2: 端到端测试 boulder/todo continuation 流程 <!-- Risk: Tier-2 -->

**Description:**
手动测试 boulder/todo continuation 流程，验证上下文注入和 todo 写入是否正常工作。

**Files:**
- 无代码修改，手动测试

**Acceptance Criteria:**
- [ ] 新 session 中收到 continuation 提示
- [ ] AI 执行 progressive-disclosure-md 读取 tasks.md
- [ ] AI 将未完成任务写入 todo
- [ ] 已完成任务状态正确保留

**TDD Test Cases:**
- 手动验证

**Edge Cases:**
- 无

**Dependencies:** Task 2.1, Task 2.2

---

## Legend

- `[ ]` = Pending
- `[x]` = Complete
- `[~]` = In Progress
- `[-]` = Skipped

## Risk Tiers

| Tier | Description | TDD Requirement |
|------|-------------|-----------------|
| **0** | Always allowed (docs, comments, .gitignore) | None |
| **1** | Allowed with logging (CSS, renames) | None, logged |
| **2** | Require failing test OR exemption | Test or exemption |
| **3** | Strict TDD (core logic, new features) | Mandatory test first |
