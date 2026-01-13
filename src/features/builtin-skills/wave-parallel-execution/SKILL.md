---
name: wave-parallel-execution
description: Use when executing plans with multiple independent waves in parallel
---

# Wave-Parallel Execution

## Overview

执行包含多个独立 Wave 的计划，Wave 间并行，Wave 内串行。每个任务由 Implementer agent 执行。

**Core principle:** 最大化并行效率，同时保持任务依赖顺序。Implementer agent 处理每个任务。

**Announce at start:** "I'm using the wave-parallel-execution skill to execute this plan in parallel waves."

## When to Use

- tasks.md 有多个可并行的任务组
- 任务间有明确的依赖关系
- 需要最大化并行效率
- 任务数量 > 5 个

## When NOT to Use

- 任务数量 ≤ 5 个（使用 executing-plans）
- 所有任务都有依赖关系（无法并行）
- 简单顺序执行即可完成

## The Process

### Step 1: Wave 分组计算

1. **读取 tasks.md**
   - 解析任务列表和依赖关系
   - 检测文件冲突

2. **调用 wave-grouper**
   ```typescript
   import { parseTasksMd, groupTasksIntoWaves } from "src/shared"
   
   const result = parseTasksMd(tasksContent)
   const { waves, conflicts } = result.waveResult
   ```

3. **检查 Wave 数量**
   
   **IF waves.length === 1:**
   → 显示: "只有 1 个 Wave，降级为 Sequential 模式"
   → **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
   → RETURN

4. **更新 tasks.md 添加 Wave 注释**
   - 在每个任务标题后添加 `<!-- Wave: N -->`
   - 显示 Wave Preview 表格

### Step 2: 创建多个 Worktrees

For each Wave:

1. **调用 using-git-worktrees skill**
   - **REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees
   - 创建 worktree: `feature/{change-name}-wave{N}`
   - 例如: `feature/auth-system-wave0`, `feature/auth-system-wave1`

2. **记录 worktree 信息**
   ```json
   {
     "waves": {
       "0": {
         "branch": "feature/{name}-wave0",
         "worktreePath": ".worktrees/feature-{name}-wave0",
         "status": "ready"
       }
     }
   }
   ```

### Step 3: 并行调度 Waves (使用 Implementer Agent)

For each Wave (并行 dispatch):

1. **并行 dispatch Implementer agents**

   ```typescript
   // 并行启动所有 Waves
   for (const wave of waves) {
     sisyphus_task({
       subagent_type: "implementer",
       description: `Execute Wave ${wave.id} tasks`,
       skills: ["test-driven-development", "codex-mcp-collaboration"],
       run_in_background: true,
       prompt: `
## Wave ${wave.id} Execution

You are executing Wave ${wave.id} in worktree: ${wave.worktreePath}

### Tasks in this Wave

${wave.tasks.map(t => `
#### Task ${t.id}: ${t.name}

**Risk Tier:** ${t.riskTier}

**Description:**
${t.fullText}

**Files:**
- Create: ${t.filesToCreate}
- Modify: ${t.filesToModify}
- Test: ${t.testFiles}

**Acceptance Criteria:**
${t.acceptanceCriteria}
`).join('\n')}

### Instructions

For each task in order:
1. Implement following your standard workflow (Codex prototype → TDD → Codex review)
2. Commit after each task with message: "checkpoint: Task {id}: {description}"
3. Record SHA for each completed task

### MUST DO
- Execute tasks in order within this Wave
- Use Bun for tests
- Run lsp_diagnostics before each commit
- Request Codex prototype before coding
- Request Codex review after coding

### MUST NOT DO
- Do not modify files outside the listed paths
- Do not skip TDD for Tier 2/3 tasks
- Do not suppress type errors

### Report Format

When all tasks complete:
WAVE_COMPLETED:
- Wave: ${wave.id}
- Tasks: [list with SHAs]
- Notes: [any concerns]

If blocked on any task:
WAVE_BLOCKED:
- Wave: ${wave.id}
- Blocked at: Task {id}
- Reason: [why blocked]
- Completed: [list of completed tasks with SHAs]

Work from: ${wave.worktreePath}
`
     })
   }
   ```

2. **等待所有 Waves 完成**
   - 使用 `background_output` 收集结果
   - 记录每个 Wave 的完成状态和 SHAs

3. **处理 Wave 结果**

   | Response | Action |
   |----------|--------|
   | `WAVE_COMPLETED` | Record all SHAs, mark Wave complete |
   | `WAVE_BLOCKED` | Note completed tasks, report blocker to user |

### Step 4: 合并清理

1. **调用 finishing-a-development-branch skill**
   - **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
   - 按 Wave 编号顺序合并所有分支
   - 处理合并冲突（如有）

2. **调用 archiving-changes skill**
   - **REQUIRED SUB-SKILL:** Use superpowers:archiving-changes
   - 清理所有 wave worktrees
   - 归档变更文档

## Error Handling

### Wave 执行失败

1. **单个 Wave 失败 (WAVE_BLOCKED)**
   - 停止该 Wave
   - 其他 Waves 继续执行
   - 报告失败详情
   - 等待反馈后重试或跳过

2. **多个 Waves 失败**
   - 停止所有 Waves
   - 显示所有失败详情
   - 等待反馈

### 合并冲突

1. 按 Wave 顺序逐个合并
2. 冲突时停止并提示用户
3. 用户解决后继续

## Integration

- **REQUIRED SUB-SKILL:** using-git-worktrees
- **REQUIRED SUB-SKILL:** finishing-a-development-branch
- **REQUIRED SUB-SKILL:** archiving-changes

**Note:** 不再直接依赖 subagent-driven-development skill，而是直接使用 Implementer agent。

## Implementer Agent Workflow (Internal)

每个 Implementer agent 内部遵循以下流程：

```
Step 1: Understand Task → QUESTIONS if unclear
Step 2: Codex Phase 2 - Get prototype (read-only)
Step 3: TDD Implementation (Tier-based)
Step 4: Codex Phase 3 - Review
Step 5: Commit + Report
```

## Remember

- 先计算 Wave 分组，再创建 worktrees
- 单 Wave 时自动降级为 executing-plans
- Wave 间并行，Wave 内串行
- 使用 Implementer agent 执行每个任务
- 按 Wave 编号顺序合并
- 保留所有 checkpoint SHAs
- 错误时优雅降级

## 下一步

所有 Waves 完成后：

1. **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
2. 完成后运行 `/archive {change-name}` 归档变更
3. **REQUIRED SUB-SKILL:** Use superpowers:archiving-changes
