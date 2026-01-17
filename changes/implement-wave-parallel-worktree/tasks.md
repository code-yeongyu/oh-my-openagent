# Tasks: Wave-Aware Execution Skills Enhancement

> **Change**: implement-wave-parallel-worktree
> **Created**: 2026-01-12
> **Version**: V3 - Corrected per user feedback

---

## Phase 1: 基础设施

### Task 1.1: 导出wave-grouper和task-parser `<!-- Risk: Tier-1 -->`

**Files:**

- Modify: `src/shared/index.ts`

**Acceptance Criteria:**

- [ ] wave-grouper所有导出项可从 `src/shared` 导入
- [ ] task-parser所有导出项可从 `src/shared` 导入
- [ ] 现有导入不受影响
- [ ] `bun run typecheck` 通过

**TDD Notes:**

- Test: 验证导出项可正常导入
- Test: 类型推断正确

---

## Phase 2: 修改executing-plans Skill

### Task 2.1: 修改executing-plans Step 0 - 融入调用using-git-worktrees `<!-- Risk: Tier-1 -->` `<!-- depends_on: 1.1 -->`

**Files:**

- Modify: `src/features/builtin-skills/executing-plans/SKILL.md`

**Acceptance Criteria:**

- [ ] Step 0 添加调用 using-git-worktrees skill 的说明
- [ ] 调用位置：Plan检查之后，执行之前
- [ ] 创建worktree: `feature/{change-name}`
- [ ] 包含：安全验证、依赖安装、baseline测试
- [ ] 保留现有Step 0的其他内容（恢复状态等）

**Changes:**

```markdown
### Step 0: Environment Check

1. **检查 Plan**
   - 确认 tasks.md 存在

2. **调用 using-git-worktrees skill**  <!-- 新增 -->
   - 创建worktree: `feature/{change-name}`
   - using-git-worktrees 处理：
     - 安全验证 (.gitignore)
     - 依赖安装 (npm install等)
     - Baseline测试

3. **恢复状态 (如有)**
   - 读取 .superpowers/status.json
```

---

### Task 2.2: 修改executing-plans Step 2d - 人工检查点改为自动git checkpoint `<!-- Risk: Tier-1 -->` `<!-- depends_on: 2.1 -->`

**Files:**

- Modify: `src/features/builtin-skills/executing-plans/SKILL.md`

**Acceptance Criteria:**

- [ ] Step 2d 改为自动git commit（不等待人工反馈）
- [ ] commit message格式: `checkpoint: Task {taskId}: {description}`
- [ ] 记录SHA到 .superpowers/status.json
- [ ] 任务完成后自动继续下一任务
- [ ] 保留错误时停止询问的机制
- [ ] 保留现有Step 2a-2c的Codex协作流程不变

**Changes:**

```markdown
### Step 2d: 自动git checkpoint  <!-- 修改 -->

任务完成后自动执行：

1. Git commit with checkpoint message
   ```bash
   git commit -m "checkpoint: Task {taskId}: {description}"
   ```

2. Record SHA in .superpowers/status.json
   ```json
   {
     "tasks": {
       "{taskId}": {
         "status": "complete",
         "sha": "abc123...",
         "completedAt": "2026-01-15T10:30:00Z"
       }
     }
   }
   ```

3. Mark as completed
4. **自动继续下一个任务**（不等待人工确认）
```

---

### Task 2.3: 修改executing-plans Step 3 - Report改为可选 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 2.2 -->`

**Files:**

- Modify: `src/features/builtin-skills/executing-plans/SKILL.md`

**Acceptance Criteria:**

- [ ] Step 3 Report改为可选（正常情况自动继续）
- [ ] 仅在batch完成或遇到错误时报告
- [ ] 保留错误处理流程

**Changes:**

```markdown
### Step 3: Report (可选)  <!-- 修改 -->

当 batch 完成或遇到错误时：
- 显示已完成任务和checkpoint SHAs
- 如有错误：停止并等待反馈
- 如无错误：自动继续下一batch
```

---

## Phase 3: 创建wave-parallel-execution Skill

### Task 3.1: 创建wave-parallel-execution SKILL.md `<!-- Risk: Tier-2 -->` `<!-- depends_on: 2.3 -->`

**Files:**

- Create: `src/features/builtin-skills/wave-parallel-execution/SKILL.md`

**Acceptance Criteria:**

- [ ] Skill描述清晰：Wave并行执行计划
- [ ] Step 1: Wave分组计算（调用wave-grouper）
- [ ] Step 2: 调用using-git-worktrees创建多个worktree
- [ ] Step 3: 多次调用subagent-driven-development（每wave一次）
- [ ] Step 4: 调用finishing和archiving
- [ ] 包含降级逻辑：单Wave时调用executing-plans

**Content Structure:**

```markdown
---
name: wave-parallel-execution
description: Use when executing plans with multiple independent waves in parallel
---

# Wave-Parallel Execution

## Overview
执行包含多个独立Wave的计划，Wave间并行，Wave内串行。

## When to Use
- tasks.md有多个可并行的任务组
- 任务间有明确的依赖关系
- 需要最大化并行效率

## The Process

### Step 1: Wave分组计算
1. 调用 parseTasksMd() + groupTasksIntoWaves()
2. 检测依赖和文件冲突
3. 分组为Waves
4. 更新tasks.md添加Wave注释

IF waves.length === 1:
  → 降级为Sequential
  → 调用 executing-plans skill
  → RETURN

### Step 2: 调用 using-git-worktrees skill
For each Wave:
  - 调用 using-git-worktrees skill
  - 创建 `feature/{name}-wave{N}`

### Step 3: 多次调用 subagent-driven-development skill
For each Wave (并行dispatch):
  - 调用 subagent-driven-development skill
  - 传入该Wave的tasks列表
  - 在对应worktree中执行
  - Wave内任务串行（subagent-driven-development原有流程）

等待所有Waves完成

### Step 4: 合并清理
1. 调用 finishing-a-development-branch
   - 按顺序合并所有wave分支
2. 调用 archiving-changes
   - 清理所有wave worktrees

## Integration
- **REQUIRED SUB-SKILL**: using-git-worktrees
- **REQUIRED SUB-SKILL**: subagent-driven-development
- **REQUIRED SUB-SKILL**: finishing-a-development-branch
- **REQUIRED SUB-SKILL**: archiving-changes
```

---

### Task 3.2: 创建wave-dispatch.md辅助文档 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 3.1 -->`

**Files:**

- Create: `src/features/builtin-skills/wave-parallel-execution/wave-dispatch.md`

**Acceptance Criteria:**

- [ ] 详细说明Wave分发流程
- [ ] 包含并行dispatch模板
- [ ] 包含等待和结果收集说明
- [ ] 包含错误处理流程

---

## Phase 4: 修改creating-changes Skill

### Task 4.1: 修改creating-changes执行选项 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 3.2 -->`

**Files:**

- Modify: `src/features/builtin-skills/creating-changes/SKILL.md`

**Acceptance Criteria:**

- [ ] 执行选项从3个改为2个
- [ ] 选项1: Sequential (调用executing-plans)
- [ ] 选项2: Wave-Parallel (调用wave-parallel-execution)
- [ ] 移除 "Create Worktree First" 独立选项
- [ ] 更新说明：worktree已内置在两个选项中

**Changes:**

```markdown
## Execution Options

完成design.md和tasks.md后，选择执行方式：

### Option 1: Sequential (推荐小型任务)

调用 **executing-plans** skill
- 自动创建单个worktree
- 逐个任务分发给implementer
- 每任务自动git checkpoint
- 适合：< 5个任务，依赖关系复杂

### Option 2: Wave-Parallel (推荐复杂任务)

调用 **wave-parallel-execution** skill
- 自动分析任务依赖，分组为Waves
- 为每个Wave创建独立worktree
- Wave间并行执行
- 适合：> 5个任务，有可并行的任务组

**注意**: 两个选项都会自动创建worktree，无需单独选择。
```

---

## Phase 5: 更新相关Skills

### Task 5.1: 修改finishing-a-development-branch - 添加Wave合并支持 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 4.1 -->`

**Files:**

- Modify: `src/features/builtin-skills/finishing-a-development-branch/SKILL.md`

**Acceptance Criteria:**

- [ ] 添加检测多个wave分支的逻辑
- [ ] 添加按顺序合并wave分支的流程
- [ ] 添加处理合并冲突的说明
- [ ] 保留现有单分支合并流程

**Changes:**

```markdown
## Step 1: 检测分支状态

1. 检查是否有多个wave分支：
   ```bash
   git branch --list "feature/*-wave*"
   ```

2. **如果有多个wave分支**：
   - 按wave编号顺序合并
   - 每个wave合并后检查冲突
   - 冲突时暂停并提示用户

3. **如果只有单个分支**：
   - 继续现有流程
```

---

### Task 5.2: 修改archiving-changes - 添加多worktree清理支持 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 5.1 -->`

**Files:**

- Modify: `src/features/builtin-skills/archiving-changes/SKILL.md`

**Acceptance Criteria:**

- [ ] 添加检测多个wave worktrees的逻辑
- [ ] 添加清理所有wave worktrees的流程
- [ ] 保留现有单worktree清理流程

**Changes:**

```markdown
## Step: 清理Worktrees

1. 检查所有相关worktrees：
   ```bash
   git worktree list | grep "feature/{change-name}"
   ```

2. **清理所有匹配的worktrees**：
   ```bash
   git worktree remove .worktrees/feature-{name}-wave0
   git worktree remove .worktrees/feature-{name}-wave1
   # ... 或单个worktree
   git worktree remove .worktrees/feature-{name}
   ```

3. 删除对应分支（如已合并）
```

---

## Phase 6: 测试

### Task 6.1: 验证Sequential流程 `<!-- Risk: Tier-2 -->` `<!-- depends_on: 5.2 -->`

**Files:**

- (手动测试)

**Acceptance Criteria:**

- [ ] executing-plans正确调用using-git-worktrees
- [ ] executing-plans正确调用subagent-driven-development
- [ ] 自动git checkpoint正常工作
- [ ] 完整流程：worktree创建 → 任务执行 → checkpoint → 完成

---

### Task 6.2: 验证Wave-Parallel流程 `<!-- Risk: Tier-2 -->` `<!-- depends_on: 6.1 -->`

**Files:**

- (手动测试)

**Acceptance Criteria:**

- [ ] wave-parallel-execution正确调用wave-grouper
- [ ] 正确创建多个wave worktrees
- [ ] 正确多次调用subagent-driven-development
- [ ] 完整流程：分组 → 多worktree → 并行执行 → 合并 → 清理

---

### Task 6.3: 验证降级场景 `<!-- Risk: Tier-1 -->` `<!-- depends_on: 6.2 -->`

**Files:**

- (手动测试)

**Acceptance Criteria:**

- [ ] 单Wave时自动降级为Sequential
- [ ] 降级后正确调用executing-plans
- [ ] 降级提示信息清晰

---

## Summary

| Phase | Tasks | Risk Tier 2+ | Est. Time |
|-------|-------|--------------|-----------|
| 1. 基础设施 | 1 | 0 | 0.5天 |
| 2. 修改executing-plans | 3 | 0 | 1天 |
| 3. 创建wave-parallel-execution | 2 | 1 | 1天 |
| 4. 修改creating-changes | 1 | 0 | 0.5天 |
| 5. 更新相关Skills | 2 | 0 | 0.5天 |
| 6. 测试 | 3 | 2 | 0.5天 |
| **Total** | **12** | **3** | **4天** |

---

## Wave Preview

| Wave | Tasks | Parallel |
|------|-------|----------|
| Wave 0 | 1.1 | - |
| Wave 1 | 2.1 | - |
| Wave 2 | 2.2 | - |
| Wave 3 | 2.3 | - |
| Wave 4 | 3.1 | - |
| Wave 5 | 3.2 | - |
| Wave 6 | 4.1 | - |
| Wave 7 | 5.1, 5.2 | ✅ Yes |
| Wave 8 | 6.1 | - |
| Wave 9 | 6.2 | - |
| Wave 10 | 6.3 | - |

**并行机会**: Wave 7 (5.1, 5.2) 可以并行执行

---

## Key Changes Summary

| Skill | 修改类型 | 修改内容 |
|-------|----------|----------|
| `executing-plans` | 融入调用 | Step 0: 调用using-git-worktrees |
| `executing-plans` | 修改行为 | Step 2d: 人工检查点 → 自动git checkpoint |
| `executing-plans` | 修改行为 | Step 3: Report改为可选，自动继续 |
| `wave-parallel-execution` | 新增 | Wave分组 + 多worktree + 多次调用subagent-driven-development |
| `creating-changes` | 简化选项 | 3个选项 → 2个选项 |
| `finishing-a-development-branch` | 扩展 | 添加Wave合并支持 |
| `archiving-changes` | 扩展 | 添加多worktree清理支持 |

**注意**: `executing-plans` 保留现有Step 2a-2c的Codex协作流程，不调用subagent-driven-development。Wave-Parallel模式才调用subagent-driven-development。

---

*Tasks document for implement-wave-parallel-worktree*
