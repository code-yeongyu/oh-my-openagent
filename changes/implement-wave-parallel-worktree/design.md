# Design: Wave-Aware Execution Skills Enhancement

> **Change**: implement-wave-parallel-worktree
> **Created**: 2026-01-12
> **Version**: V3 - Corrected per user feedback

---

## 1. Goal

增强执行相关Skills，实现：
1. **Sequential模式**: 在`executing-plans`合适位置融入调用`using-git-worktrees`和`subagent-driven-development`，自动git checkpoint
2. **Wave-Parallel模式**: 使用`claude-skills`创建新skill，在前面加入wave分组，调用`using-git-worktrees`创建多worktree，多次调用`subagent-driven-development`

**核心原则**: 不重写现有skills，只在合适位置融入调用。

---

## 2. Architecture

### 2.1 组件关系图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Skills Layer                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │ creating-changes│                                                    │
│  │                 │                                                    │
│  │ 2 options:      │                                                    │
│  │ 1. Sequential   │───────┐                                            │
│  │ 2. Wave-Parallel│───┐   │                                            │
│  └─────────────────┘   │   │                                            │
│                        │   │                                            │
│                        ▼   ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │   ┌─────────────────────┐      ┌─────────────────────────────┐  │   │
│  │   │ executing-plans     │      │ wave-parallel-execution     │  │   │
│  │   │ (修改，不重写)       │      │ (新增skill)                 │  │   │
│  │   │                     │      │                             │  │   │
│  │   │ Step 0: 融入调用    │      │ Step 1: wave分组            │  │   │
│  │   │  using-git-worktrees│      │   调用wave-grouper          │  │   │
│  │   │                     │      │                             │  │   │
│  │   │ Step 2: 融入调用    │      │ Step 2: 调用                │  │   │
│  │   │  subagent-driven-   │      │   using-git-worktrees       │  │   │
│  │   │  development        │      │   (多个worktree)            │  │   │
│  │   │                     │      │                             │  │   │
│  │   │ + 自动git checkpoint │      │ Step 3: 多次调用           │  │   │
│  │   │                     │      │   subagent-driven-          │  │   │
│  │   │                     │      │   development               │  │   │
│  │   │                     │      │   (每wave一次)              │  │   │
│  │   └──────────┬──────────┘      └──────────────┬──────────────┘  │   │
│  │              │                                │                  │   │
│  │              └────────────┬───────────────────┘                  │   │
│  │                           │                                      │   │
│  │                           ▼                                      │   │
│  │   ┌─────────────────────────────────────────────────────────┐   │   │
│  │   │              Shared Skills (不修改，只调用)              │   │   │
│  │   │                                                         │   │   │
│  │   │  ┌───────────────────┐   ┌─────────────────────────┐   │   │   │
│  │   │  │ using-git-        │   │ subagent-driven-        │   │   │   │
│  │   │  │ worktrees         │   │ development             │   │   │   │
│  │   │  │                   │   │                         │   │   │   │
│  │   │  │ 创建worktree      │   │ 分发implementer        │   │   │   │
│  │   │  │ 安全验证          │   │ Spec Review            │   │   │   │
│  │   │  │ 依赖安装          │   │ Quality Review         │   │   │   │
│  │   │  └───────────────────┘   └─────────────────────────┘   │   │   │
│  │   │                                                         │   │   │
│  │   └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ finishing-a-development-branch → archiving-changes              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Shared Layer                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐                            │
│  │ wave-grouper.ts  │  │ task-parser.ts   │                            │
│  │ (已存在)          │  │ (已存在)          │                            │
│  │                  │  │                  │                            │
│  │ groupTasksInto   │  │ parseTasksMd()   │                            │
│  │ Waves()          │  │                  │                            │
│  └──────────────────┘  └──────────────────┘                            │
│                                                                         │
│  需要: 添加到 index.ts 导出                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流 - Sequential模式

```
                    tasks.md
                        │
                        ▼
              ┌─────────────────┐
              │ creating-changes│
              │   Sequential   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────────────────────────────┐
              │ executing-plans skill (融入调用)        │
              │                                         │
              │ Step 0:                                 │
              │   调用 using-git-worktrees skill       │
              │     → 创建单个worktree                 │
              │     → 安全验证、依赖安装、测试         │
              │                                         │
              │ Step 1: Load Plan (现有，不变)          │
              │                                         │
              │ Step 2: Execute Batch (现有流程)        │
              │   For each task:                        │
              │     2a. Codex Prototype (现有)          │
              │     2b. Implementation (现有)           │
              │     2c. Codex Review (现有)             │
              │     2d. 自动git checkpoint (修改)       │
              │         git commit + 自动继续           │
              │                                         │
              │ Step 3-5: (现有，不变)                  │
              └─────────────────────────────────────────┘
                       │
                       ▼
              finishing → archiving
```

### 2.3 数据流 - Wave-Parallel模式

```
                    tasks.md
                        │
                        ▼
              ┌─────────────────┐
              │ creating-changes│
              │  Wave-Parallel │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────────────────────────────┐
              │ wave-parallel-execution skill (新增)   │
              │                                         │
              │ Step 1: Wave分组                        │
              │   调用 wave-grouper                     │
              │     → 分析依赖、检测冲突               │
              │     → 分组为Waves                       │
              │   IF waves.length == 1:                 │
              │     → 降级为Sequential                  │
              │     → 调用 executing-plans              │
              │                                         │
              │ Step 2: 创建多worktree                  │
              │   For each Wave:                        │
              │     调用 using-git-worktrees skill     │
              │       → feature/{name}-wave{N}         │
              │                                         │
              │ Step 3: 多次调用subagent-driven-dev    │
              │   ┌─────────┐ ┌─────────┐ ┌─────────┐  │
              │   │ Wave 0  │ │ Wave 1  │ │ Wave 2  │  │
              │   │         │ │         │ │         │  │
              │   │ 调用    │ │ 调用    │ │ 调用    │  │
              │   │ sub-    │ │ sub-    │ │ sub-    │  │
              │   │ agent-  │ │ agent-  │ │ agent-  │  │
              │   │ driven  │ │ driven  │ │ driven  │  │
              │   │         │ │         │ │         │  │
              │   │ 串行    │ │ 串行    │ │ 串行    │  │
              │   │ tasks   │ │ tasks   │ │ tasks   │  │
              │   └─────────┘ └─────────┘ └─────────┘  │
              │        ↑ Waves之间并行 ↑               │
              │                                         │
              │ Step 4: 合并清理                        │
              │   调用 finishing-a-development-branch  │
              │   调用 archiving-changes               │
              └─────────────────────────────────────────┘
```

---

## 3. Tech Stack

| 层级 | 技术 |
|------|------|
| Runtime | Bun |
| Testing | bun:test |
| Types | TypeScript strict |
| Skill Creation | claude-skills技能 |
| Git Operations | 通过using-git-worktrees skill |

---

## 4. File Structure

### 4.1 需要修改的文件

```
src/shared/index.ts                              # 添加导出
src/features/builtin-skills/
├── creating-changes/SKILL.md                    # 选项3→2
└── executing-plans/SKILL.md                     # 融入调用
```

### 4.2 需要新增的文件

```
src/features/builtin-skills/
└── wave-parallel-execution/
    ├── SKILL.md                                 # 新skill主文件
    └── wave-dispatch.md                         # Wave分发流程
```

---

## 5. Key Decisions

### 5.1 为什么不重写executing-plans？

| 考虑因素 | 决策 |
|----------|------|
| 稳定性 | executing-plans已有完整流程，重写有风险 |
| 复用性 | 现有Step 1-5可以直接复用 |
| 维护性 | 融入调用比重写更容易维护 |
| 测试 | 现有测试继续有效 |

**决策**: 在合适位置融入调用，不重写核心逻辑

### 5.2 为什么使用claude-skills创建新skill？

| 考虑因素 | 决策 |
|----------|------|
| 分离关注点 | Wave分组是新功能 |
| 复用现有 | 新skill调用现有skills |
| 可扩展 | 独立skill更容易测试 |

**决策**: 使用claude-skills技能创建`wave-parallel-execution` skill

### 5.3 自动git checkpoint

| 修改点 | 内容 |
|--------|------|
| 位置 | Step 2，每个task完成后 |
| 命令 | `git commit -m "checkpoint: Task {taskId}: {description}"` |
| 替代 | 人工检查点（Step 3等待反馈） |

**决策**: 自动checkpoint，减少人工介入

### 5.4 subagent-driven-development调用方式

| 模式 | 调用方式 |
|------|----------|
| Sequential | 每个task调用一次，串行执行 |
| Wave-Parallel | 每个wave调用一次，wave内串行，wave间并行 |

**决策**: 保留subagent-driven-development原有流程，只是调用方式不同

---

## 6. executing-plans 修改详情

### 6.1 Step 0 修改

**Before:**
```markdown
### Step 0: Environment Check

1. 检查 Worktree
2. 检查 Plan
3. 恢复状态 (如有)
```

**After:**
```markdown
### Step 0: Environment Check

1. **检查 Plan**
   - 确认 tasks.md 存在

2. **调用 using-git-worktrees skill**
   - 创建worktree: `feature/{change-name}`
   - 安全验证 (.gitignore)
   - 依赖安装
   - Baseline测试

3. **恢复状态 (如有)**
   - 读取 .fusion/status.json
```

### 6.2 Step 2d 修改

**Before:**
```markdown
### Step 2d: Commit and Track

1. Commit with descriptive message including task ID
2. Record SHA in .fusion/status.json
3. Mark as completed
```

**After:**
```markdown
### Step 2d: 自动git checkpoint

1. Git commit with checkpoint message
   ```bash
   git commit -m "checkpoint: Task {taskId}: {description}"
   ```

2. Record SHA in .fusion/status.json

3. Mark as completed

4. **自动继续下一个任务**（不等待人工确认）
```

---

## 7. wave-parallel-execution Skill结构

```markdown
---
name: wave-parallel-execution
description: Use when executing plans with multiple independent waves that can run in parallel
---

# Wave-Parallel Execution

## Overview

执行包含多个独立Wave的计划，Wave间并行执行，Wave内串行执行。

## The Process

### Step 1: Wave分组计算

1. 调用 parseTasksMd() + groupTasksIntoWaves()
2. 检测依赖和文件冲突
3. 分组为Waves

IF waves.length === 1:
  → 降级为Sequential
  → 调用 executing-plans skill
  → RETURN

### Step 2: 调用 using-git-worktrees skill

For each Wave:
  - 调用 using-git-worktrees
  - 创建 `feature/{name}-wave{N}`

### Step 3: 多次调用 subagent-driven-development skill

For each Wave (并行):
  - 调用 subagent-driven-development skill
  - 传入该Wave的tasks
  - 在对应worktree中执行
  - 保留原有分发流程

### Step 4: 合并清理

1. 调用 finishing-a-development-branch
   - 按顺序合并wave分支
2. 调用 archiving-changes
   - 清理worktrees
```

---

## 8. Edge Cases

### 8.1 单Wave降级

```typescript
if (waves.length === 1) {
  // 不需要并行，降级为Sequential
  log.info("Only 1 wave detected, using Sequential mode")
  // 调用 executing-plans skill
}
```

### 8.2 Worktree创建失败

```
IF using-git-worktrees fails:
    → 警告用户
    → 询问是否在当前目录继续
    → 用户确认后继续
```

---

## 9. Testing Strategy

### 9.1 单元测试

| 模块 | 测试重点 |
|------|----------|
| wave-grouper | groupTasksIntoWaves() 分组正确 |
| task-parser | parseTasksMd() 解析正确 |

### 9.2 集成测试

| 场景 | 验证点 |
|------|--------|
| Sequential完整流程 | using-git-worktrees调用 → subagent-driven-development调用 → 自动checkpoint |
| Wave-Parallel完整流程 | wave分组 → 多worktree → 多次subagent-driven-development调用 |
| 降级场景 | 单Wave → Sequential |

---

*Design document for implement-wave-parallel-worktree*
