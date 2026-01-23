# Design: Skill Reminder System

## Goal

实现"提醒优于注入"的 Skill 系统，覆盖以下场景：
1. 用户直接切换 Agent（绕过 delegate_task）
2. 通过 delegate_task 调用 Agent
3. /start-work 后的执行模式选择
4. Skill 工作流连续调用

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Skill Reminder System                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ Layer 1             │  │ Layer 2             │  │ Layer 3             │  │
│  │ keyword-detector    │  │ delegate_task       │  │ agent-init-hook     │  │
│  │ (已有，保持不变)     │  │ (修改：注入→提醒)   │  │ (新增)              │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│           │                        │                        │               │
│           ▼                        ▼                        ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Skill Reminder Generator                          │    │
│  │  generateSkillReminder(agentName, skills[]) → reminder text          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Skill Workflow Continuity                         │    │
│  │  每个 SKILL.md 结尾添加 "## Next Step" 指引下一个 skill              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Testing**: bun test
- **Hooks**: OpenCode Plugin Hook System

## File Structure

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/hooks/agent-skill-reminder/index.ts` | Agent 初始化时注入 skill 提醒 |
| `src/hooks/agent-skill-reminder/constants.ts` | 提醒模板和配置 |
| `src/hooks/agent-skill-reminder/types.ts` | 类型定义 |
| `src/shared/skill-reminder-generator.ts` | 统一的提醒生成函数 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/tools/delegate-task/tools.ts` | 从注入完整内容改为注入提醒 |
| `src/hooks/start-work/index.ts` | 添加执行模式选择询问 |
| `src/features/builtin-skills/skills.ts` | 动态生成 skill 提醒内容 |
| 各 `SKILL.md` 文件 | 添加 "## Next Step" 工作流指引 |

## Key Decisions

### Decision 1: 提醒内容格式

```markdown
## 🔧 Available Skills for {AgentName}

| Skill | When to Use |
|-------|-------------|
| `brainstorming` | Before creating any plan |
| `creating-changes` | When writing design.md/tasks.md |

**Usage**: `skill("skill-name")`

⚠️ **MANDATORY**: Call relevant skills before starting work.
```

### Decision 2: Agent → defaultSkills 映射调整

| Agent | 当前 defaultSkills | 调整后 defaultSkills |
|-------|-------------------|---------------------|
| Prometheus (Planner) | `[creating-changes, dispatching-parallel-agents]` | `[brainstorming, creating-changes, dispatching-parallel-agents]` |
| Metis (Plan Consultant) | `[brainstorming, codex-mcp-collaboration]` | 保持不变 |
| Momus (Plan Reviewer) | `[verification-before-completion]` | 保持不变 |

### Decision 3: /start-work 执行模式选择

```typescript
// 使用 Question 工具询问用户
Question({
  questions: [{
    question: "选择执行模式",
    header: "执行模式",
    options: [
      { label: "串行执行 (推荐 ≤5 任务)", description: "逐个任务执行，每任务自动 git checkpoint" },
      { label: "并行执行 (推荐 >5 任务)", description: "按 Wave 分组并行执行，自动创建 worktree" },
      { label: "自动选择", description: "根据任务数量自动决定" }
    ]
  }]
})
```

### Decision 4: Skill 工作流连续性

在每个 SKILL.md 结尾添加：

```markdown
## Next Step

根据当前阶段，调用下一个 skill：

| 当前完成 | 下一步 | Skill |
|----------|--------|-------|
| brainstorming | 创建计划文件 | `skill("creating-changes")` |
| creating-changes | 开始执行 | `skill("executing-plans")` 或 `skill("wave-parallel-execution")` |
| executing-plans | 验证完成 | `skill("verification-before-completion")` |
| verification | 完成分支 | `skill("finishing-a-development-branch")` |
| finishing | 归档 | `skill("archiving-changes")` |
```

## Edge Cases

| 场景 | 处理方式 |
|------|----------|
| Agent 无 defaultSkills | 不注入任何提醒 |
| 用户明确要求注入完整内容 | 使用 `skills` 参数强制注入 |
| Skill 调用失败 | 保留错误信息，建议手动调用 |
| 用户跳过 skill 调用 | 在关键节点再次提醒 |

## Open Questions

1. ~~是否需要在 skills.ts 开头动态内联提醒？~~ → 是，作为 Task 1 实现
2. ~~提醒频率如何控制？~~ → 首次消息时注入，后续不重复
3. 是否需要记录用户是否已调用过某 skill？→ 暂不需要，保持简单
