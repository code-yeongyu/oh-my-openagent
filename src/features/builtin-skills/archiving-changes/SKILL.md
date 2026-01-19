---
name: archiving-changes
description: 归档已完成的变更
---

# Archiving Changes

## 概述

当所有任务完成后，归档变更以保留完整历史。

**Announce at start:** "I'm using the archiving-changes skill to archive this completed change."

## Phase Status

**State Transition**: `awaiting_user` → `completed`

This skill completes the development cycle by transitioning the phase from `awaiting_user` to `completed`. After archiving, the boulder state is marked as complete and the workflow cycle ends. Phase status is tracked via `.sisyphus/boulder.json`.

## 何时使用

- 所有任务已标记为 `[x]`
- 已完成 `finishing-a-development-branch` 流程
- 分支已合并或 PR 已创建

## 前提条件

确保具备以下条件：
1. 所有 `tasks.md` 中的任务已完成
2. 已执行 `finishing-a-development-branch` 流程
3. 代码变更已提交

## 流程

### Step 1: 确认任务完成

检查 `changes/{name}/tasks.md`：
- 所有任务项为 `- [x]`
- 无遗留的 `- [ ]` 项

### Step 2: 运行归档命令

**REQUIRED COMMAND:** `/archive {change-name}`

这将执行：
1. 合并 Worktree 分支 (如需)
2. 删除 Worktree
3. 生成 `metadata.json`
4. 移动到 `changes/archive/YYYY-MM-DD-{name}/`

### Step 3: 验证归档

检查归档结果：
- `changes/archive/YYYY-MM-DD-{name}/` 目录存在
- `metadata.json` 包含所有 commit SHAs
- Worktree 已清理

### Step 4: 标记 Boulder 完成

**CRITICAL:** 归档完成后必须调用 `markBoulderComplete()` 标记工作流结束。

这将：
- 更新 `.sisyphus/boulder.json` 中的 `phase` 为 `completed`
- 设置 `completed_at` 时间戳
- 清除 `active_plan` 以防止 Phase 3 重复触发

```typescript
import { markBoulderComplete } from "src/features/boulder-state"

// 归档完成后调用
markBoulderComplete(projectRoot)
```

## metadata.json 结构

```json
{
  "changeName": "my-feature",
  "archivedAt": "2026-01-05T10:00:00Z",
  "commits": [
    { "sha": "abc123", "message": "feat: add feature", "taskId": "1.1" }
  ],
  "branch": "change/my-feature",
  "mergedTo": "main"
}
```

## Worktree 清理

Archive 命令会自动：
- 检测是否存在关联 Worktree
- 执行 `git worktree remove`
- 清理分支 (如已合并)

### 多 Worktree 清理 (Wave 模式)

当使用 Wave-Parallel 执行模式时，会创建多个 worktrees。归档时需要清理所有相关的 worktrees：

1. **检查所有相关 worktrees：**
   ```bash
   git worktree list | grep "feature/{change-name}"
   ```

2. **清理所有匹配的 worktrees：**
   ```bash
   # Wave 模式：多个 worktrees
   git worktree remove .worktrees/feature-{name}-wave0
   git worktree remove .worktrees/feature-{name}-wave1
   git worktree remove .worktrees/feature-{name}-wave2
   # ... 直到所有 wave worktrees 被清理
   
   # 或单个 worktree (Sequential 模式)
   git worktree remove .worktrees/feature-{name}
   ```

3. **删除对应分支（如已合并）：**
   ```bash
   # Wave 模式
   git branch -d feature/{name}-wave0
   git branch -d feature/{name}-wave1
   # ...
   
   # Sequential 模式
   git branch -d feature/{name}
   ```

4. **更新 metadata.json：**
   ```json
   {
     "changeName": "my-feature",
     "archivedAt": "2026-01-05T10:00:00Z",
     "executionMode": "wave-parallel",  // 或 "sequential"
     "waves": [
       { "id": 0, "branch": "feature/my-feature-wave0", "status": "merged" },
       { "id": 1, "branch": "feature/my-feature-wave1", "status": "merged" }
     ],
     "commits": [
       { "sha": "abc123", "message": "checkpoint: Task 1.1", "taskId": "1.1", "waveId": 0 }
     ],
     "mergedTo": "main"
   }
   ```

## 下一步

归档完成后，可以：
- 开始新变更: 运行 `/new-change {name}`
- 查看历史: `ls changes/archive/`
