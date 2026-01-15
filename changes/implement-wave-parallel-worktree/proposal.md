# Proposal: Wave-Aware Execution Skills Enhancement

> **Change Name**: implement-wave-parallel-worktree
> **Created**: 2026-01-12
> **Status**: Draft (V3 - Corrected per user feedback)

---

## 1. 问题分析

### 1.1 现有设计的问题

`creating-changes` skill 当前提供3个执行选项：

```
1. Subagent-Driven (推荐)
2. Sequential (当前会话)
3. Create Worktree First (隔离)
```

**问题：选项3是错误的抽象！**

- Worktree 不应该是"执行方式"，而是"执行环境"
- 用户不应该在"是否用worktree"和"串行/并行"之间做两次选择
- 正确的做法：worktree是执行方式的**内置部分**

### 1.2 现有代码状态

| 组件 | 状态 | 问题 |
|------|------|------|
| `wave-grouper.ts` | 完整算法 | 未导出，未被调用 |
| `task-parser.ts` | 完整解析器 | 未导出，未被调用 |
| `executing-plans` | 逐个任务执行 | 不支持worktree + 自动checkpoint |
| `subagent-driven-development` | 逐个dispatch | 已有完整subagents分发流程 |
| `using-git-worktrees` | 完整实现 | 已支持安全创建worktree |

---

## 2. 设计目标

### 2.1 核心原则

**不重写现有skills，只在合适位置融入调用。**

| Skill | 角色 | 保持不变 |
|-------|------|----------|
| `executing-plans` | 执行基础 | ✅ 核心流程保留 |
| `subagent-driven-development` | Subagents分发 | ✅ 完整保留 |
| `using-git-worktrees` | Worktree管理 | ✅ 完整保留 |

### 2.2 新的执行选项

修改 `creating-changes` skill，提供**2个**选项：

```
1. Sequential (推荐小型任务)
   → 基础: executing-plans skill (不重写)
   → 在前面加入: 调用 using-git-worktrees (创建单个worktree)
   → 保留现有执行流程: Codex Prototype → Implementation → Codex Review
   → 修改: 人工检查点 → 自动git checkpoint (每任务完成后git commit)

2. Wave-Parallel (推荐复杂任务)
   → 新增skill: wave-parallel-execution
   → 在前面加入: wave分组算法 (调用wave-grouper)
   → 调用: using-git-worktrees (创建多个wave worktree)
   → 多次分wave调用: subagent-driven-development (让implementer执行)
   → 所有完成后: 统一合并清理
```

### 2.3 关键改变

| Before | After |
|--------|-------|
| Worktree是独立选项 | Worktree是内置环境 |
| 直接git创建worktree | 调用using-git-worktrees skill |
| 人工检查点 | 自动git checkpoint (每任务后commit) |
| 无wave分组 | 新skill添加wave分组支持 |
| 单worktree | 支持多worktree管理 |

---

## 3. 详细设计

### 3.1 选项1: Sequential 执行流程

**基础**: `executing-plans` skill (不重写，只在合适位置融入)

```
用户选择: Sequential
         │
         ▼
creating-changes完成
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 调用: executing-plans skill (保持现有流程)                 │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 0: Environment Check (现有)                        │ │
│ │   + 新增: 调用 using-git-worktrees skill               │ │
│ │     - 创建单个worktree: feature/{change-name}          │ │
│ │     - 安全验证 (.gitignore, 目录选择)                  │ │
│ │     - 依赖安装 (npm install等)                         │ │
│ │     - baseline测试验证                                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 1: Load and Review Plan (现有，保持不变)          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 2: Execute Batch (现有流程，修改checkpoint)       │ │
│ │                                                         │ │
│ │   For each task (现有流程，保持不变):                   │ │
│ │     2a. Codex Prototype                                 │ │
│ │     2b. Implementation                                  │ │
│ │     2c. Codex Review                                    │ │
│ │                                                         │ │
│ │   2d. 修改: 自动git checkpoint (代替人工检查点)        │ │
│ │     git commit -m "checkpoint: Task {taskId}: {desc}"   │ │
│ │     自动继续下一任务，不等待人工确认                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 3-5: Report, Continue, Complete (现有，保持不变)  │ │
│ │   → finishing-a-development-branch                      │ │
│ │   → archiving-changes                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**关键特性**：
- **不重写executing-plans**: 只在合适位置融入调用
- **调用using-git-worktrees**: 在Step 0创建worktree
- **保留现有执行流程**: Step 2的Codex协作流程保持不变
- **自动checkpoint**: 每任务后git commit，代替人工检查点

### 3.2 选项2: Wave-Parallel 执行流程

**新增skill**: `wave-parallel-execution` (使用claude-skills技能创建)

```
用户选择: Wave-Parallel
         │
         ▼
creating-changes完成
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 调用: wave-parallel-execution skill (新增)                 │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 1: Wave分组计算                                    │ │
│ │                                                         │ │
│ │   parseTasksMd(tasks.md)                                │ │
│ │     → 调用wave-grouper算法                              │ │
│ │     → 检测文件冲突                                      │ │
│ │     → 计算依赖关系                                      │ │
│ │     → 分组为Waves                                       │ │
│ │                                                         │ │
│ │   IF waves.length == 1:                                 │ │
│ │     → 降级为Sequential模式                              │ │
│ │     → 调用executing-plans (已融入worktree+subagents)    │ │
│ │     → RETURN                                            │ │
│ │                                                         │ │
│ │   更新tasks.md添加Wave信息:                             │ │
│ │   <!-- Wave 0: Task 1.1, 1.2 -->                        │ │
│ │   <!-- Wave 1: Task 2.1 -->                             │ │
│ │   <!-- Wave 2: Task 3.1, 3.2 -->                        │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 2: 调用 using-git-worktrees skill                 │ │
│ │                                                         │ │
│ │   For each Wave:                                        │ │
│ │     调用 using-git-worktrees                            │ │
│ │       → 创建worktree: feature/{name}-wave{N}            │ │
│ │       → 安全验证 (.gitignore)                           │ │
│ │       → 依赖安装                                        │ │
│ │       → baseline测试                                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 3: 多次分Wave调用 subagent-driven-development     │ │
│ │                                                         │ │
│ │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │ │
│ │   │ Wave 0      │ │ Wave 1      │ │ Wave 2      │       │ │
│ │   │ worktree-0  │ │ worktree-1  │ │ worktree-2  │       │ │
│ │   │             │ │             │ │             │       │ │
│ │   │ 调用        │ │ 调用        │ │ 调用        │       │ │
│ │   │ subagent-   │ │ subagent-   │ │ subagent-   │       │ │
│ │   │ driven-dev  │ │ driven-dev  │ │ driven-dev  │       │ │
│ │   │     ↓       │ │     ↓       │ │     ↓       │       │ │
│ │   │ Task 1.1    │ │ Task 2.1    │ │ Task 3.1    │       │ │
│ │   │     ↓       │ │     ↓       │ │     ↓       │       │ │
│ │   │ Task 1.2    │ │   完成      │ │ Task 3.2    │       │ │
│ │   │     ↓       │ │             │ │     ↓       │       │ │
│ │   │   完成      │ │             │ │   完成      │       │ │
│ │   └─────────────┘ └─────────────┘ └─────────────┘       │ │
│ │                                                         │ │
│ │   每个Wave:                                             │ │
│ │     调用 subagent-driven-development skill              │ │
│ │       → 传入该Wave的tasks                               │ │
│ │       → 在对应worktree中执行                            │ │
│ │       → 保留原有subagents分发流程                       │ │
│ │       → 包含: Spec Review + Quality Review              │ │
│ │                                                         │ │
│ │   Wave内: 任务串行执行 (subagent-driven-development)    │ │
│ │   Waves之间: 并行执行                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Step 4: 合并与清理                                      │ │
│ │                                                         │ │
│ │   调用 finishing-a-development-branch                   │ │
│ │     → 按顺序合并所有wave分支                            │ │
│ │     → 处理合并冲突                                      │ │
│ │                                                         │ │
│ │   调用 archiving-changes                                │ │
│ │     → 清理所有wave worktrees                            │ │
│ │     → 归档变更文档                                      │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**关键特性**：
- **新增skill**: 使用claude-skills技能创建 `wave-parallel-execution`
- **调用wave-grouper**: 在前面加入wave分组算法
- **调用using-git-worktrees**: 创建多个wave worktree
- **多次调用subagent-driven-development**: 每个wave调用一次，保留原有分发流程
- **Wave内串行，Wave间并行**: 依赖subagent-driven-development的串行执行

---

## 4. 实现组件

### 4.1 需要修改的Skills

| Skill | 修改内容 | 修改程度 |
|-------|----------|----------|
| `creating-changes` | 选项从3个改为2个 | 小改 |
| `executing-plans` | 在Step 0调用using-git-worktrees，Step 2d改为自动checkpoint | 融入，不重写 |

### 4.2 需要新增的Skills

| Skill | 内容 | 创建方式 |
|-------|------|----------|
| `wave-parallel-execution` | Wave分组 + 多worktree + 多次调用subagent-driven-development | 使用claude-skills技能创建 |

### 4.3 需要导出的模块

```typescript
// src/shared/index.ts 添加:
export * from "./wave-grouper"
export * from "./task-parser"
```

---

## 5. 关键设计决策

### 5.1 为什么不重写现有skills？

| 考虑因素 | 决策 |
|----------|------|
| 稳定性 | 现有skills已经过测试，重写有风险 |
| 复用性 | subagent-driven-development已有完整分发流程 |
| 维护性 | 融入调用比重写更容易维护 |

**决策**: 在executing-plans合适位置融入调用，不重写核心逻辑

### 5.2 为什么新增wave-parallel-execution skill？

| 考虑因素 | 决策 |
|----------|------|
| 分离关注点 | Wave分组是新功能，不应该污染现有skills |
| 复用现有 | 新skill调用现有skills，保持一致性 |
| 可扩展 | 独立skill更容易扩展和测试 |

**决策**: 使用claude-skills技能创建新skill，专注wave分组和多worktree管理

### 5.3 人工检查点改为自动git checkpoint

| Before | After |
|--------|-------|
| Step 3: Report (等待反馈) | 每任务后自动git commit |
| 人工控制何时继续 | 自动继续，commit记录检查点 |

**决策**: 自动git checkpoint，每任务完成后立即commit

```bash
git commit -m "checkpoint: Task {taskId}: {description}"
```

### 5.4 Wave降级策略

```
IF wave-parallel mode detects only 1 wave:
    → 降级为Sequential模式
    → 调用executing-plans (已融入worktree + subagents)
```

---

## 6. 错误处理

### 6.1 Worktree创建失败

```
IF using-git-worktrees fails:
    → 警告用户: "无法创建隔离环境"
    → 询问: 继续在当前目录执行？
    → 用户确认后继续
```

### 6.2 合并冲突

```
IF merging waves encounters conflicts:
    → 暂停合并
    → 显示冲突文件
    → 用户选择:
       - 手动解决
       - 使用ours/theirs
       - 保留worktrees稍后处理
```

---

## 7. 验收标准

- [ ] creating-changes 只显示2个选项 (Sequential / Wave-Parallel)
- [ ] Sequential: executing-plans融入调用using-git-worktrees (Step 0)
- [ ] Sequential: executing-plans保留现有Step 2a-2c Codex协作流程
- [ ] Sequential: executing-plans Step 2d改为自动git checkpoint
- [ ] Wave-Parallel: 新skill wave-parallel-execution 创建成功
- [ ] Wave-Parallel: 调用wave-grouper进行分组
- [ ] Wave-Parallel: 调用using-git-worktrees创建多worktree
- [ ] Wave-Parallel: 多次调用subagent-driven-development (每wave一次)
- [ ] Wave-Parallel: 只有1个Wave时自动降级为Sequential
- [ ] 所有测试通过
- [ ] Windows/macOS/Linux兼容

---

## 8. 实现顺序

### Phase 1: 基础设施 (0.5天)

1. 导出wave-grouper和task-parser到shared/index.ts

### Phase 2: 修改executing-plans (1天)

2. 在Step 0融入调用using-git-worktrees
3. 在Step 2融入调用subagent-driven-development
4. 将人工检查点改为自动git checkpoint

### Phase 3: 创建wave-parallel-execution skill (1.5天)

5. 使用claude-skills技能创建新skill
6. 实现Step 1: wave分组计算
7. 实现Step 2: 调用using-git-worktrees创建多worktree
8. 实现Step 3: 多次调用subagent-driven-development
9. 实现Step 4: 调用finishing + archiving

### Phase 4: 修改其他Skills (0.5天)

10. 修改creating-changes选项 (3个→2个)
11. 测试

---

*Proposal created by brainstorming skill*
*Next step: Use creating-changes skill to write design.md and tasks.md*
