# Wave Dispatch Reference

## Overview

本文档详细说明 Wave 并行分发的具体流程和模板。

## Wave 分发流程

### 1. 准备阶段

```typescript
// 1. 解析 tasks.md
const tasksContent = await read("changes/{name}/tasks.md")
const result = parseTasksMd(tasksContent)

// 2. 获取 Wave 分组
const { waves, conflicts } = result.waveResult

// 3. 检查是否需要并行
if (waves.length === 1) {
  // 降级为 Sequential
  return executeSequential(waves[0])
}
```

### 2. 创建 Worktrees

```bash
# 为每个 Wave 创建独立 worktree
for wave in waves:
  git worktree add .worktrees/feature-{name}-wave{wave.id} -b feature/{name}-wave{wave.id}
```

### 3. 并行 Dispatch 模板

```typescript
// 并行启动所有 Waves
const wavePromises = waves.map(wave => 
  sisyphus_task({
    agent: "implementer",
    background: true,
    prompt: `
## Wave ${wave.id} Execution

### Context
- Worktree: .worktrees/feature-{name}-wave${wave.id}
- Branch: feature/{name}-wave${wave.id}
- Tasks: ${wave.tasks.map(t => t.id).join(', ')}

### Instructions
1. Change to worktree directory
2. Use subagent-driven-development skill
3. Execute tasks in order: ${wave.tasks.map(t => t.id).join(' → ')}
4. For each task:
   - Pre-Implementation: Call `skill("collaborating-with-codex")` for prototype
   - Implementation: Follow plan exactly
   - Post-Implementation: Call `skill("collaborating-with-codex")` for review
   - Checkpoint: git commit with "checkpoint: Task {id}: {desc}"
5. Report completion with all checkpoint SHAs

### Required Skills
- subagent-driven-development
- test-driven-development (for Tier 2-3 tasks)

### Output Format
Return JSON:
{
  "waveId": ${wave.id},
  "status": "complete" | "failed",
  "tasks": [
    { "id": "1.1", "status": "complete", "sha": "abc123" },
    ...
  ],
  "errors": [] // if any
}
    `
  })
)

// 收集所有 task_ids
const taskIds = await Promise.all(wavePromises)
```

### 4. 等待和结果收集

```typescript
// 等待所有 Waves 完成
const results = []
for (const taskId of taskIds) {
  const result = await background_output({ task_id: taskId, block: true })
  results.push(JSON.parse(result))
}

// 检查结果
const failed = results.filter(r => r.status === "failed")
if (failed.length > 0) {
  // 处理失败
  reportFailures(failed)
  return
}

// 所有 Waves 成功
const allShas = results.flatMap(r => r.tasks.map(t => t.sha))
```

### 5. 合并流程

```bash
# 切换到主分支
git checkout main

# 按 Wave 顺序合并
for wave in sorted(waves, by=id):
  git merge feature/{name}-wave{wave.id} --no-ff -m "Merge wave ${wave.id}"
  
  # 检查冲突
  if [ $? -ne 0 ]; then
    echo "Conflict in wave ${wave.id}, manual resolution required"
    exit 1
  fi
```

## 错误处理

### Wave 执行失败

```typescript
if (waveResult.status === "failed") {
  // 1. 记录失败详情
  const failedTasks = waveResult.tasks.filter(t => t.status === "failed")
  
  // 2. 检查是否可以继续其他 Waves
  const canContinue = !hasBlockingDependency(failedTasks, remainingWaves)
  
  if (canContinue) {
    // 继续其他 Waves，稍后处理失败的
    console.log(`Wave ${waveResult.waveId} failed, continuing with others`)
  } else {
    // 停止所有 Waves
    await background_cancel({ all: true })
    throw new Error(`Blocking failure in wave ${waveResult.waveId}`)
  }
}
```

### 合并冲突

```typescript
try {
  await git.merge(`feature/{name}-wave${waveId}`)
} catch (error) {
  if (error.type === "MergeConflict") {
    // 1. 显示冲突文件
    console.log("Conflict files:", error.conflictFiles)
    
    // 2. 等待用户解决
    await promptUser("Please resolve conflicts and continue")
    
    // 3. 继续合并
    await git.add(".")
    await git.commit(`Merge wave ${waveId} (conflict resolved)`)
  }
}
```

## 状态文件格式

### .sisyphus/wave-status.json

```json
{
  "changeName": "auth-system",
  "startedAt": "2026-01-15T10:00:00Z",
  "waves": {
    "0": {
      "branch": "feature/auth-system-wave0",
      "worktreePath": ".worktrees/feature-auth-system-wave0",
      "status": "complete",
      "tasks": [
        { "id": "1.1", "sha": "abc123", "completedAt": "2026-01-15T10:30:00Z" }
      ]
    },
    "1": {
      "branch": "feature/auth-system-wave1",
      "worktreePath": ".worktrees/feature-auth-system-wave1",
      "status": "in_progress",
      "tasks": []
    }
  },
  "mergeStatus": {
    "completed": ["wave0"],
    "pending": ["wave1"]
  }
}
```

## 最佳实践

1. **Wave 粒度**: 每个 Wave 应包含 2-5 个任务
2. **依赖检查**: 确保 Wave 间无循环依赖
3. **文件冲突**: 冲突文件自动添加依赖，避免并行修改
4. **资源限制**: 考虑 agent 并发限制，不要启动过多 Waves
5. **进度报告**: 定期检查各 Wave 进度，及时发现问题
