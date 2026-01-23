# Proposal: Skill Reminder System

## Problem Statement

当前系统存在以下问题：

1. **直接切换 Agent 绕过 Skill 注入**: 用户从 OpenCode 首页直接切换到 Prometheus 等 agent 时，`delegate_task` 的 `defaultSkills` 合并逻辑被绕过，导致 skill 内容无法注入
2. **注入完整内容消耗上下文**: 现有 `delegate_task` 注入完整 SKILL.md 内容，消耗大量 token
3. **Skill 工作流连续性问题**: 在并行/串行执行和归档流程中，多个 skill 需要连续调用，但缺乏保障机制
4. **执行模式选择无用户确认**: `/start-work` 后自动选择串行/并行，没有询问用户

## Proposed Solution

### 核心思路：提醒优于注入

将 "注入完整 skill 内容" 改为 "提醒有 skill 可用"，让 LLM 按需调用 `skill()` 工具。

### 解决方案组件

1. **动态 Skill 提醒**: 在 `skills.ts` 开头添加动态生成的提醒内容
2. **Agent Init Hook**: 新增 hook，在用户直接切换 agent 时注入 skill 提醒
3. **修改 delegate_task**: 从注入完整内容改为注入提醒
4. **修改 start-work hook**: 添加执行模式选择询问
5. **Skill 工作流连续性保障**: 在 skill 结尾添加"下一步"指引

## Success Criteria

- [ ] 用户直接切换到 Prometheus 时，看到 skill 可用提醒
- [ ] delegate_task 调用时，只注入提醒而非完整内容
- [ ] /start-work 后询问用户选择串行/并行执行模式
- [ ] skill 调用后能自动提示下一个 skill（工作流连续性）
- [ ] 上下文消耗减少 50%+

## Risk Assessment

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| LLM 忽略提醒不调用 skill | 中 | 中 | 使用 MANDATORY 强调 + 多层提醒 |
| 提醒信息过多造成干扰 | 低 | 低 | 精简提醒内容，只显示关键 skill |
| 现有流程依赖完整注入 | 中 | 高 | 保留 `skills` 参数强制注入选项 |

## Alternatives Considered

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| 保持完整注入 | 可靠性高 | 消耗上下文 | ❌ 不采用 |
| 只提醒不注入 | 节省上下文 | 可能被忽略 | ✅ 采用 |
| 混合模式 | 平衡 | 复杂度高 | ⚠️ 作为备选 |
