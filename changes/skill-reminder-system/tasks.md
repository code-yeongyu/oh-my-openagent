# Tasks: Skill Reminder System

## Overview

- **Total Tasks**: 8
- **Phases**: 4
- **Estimated Time**: 2-3 hours
- **Risk Level**: Medium

---

## Phase 1: 基础设施 (Infrastructure)

### Task 1: 创建 Skill Reminder Generator 共享模块

**File**: `src/shared/skill-reminder-generator.ts` (新建)

**What to do**:
- 创建 `generateSkillReminder(agentName: string, skills: string[]): string` 函数
- 返回格式化的 skill 提醒文本
- 支持动态生成 skill 描述（从 skill 定义中读取 description）

**Acceptance Criteria**:
- [ ] 函数接收 agent 名称和 skill 列表
- [ ] 返回 markdown 格式的提醒文本
- [ ] 包含 skill 名称、用途、调用方式
- [ ] 单元测试通过

**Risk Tier**: 2 (需要测试)

**Dependencies**: 无

---

### Task 2: 更新 AGENT_DEFAULT_SKILLS 配置

**File**: `src/tools/delegate-task/constants.ts` (修改)

**What to do**:
- 将 `Prometheus (Planner)` 的 defaultSkills 改为 `["brainstorming", "creating-changes", "dispatching-parallel-agents"]`
- 添加注释说明每个 skill 的用途

**Acceptance Criteria**:
- [ ] Prometheus defaultSkills 包含 3 个 skill
- [ ] 类型检查通过 (`bun run typecheck`)
- [ ] 配置格式正确

**Risk Tier**: 1 (配置变更)

**Dependencies**: 无

---

## Phase 2: Hook 修改 (Hook Modifications)

### Task 3: 修改 delegate_task 从注入改为提醒

**File**: `src/tools/delegate-task/tools.ts` (修改)

**What to do**:
- 导入 `generateSkillReminder` 函数
- 修改 `skillContent` 生成逻辑：
  - 如果用户显式传入 `skills` 参数 → 保持原有行为（注入完整内容）
  - 如果只有 `defaultSkills` → 改为生成提醒文本
- 添加 `injectFullContent?: boolean` 选项用于强制注入

**Acceptance Criteria**:
- [ ] defaultSkills 只生成提醒，不注入完整内容
- [ ] 用户显式传入 skills 时仍注入完整内容
- [ ] 现有测试通过
- [ ] 新增测试覆盖提醒模式

**Risk Tier**: 3 (核心逻辑变更)

**Dependencies**: Task 1

---

### Task 4: 创建 agent-skill-reminder Hook

**Files**: 
- `src/hooks/agent-skill-reminder/index.ts` (新建)
- `src/hooks/agent-skill-reminder/constants.ts` (新建)
- `src/hooks/agent-skill-reminder/types.ts` (新建)

**What to do**:
- 创建 `createAgentSkillReminderHook` 函数
- 监听 `chat.message` 事件
- 检测用户直接切换 agent（非 delegate_task 调用）
- 在首次消息时注入 skill 提醒
- 使用 Set 跟踪已处理的 session，避免重复注入

**Acceptance Criteria**:
- [ ] 用户直接切换到 Prometheus 时看到 skill 提醒
- [ ] 不干扰通过 delegate_task 调用的流程
- [ ] 每个 session 只注入一次
- [ ] Hook 正确导出和注册

**Risk Tier**: 3 (新增 Hook)

**Dependencies**: Task 1

---

### Task 5: 修改 start-work Hook 添加执行模式选择

**File**: `src/hooks/start-work/index.ts` (修改)

**What to do**:
- 读取 tasks.md 统计任务数量
- 使用 Question 工具询问用户选择执行模式
- 根据用户选择注入相应的 skill 调用指令
- 添加推荐标签（≤5 推荐串行，>5 推荐并行）

**Acceptance Criteria**:
- [ ] /start-work 后显示执行模式选择
- [ ] 选项包含：串行、并行、自动
- [ ] 用户选择后注入对应 skill 调用指令
- [ ] 任务数量正确统计并显示

**Risk Tier**: 3 (核心流程变更)

**Dependencies**: 无

---

## Phase 3: Skill 工作流连续性 (Workflow Continuity)

### Task 6: 为核心 Skill 添加 "Next Step" 指引

**Files**: (修改)
- `src/features/builtin-skills/brainstorming/SKILL.md`
- `src/features/builtin-skills/creating-changes/SKILL.md`
- `src/features/builtin-skills/executing-plans/SKILL.md`
- `src/features/builtin-skills/wave-parallel-execution/SKILL.md`
- `src/features/builtin-skills/verification-before-completion/SKILL.md`
- `src/features/builtin-skills/finishing-a-development-branch/SKILL.md`

**What to do**:
- 在每个 SKILL.md 结尾添加 `## Next Step` 部分
- 明确指出完成当前 skill 后应调用哪个 skill
- 使用表格格式便于 LLM 理解

**Next Step 映射**:
```
brainstorming → creating-changes
creating-changes → executing-plans / wave-parallel-execution
executing-plans → verification-before-completion
wave-parallel-execution → verification-before-completion
verification-before-completion → finishing-a-development-branch
finishing-a-development-branch → archiving-changes
```

**Acceptance Criteria**:
- [ ] 6 个核心 SKILL.md 都有 Next Step 部分
- [ ] 工作流链路完整
- [ ] 格式一致

**Risk Tier**: 1 (文档变更)

**Dependencies**: 无

---

## Phase 4: 集成与测试 (Integration & Testing)

### Task 7: 注册新 Hook 到插件系统

**File**: `src/index.ts` (修改)

**What to do**:
- 导入 `createAgentSkillReminderHook`
- 在 hooks 数组中添加新 hook
- 确保 hook 顺序正确（在 keyword-detector 之后）

**Acceptance Criteria**:
- [ ] Hook 正确注册
- [ ] 插件启动无错误
- [ ] `bun run typecheck` 通过

**Risk Tier**: 2 (集成)

**Dependencies**: Task 4

---

### Task 8: 端到端测试

**What to do**:
- 测试场景 1: 用户直接切换到 Prometheus → 验证看到 skill 提醒
- 测试场景 2: Sisyphus 调用 delegate_task(agent="Prometheus") → 验证只有提醒
- 测试场景 3: 用户调用 delegate_task(skills=["tdd"]) → 验证注入完整内容
- 测试场景 4: /start-work → 验证执行模式选择出现
- 测试场景 5: 调用 brainstorming skill → 验证 Next Step 显示

**Acceptance Criteria**:
- [ ] 5 个场景全部通过
- [ ] 无回归问题
- [ ] `bun run build` 通过

**Risk Tier**: 3 (验证)

**Dependencies**: Task 1-7

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| Phase 1 | 1-2 | 基础设施和配置 |
| Phase 2 | 3-5 | Hook 修改和创建 |
| Phase 3 | 6 | Skill 工作流连续性 |
| Phase 4 | 7-8 | 集成和测试 |

**Parallelization**:
- Task 1 和 Task 2 可并行
- Task 3 和 Task 4 依赖 Task 1，但彼此可并行
- Task 5 和 Task 6 可并行
- Task 7 依赖 Task 4
- Task 8 依赖所有前置任务
