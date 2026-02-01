# 任务计划: integrate-missing-features

## 背景

验证计划 `verify-50-enhancements` 发现：**8个功能模块代码已完成，但未连接到主系统**。

**核心问题**: 代码存在，但未"插电"（Not Wired Up）。

---

## Phase 1: 核心钩子集成（高优先级）

### Task 1.1: 注册 Skill Auto-Injector 钩子

**源文件**: `src/hooks/skill-auto-injector/index.ts`
**目标文件**: `src/index.ts`

**实现步骤**:
- [ ] 在 `src/index.ts` 导入 `createSkillAutoInjectorHook`
- [ ] 在 `chat.message` 事件中注册此钩子
- [ ] 在 `event` 事件中注册会话清理逻辑
- [ ] 添加配置项 `disabled_hooks` 支持禁用

**验收标准**:
- [ ] 输入包含 "git commit" 时，日志显示 `[Skill Auto-Injector] Injected git-master`
- [ ] 输入包含 "database performance" 时，注入 `database-optimization`

**测试命令**: `bun test src/hooks/skill-auto-injector/`

---

### Task 1.2: 注册 MCP Health Checker

**源文件**: `src/mcp/health-checker.ts`
**目标文件**: `src/index.ts`

**实现步骤**:
- [ ] 在 `src/index.ts` 导入 `createMcpHealthChecker`
- [ ] 在插件初始化时调用 `checkAllOnStartup(mcpNames)`
- [ ] 降级的 MCP 记录到日志并标记为 `DEGRADED`

**验收标准**:
- [ ] 启动时检测所有远程 MCP 可用性
- [ ] 不可用的 MCP 日志显示 `[MCP Health] websearch: DEGRADED`

**测试命令**: `bun test src/mcp/health-checker.test.ts`

---

### Task 1.3: 注册 Commit Size Checker 钩子

**源文件**: `src/hooks/pre-tool-use/commit-size-checker.ts`
**目标文件**: `src/index.ts`

**实现步骤**:
- [ ] 创建 `CommitSizeChecker` 实例
- [ ] 在 `tool.execute.before` 钩子中拦截 `bash` 工具
- [ ] 使用 `isCommitCommand()` 检测 git commit 命令
- [ ] 超过阈值（默认3文件）时发出警告

**验收标准**:
- [ ] 提交4+文件时显示警告: `[Commit Size] 建议分拆为原子提交`
- [ ] 提交3个或更少文件时无警告

**测试命令**: `bun test src/hooks/pre-tool-use/commit-size-checker.test.ts`

---

### Task 1.4: 集成 Context Detector 到钩子系统

**源文件**: `src/shared/context-detector.ts`
**目标文件**: `src/hooks/index.ts`, `src/config/schema.ts`

**实现步骤**:
- [ ] 在 `src/index.ts` 初始化 `ContextDetector`
- [ ] 在 `src/config/schema.ts` 添加钩子 `when` 条件字段
- [ ] 修改钩子执行逻辑，检查 `matchesCondition()` 结果
- [ ] 条件不满足时跳过钩子执行

**验收标准**:
- [ ] 配置 `when: { packageManager: "bun" }` 的钩子只在 Bun 项目中运行
- [ ] 无 `when` 条件的钩子始终运行

**测试命令**: `bun test src/shared/context-detector.test.ts`

---

## Phase 2: TDD Guard 功能完善（中优先级）

### Task 2.1: 集成 TDD State Tracker

**源文件**: `src/hooks/tdd-guard/state-tracker.ts`
**目标文件**: `src/hooks/tdd-guard/index.ts`

**实现步骤**:
- [ ] 在 TDD Guard 钩子中实例化 `TddStateTracker`
- [ ] 测试执行后调用 `updateFromTestResults()`
- [ ] 在工具输出中追加状态标签 `[TDD: RED/GREEN/REFACTOR]`
- [ ] 支持配置禁用状态显示

**验收标准**:
- [ ] 测试失败时显示 `[TDD: RED]`
- [ ] 测试通过时显示 `[TDD: GREEN]`
- [ ] 状态变化时自动更新

**测试命令**: `bun test src/hooks/tdd-guard/state-tracker.test.ts`

---

### Task 2.2: 集成 Template Generator

**源文件**: `src/hooks/tdd-guard/template-generator.ts`
**目标文件**: `src/hooks/tdd-guard/index.ts`

**实现步骤**:
- [ ] 在 `tool.execute.after` 检测新建的实现文件
- [ ] 检查对应测试文件是否存在
- [ ] 不存在时调用 `generateTestTemplate()` 生成模板
- [ ] 提示用户: `[TDD Guard] 已为 {file} 创建测试模板`

**验收标准**:
- [ ] 创建 `src/features/new-feature.ts` 时自动生成 `new-feature.test.ts`
- [ ] 生成的模板包含 BDD 结构 (`//#given`, `//#when`, `//#then`)

**测试命令**: `bun test src/hooks/tdd-guard/template-generator.test.ts`

---

## Phase 3: 命令增强（中优先级）

### Task 3.1: 集成 Agent Chains 到 Sisyphus

**源文件**: `src/features/builtin-commands/templates/agent-chains.ts`
**目标文件**: `src/agents/sisyphus-prompt.ts`

**实现步骤**:
- [ ] 在 Sisyphus prompt 中添加预定义链说明
- [ ] Bugfix 链: Explore → Oracle → Implementer → Verifier
- [ ] Refactor 链: Explore → Oracle → LSP Tools → Verifier
- [ ] (可选) 暴露 `/bugfix` 和 `/refactor-chain` 命令

**验收标准**:
- [ ] Sisyphus 在修复 bug 时自动遵循 Bugfix 链顺序
- [ ] 代理链可通过配置自定义

**测试命令**: `bun test src/features/builtin-commands/templates/agent-chains.test.ts`

---

### Task 3.2: 集成 Dead Code Detector 到 /refactor

**源文件**: `src/features/builtin-commands/templates/dead-code-detector.ts`
**目标文件**: `src/features/builtin-commands/templates/refactor.ts`

**实现步骤**:
- [ ] 在 `refactor.ts` 导入 `createDeadCodeDetector`
- [ ] 重构分析时运行死代码检测
- [ ] 将检测到的未使用代码添加到 agent 上下文
- [ ] 提示用户考虑删除死代码

**验收标准**:
- [ ] `/refactor` 能识别未使用的函数/变量
- [ ] 输出包含死代码列表和删除建议

**测试命令**: `bun test src/features/builtin-commands/templates/dead-code-detector.test.ts`

---

## 验证策略

每个任务完成后:
1. **单元测试**: 运行对应的 `.test.ts` 文件
2. **集成测试**: 在真实 OpenCode 会话中触发功能
3. **回归测试**: `bun test` 确保无破坏性变更

## 风险评估

| Task | 风险等级 | 说明 |
|------|---------|------|
| 1.1 Skill Injector | Tier-2 | 可能影响所有会话消息处理 |
| 1.2 MCP Health | Tier-1 | 仅影响启动，低风险 |
| 1.3 Commit Size | Tier-1 | 仅警告不阻断，低风险 |
| 1.4 Context Detector | Tier-3 | 需修改配置 schema，高风险 |
| 2.1 State Tracker | Tier-1 | TDD Guard 内部修改，低风险 |
| 2.2 Template Generator | Tier-2 | 涉及文件写入，中风险 |
| 3.1 Agent Chains | Tier-2 | 修改 Sisyphus prompt，中风险 |
| 3.2 Dead Code | Tier-1 | 仅增强 /refactor，低风险 |
