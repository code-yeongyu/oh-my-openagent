---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, dispatch Implementer agent per task, with automatic checkpoints.

**Core principle:** Implementer agent per task + automatic checkpoints + error-triggered reviews.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 0: Environment Check

⚠️ **REQUIRED: 开始前必须确认环境就绪**

1. **检查 Plan**
   - 确认 `tasks.md` 或 `docs/plans/` 中存在实施计划
   - 如无计划，引导用户先使用 `writing-plans` skill

2. **调用 using-git-worktrees skill**
   - **REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees
   - 创建 worktree: `feature/{change-name}`
   - using-git-worktrees 处理：
     - 安全验证 (.gitignore 检查)
     - 依赖安装 (npm install 等)
     - Baseline 测试运行
   - 如已在 worktree 中工作，跳过此步骤

3. **恢复状态 (如有)**
   - 读取 `.fusion/status.json`
   - 如存在未完成任务，从上次中断位置恢复
   - 显示: "检测到未完成任务 {taskId}，将从此处继续"

### Step 1: Load and Review Plan

1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Tasks via Implementer Agent

For each task, dispatch to Implementer agent:

```typescript
sisyphus_task({
  subagent_type: "implementer",
  description: `Implement Task ${taskId}: ${taskName}`,
  skills: ["test-driven-development", "codex-mcp-collaboration"],
  run_in_background: false,
  prompt: `
## ImplementerTaskContext

### 1. TASK
Task ID: ${taskId}
Name: ${taskName}
Risk Tier: ${riskTier}

### 2. TASK DESCRIPTION

${fullTaskText}

### 3. CONTEXT

${sceneSettingContext}

### 4. FILES
Create:
${filesToCreate}
Modify:
${filesToModify}
Test:
${testFiles}

### 5. ACCEPTANCE CRITERIA
${acceptanceCriteria}

### 6. TDD NOTES (Tier 2/3 only)
${tddNotes}

### 7. MUST DO
- Follow existing code patterns
- Use Bun for tests
- Run lsp_diagnostics before completion
- Request Codex prototype before coding (Phase 2)
- Request Codex review after coding (Phase 3)

### 8. MUST NOT DO
- Do not modify files outside the listed paths
- Do not skip TDD for Tier 2/3 tasks
- Do not suppress type errors
- Do not delegate to other agents

Work from: ${worktreePath}
`
})
```

### Step 2b: Handle Implementer Response

| Response | Action |
|----------|--------|
| `COMPLETED` | Record SHA, mark complete, continue to next task |
| `QUESTIONS` | Answer questions, resume Implementer with `resume=session_id` |
| `BLOCKED` | Stop, report to user, wait for feedback |

### Step 2c: Auto Git Checkpoint

After each COMPLETED response:

1. Verify commit was made by Implementer
2. Record SHA in `.fusion/status.json`:
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

3. Mark task as completed in TodoWrite
4. **自动继续下一个任务**（不等待人工确认）

**注意**: 仅在 BLOCKED 或错误时停止并等待反馈。

### Step 3: Report (仅在需要时)

**正常情况（无错误）：**
- 自动继续下一任务
- 无需等待人工反馈

**遇到 BLOCKED 或错误时：**
- 显示已完成任务和 checkpoint SHAs
- 显示错误详情
- 停止并等待反馈：「遇到问题，需要反馈。」

**所有任务完成时：**
- 显示所有已完成任务汇总
- 显示所有 checkpoint SHAs
- 自动进入 Step 4（Complete Development）

### Step 4: Complete Development
 
After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## Implementer Agent Workflow (Internal)

The Implementer agent follows this 5-step workflow internally:

```
Step 1: Understand Task → QUESTIONS if unclear
Step 2: Codex Phase 2 - Get prototype (read-only)
Step 3: TDD Implementation (Tier-based)
Step 4: Codex Phase 3 - Review
Step 5: Commit + Report (COMPLETED/BLOCKED)
```

See `implementer.ts` for full agent definition.

## When to Stop and Ask for Help
 
**STOP executing immediately when:**
- Implementer returns BLOCKED
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Multiple tasks fail consecutively
 
**Ask for clarification rather than guessing.**
 
## When to Revisit Earlier Steps
 
**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking
 
**Don't force through blockers** - stop and ask.
 
## Remember
 
- Review plan critically first
- Dispatch Implementer agent per task (not manual implementation)
- Implementer handles Codex prototype + review internally
- Track commit SHAs from Implementer's COMPLETED reports
- Stop when BLOCKED, don't guess
 
## 下一步
 
所有任务完成后：

1. **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
2. 完成后运行 `/archive {change-name}` 归档变更
3. **REQUIRED SUB-SKILL:** Use superpowers:archiving-changes
