# Proposal: 修复 findings 覆盖 + 分批写入计划 + 关键词模式同步 + Agent 错误

## Problem Statement

当前 oh-my-opencode 存在四个相互关联的问题：

### 问题 1: findings.md/progress.md 被覆盖
- **症状**: 多个 Task 完成后，findings.md 只保留最后一个 Task 的记录
- **根因**: `sisyphus-junior-notepad` 提示词矛盾 - 说 "Always APPEND" 但又说 "never use Edit tool"
- **影响**: 验证工作的发现丢失，无法追踪完整的工作历史

### 问题 2: tasks.md 写入失败
- **症状**: `AI_TypeValidationError: Stream error: error decoding response body`
- **根因**: Prometheus/creating-changes 一次性生成大型 tasks.md，流式响应中断
- **影响**: 无法创建完整的工作计划

### 问题 3: brainstorm-mode 与 skill 不同步
- **症状**: keyword-detector 中的 brainstorm-mode 提示词与 brainstorming skill 内容不一致
- **根因**: 提示词硬编码在 constants.ts 中，不会随 skill 更新
- **影响**: 用户看到的指引与实际 skill 行为不匹配

### 问题 4: agent.name undefined 错误
- **症状**: `TypeError: undefined is not an object (evaluating 'agent.name')` at `src/session/prompt.ts:838`
- **根因**: **observer agent 没有在 `agentSources` 中注册**
  - `createObserverAgent` 在 `src/agents/observer.ts` 中定义
  - 但未添加到 `src/agents/utils.ts` 的 `agentSources` 对象中
  - `observer-detector` hook 调用 `subagent_type: "observer"` 时找不到 agent
- **影响**: 后台任务失败，无法完成自动分析

## Proposed Solution

### 解决方案 1: 强制 Edit 追加模式
1. 修正所有相关提示词，明确指示使用 Edit 追加
2. 创建 `notepad-write-guard` Hook，拦截对 findings.md/progress.md 的 Write 操作
3. 在每个 Task 末尾添加强制更新 findings/progress/todo 的提醒

### 解决方案 2: 分批写入 tasks.md
1. 修改 creating-changes skill，改为分批写入模式
2. 使用 skill("progressive-disclosure-md") 从 proposal/design 提取上下文
3. 每个 Task 嵌入相关的设计上下文摘要

### 解决方案 3: 关键词模式动态化
1. 修改 keyword-detector，简化 mode 提示词为调用 skill 的指引
2. 避免硬编码完整内容，让用户通过 skill() 获取最新指令

### 解决方案 4: 注册 observer agent
1. 在 `src/agents/utils.ts` 的 `agentSources` 中添加 `observer: createObserverAgent`
2. 导入 `createObserverAgent` 和 `OBSERVER_PROMPT_METADATA`
3. 增强错误处理，添加更详细的诊断信息

## Success Criteria

1. ✅ 多个 Task 完成后，findings.md 保留所有记录（追加而非覆盖）
2. ✅ 创建大型 tasks.md 时不再出现 `AI_TypeValidationError`
3. ✅ brainstorm-mode 提示词简洁，指向 skill 获取最新指令
4. ✅ 每个 Task 包含嵌入的设计上下文
5. ✅ 完成后自动更新 findings/progress/todo
6. ✅ agent.name undefined 错误被正确处理或修复

## Risk Assessment

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Hook 拦截过于激进 | 中 | 中 | 允许首次创建文件时使用 Write |
| 分批写入增加复杂度 | 低 | 低 | 保持简单的 Edit 追加模式 |
| 上下文嵌入导致 Task 过长 | 中 | 低 | 限制摘要长度，只包含相关内容 |
| Agent 错误源自 OpenCode 主程序 | 高 | 中 | 增强错误处理，提供更好的诊断信息 |

## Alternatives Considered

### 方案 A: 只修改提示词（不创建 Hook）
- **优点**: 简单，无需新代码
- **缺点**: 无法强制执行，AI 可能仍使用 Write
- **结论**: 不够可靠

### 方案 B: 使用独立文件而非追加
- **优点**: 避免并发写入问题
- **缺点**: 需要后期合并，增加复杂度
- **结论**: 过于复杂

### 方案 C: 当前方案（Hook + 提示词 + 分批写入）
- **优点**: 多层保护，既有提示词引导又有代码强制
- **缺点**: 需要创建新 Hook
- **结论**: ✅ 采用
