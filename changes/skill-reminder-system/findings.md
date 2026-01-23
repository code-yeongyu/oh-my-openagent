# Findings: Skill Reminder System

## Requirements (from brainstorming session)

### 核心需求

1. **提醒优于注入**: 将 skill 完整内容注入改为提醒 + 按需调用
2. **覆盖直接切换 Agent 场景**: 用户从首页切换 agent 时也能看到 skill 提醒
3. **执行模式用户选择**: /start-work 后询问用户选择串行/并行
4. **Skill 工作流连续性**: 保证多个 skill 能连续调用

### 用户原话

- "调用skills还需要调整一下，用来应对直接切换agent的情况下"
- "Prometheus Subagent需要brainstorm和creatingchanges，和 dispatching-parallel-agents"
- "/start work需要提醒orchestrator询问用户选择并行还是串行"
- "在并行串行中和存档中都有好几处都是单独调用skill形成的工作流，怎么保证能够正常连续调用？"

## Research Findings

### 现有 defaultSkills 配置

```typescript
// src/tools/delegate-task/constants.ts
export const AGENT_DEFAULT_SKILLS: Record<string, string[]> = {
  "Metis (Plan Consultant)": ["brainstorming", "codex-mcp-collaboration"],
  "Prometheus (Planner)": ["creating-changes", "dispatching-parallel-agents"],  // 缺少 brainstorming
  "Momus (Plan Reviewer)": ["verification-before-completion"],
  "archiver": ["verification-before-completion", "finishing-a-development-branch", "archiving-changes"],
  "frontend-ui-ux-engineer": ["frontend-ui-ux", "playwright"],
}
```

### 现有 keyword-detector 已实现提醒模式

```typescript
// [brainstorm-mode] 已要求调用 skill
message: `[brainstorm-mode]
**MANDATORY**: Invoke skill("brainstorming") NOW.
...
After brainstorming → use skill("creating-changes") to write design.md and tasks.md.`
```

### delegate_task 当前行为

- 行 353: 加载 skill 的完整 SKILL.md 内容
- 行 358: 将所有 skill 内容拼接
- 行 375: 注入到 subagent 的 system prompt
- **问题**: 完整内容消耗大量上下文

### 直接切换 Agent 问题

- 用户从首页切换到 Prometheus 时绕过 delegate_task
- AGENT_DEFAULT_SKILLS 配置不生效
- 无任何 skill 提醒

## Technical Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 提醒 vs 注入 | 提醒 | 节省上下文，按需加载 |
| 提醒位置 | chat.message hook | 覆盖所有入口 |
| Prometheus defaultSkills | 添加 brainstorming | 完整规划流程需要 |
| 执行模式选择 | Question 工具 | 标准化用户交互 |
| 工作流连续性 | SKILL.md 添加 Next Step | 在 skill 内容中引导 |

## Issues Encountered

1. **目标流程图文件名特殊字符**: 文件名包含 `###`，需要注意路径处理
2. **Hook 作用范围复杂**: 不同 hook 有不同的 session 过滤逻辑
3. **Skill 工作流链路长**: brainstorming → creating-changes → executing-plans → verification → finishing → archiving

## Resources

- `src/tools/delegate-task/constants.ts` - AGENT_DEFAULT_SKILLS 配置
- `src/tools/delegate-task/tools.ts` - delegate_task 实现
- `src/hooks/keyword-detector/constants.ts` - 关键词检测和提醒模板
- `src/hooks/start-work/index.ts` - /start-work 命令处理
- `src/features/builtin-skills/` - 所有 SKILL.md 文件
