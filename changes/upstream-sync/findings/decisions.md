# 上游同步决策记录

**记录时间**: 2026-02-03
**同步范围**: v3.0.1 → v3.2.2
**冲突文件数**: 48

---

## ✅ 已确认的决策

### 1. 存储路径

| 决策 | **保留本地 `changes/` 路径** |
|------|------------------------------|
| 本地路径 | `changes/{name}/tasks.md` |
| 上游路径 | `.sisyphus/plans/{name}.md` |
| 决定 | 保留本地路径，但需要适配上游代码中对 `.sisyphus/` 的引用 |
| 适配点 | 需要在 Prometheus prompt 和相关 hooks 中统一路径常量 |

**待办**: 
- [ ] 在 tasks.md 中添加"路径适配"任务
- [ ] 确保上游新增的 `.sisyphus/` 相关代码能够兼容 `changes/`

---

### 2. Observer 持续学习系统

| 决策 | **保留并集成** |
|------|----------------|
| 本地独有功能 | observer-detector, observation-recorder, instinct-learner, instinct-trigger, pattern-extraction |
| 上游状态 | 无对应功能 |
| 决定 | 完整保留本地 Observer 系统，合并时确保不被覆盖 |

**相关文件**:
- `src/agents/observer.ts`
- `src/hooks/observer-detector/`
- `src/hooks/observation-recorder/`
- `src/hooks/instinct-learner/`
- `src/hooks/instinct-trigger/`

---

### 3. Task 系统合并

| 决策 | **不采用上游 Task 系统** |
|------|--------------------------|
| 原因 | 1. 本地 Wave 系统已解决依赖和并行问题 |
|      | 2. Wave 系统有 git worktree 隔离，上游没有 |
|      | 3. Task 系统没有文件级别粒度，只是任务状态跟踪 |
|      | 4. 它是 experimental，还不成熟 |
| 处理 | `experimental.task_system = false` (保持关闭) |
| 借鉴 | 可选：引入 `acquireLock()` + `writeJsonAtomic()` 提高并发安全 |
| Hook | 不注册 `tasks-todowrite-disabler`，保持 TodoWrite 正常工作 |

**分析依据**:
- 本地 Wave 系统已有: `wave-grouper.ts` (依赖分析) + `worktree-manager.ts` (隔离执行)
- 上游 Task 系统只有: `blockedBy`/`blocks` 依赖字段，无 worktree 隔离
- Task schema 无 `files` 字段，粒度不比 Wave 更细

---

### 4. Zero Human Intervention QA

| 决策 | **采用上游策略** |
|------|------------------|
| 上游规则 | 禁止手动验证，所有 QA 必须由 agent 工具执行 |
| 采用原因 | 提高 agent 自主性，减少人工干预，确保可重复验证 |
| 影响范围 | Prometheus 计划模板中的 Acceptance Criteria |

**实施要点**:
- 每个 TODO 必须包含可执行的验证命令
- 使用 Playwright (前端)、interactive_bash (TUI/CLI)、curl (API) 进行验证
- 禁止 "用户手动测试"、"用户视觉确认" 等表述

---

### 8. Write Protocol (单次原子写入协议)

| 决策 | **采用上游新增功能** |
|------|----------------------|
| 问题背景 | Write 工具会**覆盖**文件，分多次 Write 会丢失前面的内容 |
| 上游方案 | 强制单次原子写入，或首次 Write + 后续 Edit 追加 |
| 采用原因 | 防止大型计划在生成过程中丢失内容 |

**协议内容**:
```
❌ 错误做法 (内容丢失):
Write("plan.md", "# Part 1...")  
Write("plan.md", "# Part 2...")  // Part 1 没了！

✅ 正确做法:
1. 准备完整内容后一次性 Write
2. 如果内容太大，第一次 Write 写入开头部分
3. 后续用 Edit 工具追加（替换最后一行 + 新内容）
```

**自检清单** (纳入 Prometheus prompt):
- 这是第一次写入此文件？→ Write OK
- 文件已存在且有我的内容？→ 用 Edit 追加，不要 Write

**路径适配**: 上游使用 `.sisyphus/plans/x.md`，需改为 `changes/{name}/tasks.md`

---

### 9. Agent-Executed QA (代理执行的质量保证)

| 决策 | **采用上游新增功能** |
|------|----------------------|
| 问题背景 | 传统做法依赖"用户手动测试"，违反 Zero Human Intervention 原则 |
| 上游方案 | 每个任务必须包含 Agent 可执行的 QA 场景，无论是否有自动化测试 |
| 采用原因 | Agent 自己验证交付物，不依赖人工确认 |

**QA 执行方式** (按交付物类型):

| 交付物类型 | QA 执行方式 |
|-----------|------------|
| **前端/UI** | Playwright 打开浏览器，导航、填表、点击、断言 DOM、截图 |
| **CLI/TUI** | tmux 运行命令，发送按键，验证输出，检查退出码 |
| **API** | curl 发送请求，解析 JSON，断言字段和状态码 |

**每个 QA 场景必须包含**:
- 精确的选择器/命令
- 具体的测试数据
- 预期结果
- 证据路径（截图/日志保存位置）

**与决策 #4 的关系**: 这是 Zero Human Intervention QA 的具体实施方案

---

### 10. 探索 Prompt 结构 (CONTEXT + GOAL + QUESTION + REQUEST)

| 决策 | **采用上游新增功能** |
|------|----------------------|
| 问题背景 | 简单的 prompt 如 `"Find all usages of [target]"` 缺乏上下文 |
| 上游方案 | 使用结构化 prompt: CONTEXT + GOAL + QUESTION + REQUEST |
| 采用原因 | 探索代理理解任务背景，返回更相关的结果 |

**结构说明**:

| 组成部分 | 说明 | 示例 |
|---------|------|------|
| **CONTEXT** | 我在做什么 | "I'm refactoring [target]" |
| **GOAL** | 我的目标 | "need to understand its impact scope" |
| **QUESTION** | 我需要知道什么 | "before making changes" |
| **REQUEST** | 具体要找什么 | "Find all usages via lsp_find_references..." |

**示例对比**:

```typescript
// ❌ 旧写法 (缺乏上下文)
delegate_task(subagent_type="explore", prompt="Find all usages of [target] using lsp_find_references...")

// ✅ 新写法 (结构化)
delegate_task(subagent_type="explore", prompt="I'm refactoring [target] and need to understand its impact scope before making changes. Find all usages via lsp_find_references - show calling code, patterns of use, and potential breaking points.")
```

**影响范围**: Prometheus prompt 中所有 `delegate_task` 示例需更新

---

## 🔍 冲突分析摘要

### Modify/Delete 冲突 (结构重构)

| 文件 | 类型 | 策略 |
|------|------|------|
| `src/agents/prometheus-prompt.ts` | 上游拆分为 `prometheus/` 目录 | 采用上游目录结构，迁移本地自定义 |
| `src/agents/sisyphus-junior.ts` | 上游拆分为 `sisyphus-junior/` 目录 | 采用上游目录结构，保留本地 Work Context |

---

### 11. Prometheus Prompt 详细合并决策

**文件规模**: 本地 1240 行 vs 上游 1437 行 (上游多 197 行)
**独特内容**: 本地 240 行独有，上游 437 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| P1 | **计划路径** | `changes/{name}/tasks.md` | `.sisyphus/plans/{name}.md` | **保留本地** | 决策 #1 已确认 |
| P2 | **草稿路径** | 无独立草稿 | `.sisyphus/drafts/{name}.md` | **采用上游** → `changes/{name}/draft.md` | 外部记忆有价值 |
| P3 | **FORBIDDEN PATHS** | 无 | `docs/`, `plan/`, `plans/` 禁止表 | **采用上游** (适配本地路径) | 防止误写到错误目录 |
| P4 | **Write Protocol** | Batch Writing (分批写入) | Single Atomic Write (单次原子写入) | **合并两者** | 都是防止内容丢失的方案 |
| P5 | **结构化 Prompt** | 简单 `"Find all usages..."` | CONTEXT+GOAL+QUESTION+REQUEST | **采用上游** | 决策 #10 已确认 |
| P6 | **Agent-Executed QA** | Manual QA 选项 | 强制 Agent QA (无论有无测试) | **采用上游** | 决策 #4, #9 已确认 |
| P7 | **模块化结构** | 单文件 1240 行 | 7 个模块文件 | **采用上游** | 可维护性更好 |
| P8 | **Test Strategy 选项** | `TDD/manual` | `TDD/tests-after/none + agent QA` | **采用上游** | 选项更清晰 |

**合并操作**:
1. 采用上游 `prometheus/` 目录结构
2. 在各模块中将 `.sisyphus/` 路径替换为 `changes/`
3. 保留本地 Batch Writing Protocol（与上游 Write Protocol 合并）
4. 删除本地单文件 `prometheus-prompt.ts`

---

### 12. Sisyphus-Junior 详细合并决策

**文件规模**: 本地 137 行 vs 上游 324 行 (上游多 187 行)
**独特内容**: 本地 74 行独有，上游 261 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| S1 | **Work Context 路径** | `changes/{plan-name}/findings.md`, `changes/{plan-name}/tasks.md` | 无 | **保留本地** | 本地独有的笔记和计划路径 |
| S2 | **Plan 保护规则** | 详细 "SACRED and READ-ONLY" 规则 | 无 | **保留本地** | 防止子代理修改计划文件 |
| S3 | **Write 警告** | "NEVER use Write tool on existing notepad files" | 无 | **保留本地** | 防止覆盖笔记内容 |
| S4 | **GPT 路由** | 无 | `getSisyphusJuniorPromptSource()` 根据模型选择 | **采用上游** | GPT-5.2 优化 prompt |
| S5 | **模块化结构** | 单文件 | `index.ts` + `default.ts` + `gpt.ts` | **采用上游** | 可维护性更好 |
| S6 | **Task System 参数** | 无 | `useTaskSystem: boolean` | **采用上游** (默认 false) | 兼容上游接口，但不启用 Task 系统 |

**合并操作**:
1. 采用上游 `sisyphus-junior/` 目录结构
2. 在 `default.ts` 中添加本地 Work Context 部分（路径、笔记、计划保护规则）
3. 在 `gpt.ts` 中也添加相同的 Work Context（保持一致性）
4. 保留 `useTaskSystem` 参数但默认为 false
5. 删除本地单文件 `sisyphus-junior.ts`

---

### 路径适配汇总 (所有需要替换的路径)

| 上游路径 | 本地路径 | 涉及文件 |
|---------|---------|---------|
| `.sisyphus/plans/{name}.md` | `changes/{name}/tasks.md` | prometheus/*.ts |
| `.sisyphus/drafts/{name}.md` | `changes/{name}/draft.md` | prometheus/*.ts |
| `.sisyphus/*.md` | `changes/**/*.md` | prometheus-md-only hook |
| `.sisyphus/` | `changes/` | 所有引用路径的文件 |

---

### 13. Antigravity 模型与 GPT 路由决策

| 决策 | **不修改上游 `isGptModel()` 检测逻辑** |
|------|---------------------------------------|
| 问题 | 本地使用 Antigravity 包装的模型 (`Antigravity-Claude/*`, `Antigravity-Gemini/*`)，上游 GPT 路由只检测 `openai/` 和 `github-copilot/gpt-*` |
| 分析 | Antigravity 包装的 Claude/Gemini 模型应该走 Default prompt，不需要 GPT 优化 |
| 决策 | 保持上游逻辑不变 |

**上游检测逻辑**:
```typescript
// src/agents/types.ts
export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || model.startsWith("github-copilot/gpt-")
}
```

**行为分析**:
| 模型 | 匹配 `isGptModel()` | 使用的 Prompt | 正确性 |
|------|---------------------|---------------|--------|
| `Antigravity-Claude/claude-opus-4-5` | ❌ 否 | Default (Claude 优化) | ✅ 正确 |
| `Antigravity-Gemini/gemini-3-flash` | ❌ 否 | Default | ✅ 正确 |
| `openai/gpt-5.2` | ✅ 是 | GPT 优化 | ✅ 正确 |
| `anthropic/claude-sonnet-4-5` | ❌ 否 | Default | ✅ 正确 |

**理由**:
1. 当前行为已经正确 - Antigravity 包装的 Claude/Gemini 走 Default prompt
2. GPT 优化的核心差异是 `reasoningEffort` vs `thinking.budgetTokens`，不适用于 Claude/Gemini
3. 如果将来有 `Antigravity-GPT/*` 模型，届时再扩展检测函数

**未来扩展** (如需支持 Antigravity GPT):
```typescript
export function isGptModel(model: string): boolean {
  return model.startsWith("openai/") || 
         model.startsWith("github-copilot/gpt-") ||
         model.startsWith("Antigravity-GPT/") ||  // 未来扩展
         model.startsWith("antigravity-gpt-")     // 未来扩展
}
```

### 14. Schema.ts 详细合并决策

**文件规模**: 本地 496 行 vs 上游 428 行 (本地多 68 行)
**独特内容**: 本地 110 行独有，上游 42 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| SC1 | **Agents 列表** | `implementer`, `archiver`, `frontend-ui-ux-engineer`, `document-writer`, `observer` | `hephaestus` | **合并两边** | 本地 agents 需保留，上游新 agent 需添加 |
| SC2 | **Hooks 列表** | 29 个本地独有 | 3 个上游新增 (`unstable-agent-babysitter`, `stop-continuation-guard`, `tasks-todowrite-disabler`) | **合并两边** | 但 `tasks-todowrite-disabler` 不注册 (决策 #3) |
| SC3 | **Category `deep`** | 无 | 新增 `deep` category | **采用上游** | 新功能 |
| SC4 | **`defaultSkills` 字段** | CategoryConfig 有此字段 | 无 | **保留本地** | 本地功能 |
| SC5 | **`is_unstable_agent` 注释** | "gemini models" | "gemini/minimax models" | **采用上游** | 更准确 |
| SC6 | **Experimental 配置** | 无 | `preemptive_compaction`, `task_system` | **采用上游** | 新功能，`task_system` 默认 false |
| SC7 | **Browser Provider** | `playwright`, `agent-browser` | 新增 `dev-browser` | **采用上游** | 新功能 |
| SC8 | **`BabysittingConfigSchema`** | 无 | 新增 | **采用上游** | unstable-agent-babysitter 需要 |
| SC9 | **`McpTemplateConfigSchema`** | 扩展版本 | 基础版本 | **保留本地** | 更完整 |

**本地独有 Hooks (29 个，全部保留)**:
```
tdd-guard, debugging-injector, failure-counter, skill-suggestion,
planning-flow-guide, plan-reorganizer, plan-update-reminder,
plan-attention-refresher, subagent-verification, codebase-assessment,
lsp-diagnostics-enforcer, phase-flow-enforcer, mdsel-reminder,
mdsel-enforcer, observation-recorder, observer-detector, instinct-trigger,
instinct-learner, pattern-extraction, notepad-write-guard,
observation-write-guard, secret-scanner, skill-auto-injector,
behavior-anchor, verbosity-controller, phase-rules-injector,
knowledge-injection, project-context-injector, pr-context-injector
```

---

### 15. Hooks/index.ts 详细合并决策

**文件规模**: 本地 97 行 vs 上游 40 行 (本地多 57 行)
**独特内容**: 本地 63 行独有，上游 6 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| HI1 | **Observer 系统导出** | 5 个 hooks | 无 | **保留本地** | 决策 #2 |
| HI2 | **TDD Guard 系统** | 有 | 无 | **保留本地** | 本地功能 |
| HI3 | **Plan 管理系统** | 5 个 hooks | 无 | **保留本地** | 本地功能 |
| HI4 | **上游新增导出** | 无 | 6 个新 hooks | **采用上游** (除 `tasks-todowrite-disabler`) | 新功能 |

**上游新增 Hooks 处理**:
| Hook | 决策 | 理由 |
|------|------|------|
| `createSubagentQuestionBlockerHook` | **添加** | 有用功能 |
| `createStopContinuationGuardHook` | **添加** | 有用功能 |
| `createUnstableAgentBabysitterHook` | **添加** | 监控不稳定 agents |
| `createPreemptiveCompactionHook` | **添加** | 上下文压缩 |
| `createTasksTodowriteDisablerHook` | **添加但不注册** | 决策 #3，保持 TodoWrite 可用 |

---

### 16. Momus.ts 详细合并决策 (深度分析)

**文件规模**: 本地 467 行 vs 上游 243 行 (本地多 224 行)
**独特内容**: 本地 339 行独有，上游 115 行独有

**核心理念差异**:

| 维度 | 本地 | 上游 |
|------|------|------|
| **定位** | "work plan review expert" - 严格审查专家 | "practical work plan reviewer" - 实用审查者 |
| **审查风格** | **严格** - "平均 7 次拒绝才能通过" | **宽松** - "80% 清晰就够了，有疑问就批准" |
| **路径支持** | `changes/*/tasks.md` + `.sisyphus/` + `design.md` + `proposal.md` | 仅 `.sisyphus/plans/*.md` |
| **ADHD 上下文** | 详细的 ADHD 失败模式分析 | 无 |
| **批准偏向** | 无（严格验证） | "When in doubt, APPROVE" |

**为什么上游"退步"？ - 不是退步，是设计理念不同**:

| 维度 | 本地理念 | 上游理念 |
|------|---------|---------|
| **假设** | 作者有 ADHD，容易遗漏上下文 | 开发者能自己填补小 gaps |
| **目标** | 强制作者外化所有隐含知识 | 快速通过，减少摩擦 |
| **适用场景** | 需要高质量计划的严肃项目 | 快速迭代，敏捷开发 |
| **副作用** | 可能需要多次修改（7次平均） | 可能遗漏重要细节 |

**本地独有内容 (保留)**:

1. **ADHD 作者上下文**:
   - "Historical Data: Plans from this author average 7 rejections"
   - 详细的 "What to Expect in First Drafts" 列表
   - "Why These Plans Fail" 分析

2. **Core Review Principle**:
   - "ABSOLUTE CONSTRAINT - RESPECT THE IMPLEMENTATION DIRECTION"
   - "You are a REVIEWER, not a DESIGNER"
   - 防止审查者越权质疑架构决策

3. **Common Failure Patterns** (4 大类):
   - Reference Materials 缺失
   - Business Requirements 缺失
   - Architectural Decisions 缺失
   - Critical Context 缺失

4. **多路径支持**:
   - `changes/{name}/tasks.md`, `design.md`, `proposal.md`
   - `.sisyphus/plans/*.md` (兼容)

**上游改进 (采纳)**:

| 改进 | 说明 | 决策 |
|------|------|------|
| **AgentMode 导入** | `const MODE: AgentMode = "subagent"` | **采用** - 更规范 |
| **Maximum 3 issues** | 每次拒绝最多 3 个问题 | **采用** - 防止信息过载 |
| **NOT blockers 列表** | 明确哪些不是阻塞问题 | **考虑采用** - 有价值 |

**合并决策汇总**:

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| MO1 | **审查理念** | 严格 (7 次拒绝) | 宽松 (80% 够了) | **保留本地** | 高质量计划更重要 |
| MO2 | **路径支持** | 多路径 + 兼容 | 仅 `.sisyphus/` | **保留本地** | 决策 #1 |
| MO3 | **ADHD 上下文** | 详细分析 | 无 | **保留本地** | 有价值的指导 |
| MO4 | **尊重实现方向** | 详细原则 | 简化 | **保留本地** | 防止越权 |
| MO5 | **AgentMode** | 无 | 有 | **采用上游** | 更规范 |
| MO6 | **Maximum 3 issues** | 无明确限制 | 有 | **采用上游** | 防止信息过载 |

**合并操作**:
1. 保留本地 Momus 的严格审查风格和 ADHD 上下文
2. 添加 `const MODE: AgentMode = "subagent"`
3. 添加 "Maximum 3 issues per rejection" 规则
4. 确保路径支持包含 `changes/` 和 `.sisyphus/`

---

### 17. Delegate-Task/tools.ts 详细合并决策 (修正)

**⚠️ 之前的分析错误！上游不是退步，是重大模块化升级。**

**文件规模修正**:
| 维度 | 本地 | 上游 | 真实情况 |
|------|------|------|---------|
| **总代码量** | 1052 行 | **4759 行** | **上游多 3700+ 行！** |
| **架构** | 单体文件 | 10 个模块文件 | 上游更好 |
| **测试** | ~200 行 | **2783 行测试** | 上游测试覆盖完整 |

**上游模块化结构**:
```
src/tools/delegate-task/
├── executor.ts      (979 行)  ← 核心执行逻辑
├── constants.ts     (527 行)  ← 常量 + Category Prompts
├── tools.ts         (173 行)  ← 工具入口
├── categories.ts    (71 行)   ← Category 配置解析
├── helpers.ts       (100 行)  ← 辅助函数
├── prompt-builder.ts (32 行)  ← Prompt 构建
├── timing.ts        (39 行)   ← 时间配置
├── types.ts         (51 行)   ← 类型定义
├── tools.test.ts    (2783 行) ← 完整测试
└── index.ts         (4 行)    ← 导出

新增 Hook:
src/hooks/delegate-task-retry/
├── index.ts         (136 行)  ← 错误检测 + 自动修复提示
└── index.test.ts    (119 行)
```

**上游新增功能**:

| 功能 | 说明 | 决策 |
|------|------|------|
| **Category Prompts 扩展** | `VISUAL_CATEGORY`, `ULTRABRAIN_CATEGORY`, `ARTISTRY_CATEGORY`, `QUICK_CATEGORY` | **采用上游** |
| **delegate-task-retry Hook** | 错误模式检测，自动提示缺少参数 | **采用上游** |
| **resolveModelPipeline** | 新的模型解析管道 | **采用上游** |
| **promptWithModelSuggestionRetry** | 模型建议重试 | **采用上游** |
| **isModelAvailable** | 模型可用性检查 | **采用上游** |
| **模块化拆分** | helpers, categories, prompt-builder, timing | **采用上游** |

**合并决策修正**:

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| DT1 | **架构** | 单体 1052 行 | 模块化 4759 行 | **采用上游模块化** | 上游更完整、测试更好 |
| DT2 | **Category Prompts** | 基础版本 | 扩展版本 (4 种 Category) | **采用上游** | 更好的任务分类指导 |
| DT3 | **delegate-task-retry** | 无 | 新增 Hook | **采用上游** | 错误自动修复有价值 |
| DT4 | **Model 解析** | `resolveModelWithFallback` | `resolveModelPipeline` | **需要深入对比** | 可能需要合并 |
| DT5 | **本地独有功能** | Tiered fallback, skill-reminder-generator | 无 | **迁移到上游模块** | 保留本地功能 |
| DT6 | **测试覆盖** | ~200 行 | 2783 行 | **采用上游** | 更完整的测试 |

**合并操作**:
1. 采用上游模块化结构
2. 检查本地 `tools.ts` 中是否有上游缺失的功能
3. 如有，迁移到对应的上游模块中
4. 添加 `delegate-task-retry` hook 到 hooks 注册
5. 删除本地单体文件

---

### 18. 上游审查体系分析 (重要发现)

**发现**: 上游 Momus "宽松化"不是退步，而是**分层审查体系**的一部分。

**上游审查分层设计**:

| 阶段 | Agent | 职责 | 严格程度 |
|------|-------|------|---------|
| **Phase 0** | **Metis** (Pre-Planning) | 意图分析、隐藏需求、AI-slop 预防 | **严格** |
| **Phase 1** | **Prometheus** (Planning) | 计划生成、结构化访谈 | 中等 |
| **Phase 2** | **Momus** (Review) | 验证可执行性、引用检查 | **宽松** (因为前面已严格) |
| **Phase 3** | **Hephaestus** (新增) | 自主深度工作、彻底研究 | 执行阶段 |

**Metis 的严格检查内容 (上游增强)**:

1. **PHASE 0: INTENT CLASSIFICATION** (强制第一步):
   - 6 种意图类型，每种有不同的审查重点
   - Refactoring → SAFETY: 回归预防、行为保持
   - Build from Scratch → DISCOVERY: 先探索模式
   - Mid-sized Task → GUARDRAILS: 精确交付物、显式排除
   - Architecture → STRATEGIC: 长期影响、推荐 Oracle

2. **Tool Guidance** (推荐工具):
   - `lsp_find_references`: 变更前映射所有引用
   - `lsp_rename` / `ast_grep_search`: 安全重命名
   - 结构化探索 prompt (CONTEXT + GOAL + QUESTION + REQUEST)

3. **Directives for Prometheus** (严格指令):
   - MUST: 定义前置验证 (精确测试命令 + 预期输出)
   - MUST: 每次变更后验证，不只是最后
   - MUST NOT: 重构时改变行为
   - MUST NOT: 重构范围外的代码
   - AI-slop 预防 (over-engineering, scope creep)

**Hephaestus (新增 Agent)**:
- 灵感来自 AmpCode 的 deep mode
- 自主问题解决 + 彻底研究
- 支持 Task System (可选，与 TodoWrite 二选一)

**设计理念对比**:

| 维度 | 本地设计 | 上游设计 |
|------|---------|---------|
| **审查位置** | Momus 单点严格审查 | Metis 前置严格 + Momus 后置宽松 |
| **审查时机** | 计划完成后 | 计划开始前 (意图分析) + 计划完成后 |
| **优点** | 简单直接 | 更早发现问题、减少返工 |
| **ADHD 支持** | Momus 有 ADHD 上下文 | Metis 通过结构化访谈引导 |

**决策修正**:

| # | 原决策 | 修正后 | 理由 |
|---|--------|--------|------|
| MO1 | 保留本地严格 Momus | **需要重新评估** | 上游的分层设计可能更好 |
| 新 | - | **采用上游增强的 Metis** | 前置严格审查有价值 |
| 新 | - | **添加 Hephaestus agent** | 新的自主深度工作能力 |

**待深入分析**:
1. 对比本地 Metis vs 上游 Metis 的详细差异
2. 评估是否将本地 Momus 的 ADHD 上下文迁移到 Metis
3. 评估 Hephaestus 的完整功能和价值

---

### 19. Metis.ts 详细合并决策

**文件规模**: 本地 315 行 vs 上游 347 行 (上游多 32 行)
**独特内容**: 本地 11 行独有，上游 43 行独有

**关键发现**: 上游 Metis 新增了 **ZERO USER INTERVENTION PRINCIPLE** (决策 #4, #9 的实施位置)

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| ME1 | **AgentMode** | 无 | `const MODE: AgentMode = "subagent"` | **采用上游** | 更规范 |
| ME2 | **Prompt 结构** | 简单 `"Find similar..."` | CONTEXT + GOAL + QUESTION + REQUEST | **采用上游** | 决策 #10 |
| ME3 | **QA Directives** | 无 | **新增 23 行** ZERO USER INTERVENTION | **采用上游** | 决策 #4, #9 实施位置 |
| ME4 | **Anti-Patterns** | 基础 | 新增 "user intervention" 禁止 | **采用上游** | Zero Human Intervention |
| ME5 | **Must Do** | 基础 | 新增 "QA automation directives" | **采用上游** | Agent-Executed QA |

**上游新增的关键内容**:
```markdown
> **ZERO USER INTERVENTION PRINCIPLE**: All acceptance criteria MUST be executable by agents.

- MUST: Write acceptance criteria as executable commands (curl, bun test, playwright)
- MUST NOT: Create criteria requiring "user manually tests..."
- MUST NOT: Create criteria requiring "user visually confirms..."
- MUST NOT: Create criteria requiring "user clicks/interacts..."
```

**合并操作**:
1. 采用上游 Metis 的所有新增内容
2. 保留本地路径兼容 (`changes/` 而非 `.sisyphus/`)
3. 确保 QA Directives 与决策 #4, #9 一致

---

### 20. Utils.ts 详细合并决策

**文件规模**: 本地 331 行 vs 上游 482 行 (上游多 151 行)
**独特内容**: 本地 72 行独有，上游 223 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| UT1 | **Agent 导入** | `implementer`, `archiver`, `observer`, `prometheus` | `hephaestus` | **合并两边** | 保留本地 + 添加新 |
| UT2 | **agentSources 类型** | `Partial<Record<...>>` | `Record<...>` (更严格) | **采用上游** | 类型安全 |
| UT3 | **Model 解析** | `resolveModelWithFallback` | `resolveModelPipeline` | **采用上游** | 新管道更好 |
| UT4 | **applyCategoryOverride** | 无 | 新增函数 78 行 | **采用上游** | Category 处理 |
| UT5 | **applyModelResolution** | 无 | 新增函数 | **采用上游** | 模型解析 |
| UT6 | **applyEnvironmentContext** | 无 | 新增函数 | **采用上游** | 环境注入 |
| UT7 | **applyOverrides** | 无 | 新增函数 | **采用上游** | 覆盖处理 |
| UT8 | **Prompt Metadata** | 部分导出 | 完整导出 | **采用上游** | 更完整 |

**合并操作**:
1. 采用上游新增的所有函数
2. 保留本地 agents (`implementer`, `archiver`, `observer`, `prometheus`)
3. 添加上游新 agent (`hephaestus`)
4. 使用上游的 `resolveModelPipeline` 替代本地 `resolveModelWithFallback`

---

### 21. Hephaestus.ts (上游新增 Agent)

**文件规模**: 上游 592 行 (本地无此文件)

| 决策 | **完整采用上游新增的 Hephaestus agent** |
|------|----------------------------------------|
| 定位 | "The Autonomous Deep Worker" - 自主深度工作者 |
| 灵感 | AmpCode 的 deep mode |
| 模型 | GPT 5.2 Codex with medium reasoning effort |
| MODE | `primary` (可在 UI 中选择) |

**核心能力**:
- 自主深度工作 - 不需要逐步指令
- 彻底研究 - 主动使用 explore/librarian agents
- 端到端完成 - 不会过早停止
- Task System 支持 - 可选使用 `TaskCreate`/`TaskUpdate`

**动态 Prompt 构建** (从 `dynamic-agent-prompt-builder.ts` 导入):
- `buildKeyTriggersSection()` - 关键触发器
- `buildToolSelectionTable()` - 工具选择表
- `buildExploreSection()` / `buildLibrarianSection()` - Agent 使用指南
- `buildCategorySkillsDelegationGuide()` - Category/Skills 委托指南
- `buildDelegationTable()` - 委托表
- `buildOracleSection()` - Oracle 使用指南
- `buildHardBlocksSection()` / `buildAntiPatternsSection()` - 约束

**合并操作**:
1. 完整添加 `src/agents/hephaestus.ts`
2. 在 `utils.ts` 中注册 agent
3. 在 `schema.ts` 中添加到 agent 列表
4. 在 `hooks/index.ts` 中导出（如需要）

---

### 22. Index.ts (主入口) 详细合并决策

**文件规模**: 本地 895 行 vs 上游 868 行 (本地多 27 行)
**独特内容**: 本地 359 行独有，上游 332 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| IX1 | **本地独有 Hooks** | 29 个 hooks (TDD Guard, Observer 等) | 无 | **保留本地** | 本地功能 |
| IX2 | **上游新增 Hooks** | 无 | 5 个新 hooks | **采用上游** (除 disabler) | 新功能 |
| IX3 | **Task System 工具** | 无 | `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate` | **采用上游** (disabled) | 决策 #3 |
| IX4 | **resolveVariantForModel** | 无 | 新增导入 | **采用上游** | 新功能 |
| IX5 | **clearBoulderState** | 无 | 新增导入 | **采用上游** | 新功能 |
| IX6 | **Native AGENTS.md 检测** | 无 | 版本检测自动禁用 | **采用上游** | 智能兼容 |
| IX7 | **preemptiveCompaction** | 无 | 新增 hook | **采用上游** | 新功能 |
| IX8 | **console.warn → log** | `console.warn` | `log()` | **采用上游** | 一致性 |

**上游新增的重要逻辑**:
```typescript
// 检测 OpenCode 原生 AGENTS.md 注入支持，避免重复
const hasNativeSupport = isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION);
if (hasNativeSupport) {
  log("directory-agents-injector auto-disabled due to native OpenCode support");
}
```

**合并操作**:
1. 保留本地 29 个 hooks 的导入和注册
2. 添加上游新增的 5 个 hooks 导入
3. 添加 Task System 工具导入（但 disabled）
4. 添加 Native AGENTS.md 检测逻辑
5. 替换 `console.warn` 为 `log()`

---

### 23. Background-Agent/Manager.ts 详细合并决策

**文件规模**: 本地 1390 行 vs 上游 1507 行 (上游多 117 行)
**独特内容**: 本地 64 行独有，上游 181 行独有

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| BG1 | **常量导入** | 内联 | 从 `constants.ts` 导入 | **采用上游** | 更好的代码组织 |
| BG2 | **onShutdown 回调** | 无 | 新增 | **采用上游** | 优雅关闭 |
| BG3 | **completionTimers** | 无 | 新增 Map | **采用上游** | 定时器管理 |
| BG4 | **Concurrency 槽位泄漏修复** | 无 | 错误时释放槽位 | **采用上游** | Bug 修复 |
| BG5 | **Question 权限拒绝** | 无 | 子代理默认拒绝 question | **采用上游** | 防止子代理提问 |
| BG6 | **Variant 处理** | 可能有 bug | variant 必须顶层字段 | **采用上游** | Bug 修复 |
| BG7 | **promptWithModelSuggestionRetry** | 无 | 新增 | **采用上游** | 模型建议重试 |
| BG8 | **cancelTask 增强** | 基础 | 新增选项 | **采用上游** | 更灵活取消 |

**合并操作**:
1. 采用上游的常量导入方式
2. 添加上游新增的所有功能
3. 保留本地独有功能（如有）
4. 确保并发槽位泄漏修复被应用

---

### 24. Atlas 目录详细合并决策 (上游模块化)

**文件规模**: 本地 无目录 (单文件 `atlas.ts`) vs 上游 983 行 (4 个文件)

| 上游文件 | 行数 | 功能 |
|---------|------|------|
| `default.ts` | 390 行 | Claude 优化 prompt |
| `gpt.ts` | 330 行 | GPT-5.2 优化 prompt |
| `index.ts` | 153 行 | 主入口，模型路由 |
| `utils.ts` | 110 行 | 工具函数 |

| 决策 | **采用上游模块化结构** |
|------|------------------------|
| 原因 | 1. GPT 模型路由功能有价值 |
|      | 2. 动态 Prompt 构建更灵活 |
|      | 3. 与 Sisyphus-Junior, Prometheus 模块化一致 |

**上游新增的关键功能**:
- `getAtlasPromptSource()` - 根据模型选择 prompt (Claude vs GPT)
- `buildDynamicOrchestratorPrompt()` - 动态构建编排器 prompt
- `getCategoryDescription()`, `buildAgentSelectionSection()`, `buildCategorySection()`, `buildSkillsSection()`, `buildDecisionMatrix()` - 工具函数

**合并操作**:
1. 删除本地 `src/agents/atlas.ts` 单文件
2. 采用上游 `src/agents/atlas/` 目录结构
3. 检查本地 atlas.ts 是否有独有内容需迁移
4. 在 utils.ts 中更新导入路径

---

### 25. Builtin-Skills/Skills.ts 详细合并决策

**文件规模**: 本地 2032 行 vs 上游 22 行 (本地多 2010 行)

**⚠️ 这不是上游退步，是模块化 + 本地有大量独有 Skills！**

**上游模块化结构**:
| 文件 | 行数 | 说明 |
|------|------|------|
| `skills.ts` | 22 行 | 仅导入和导出 |
| `skills/index.ts` | 4 行 | 导出所有 skills |
| `skills/playwright.ts` | 312 行 | Playwright + agent-browser |
| `skills/git-master.ts` | 1107 行 | Git-master skill |
| `skills/dev-browser.ts` | 221 行 | Dev-browser skill |
| `skills/frontend-ui-ux.ts` | 79 行 | Frontend UI/UX skill |
| **上游总计** | ~1745 行 | 模块化 |

**本地独有 Skills (15+ 个，必须保留)**:

| Skill | 说明 | 决策 |
|-------|------|------|
| `brainstorming` | 头脑风暴 | **保留** |
| `creating-changes` | 创建变更 | **保留** (Wave 系统依赖) |
| `verification-before-completion` | 完成前验证 | **保留** |
| `using-git-worktrees` | Git worktree | **保留** (Wave 系统依赖) |
| `dispatching-parallel-agents` | 并行代理调度 | **保留** |
| `subagent-driven-development` | 子代理驱动开发 | **保留** |
| `tdd` | TDD | **保留** |
| `test-driven-development` | 测试驱动开发 | **保留** |
| `systematic-debugging` | 系统化调试 | **保留** |
| `requesting-code-review` | 请求代码审查 | **保留** |
| `receiving-code-review` | 接收代码审查 | **保留** |
| `collaborating-with-codex` | 与 Codex 协作 | **保留** |
| `collaborating-with-gemini` | 与 Gemini 协作 | **保留** |
| `finishing-a-development-branch` | 完成开发分支 | **保留** |
| `archiving-changes` | 归档变更 | **保留** |
| `writing-skills` | 编写 Skills | **保留** |
| `security-audit` | 安全审计 | **保留** |

**合并决策**:

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| SK1 | **架构** | 单体 2032 行 | 模块化 ~1745 行 | **采用上游模块化** | 可维护性 |
| SK2 | **共有 Skills** | playwright, agent-browser, frontend-ui-ux, git-master, dev-browser | 同 | **采用上游版本** | 可能有更新 |
| SK3 | **本地独有 Skills** | 15+ 个 | 无 | **迁移到上游模块结构** | 保留本地功能 |

**合并操作**:
1. 采用上游 `skills/` 目录结构
2. 为本地独有的 15+ 个 skills 创建对应的 .ts 文件：
   - `skills/brainstorming.ts`
   - `skills/creating-changes.ts`
   - `skills/tdd.ts`
   - ... (每个独有 skill 一个文件)
3. 更新 `skills/index.ts` 导出所有 skills
4. 更新 `skills.ts` 导入所有 skills
5. 对于有 SKILL.md 模板的 skills，创建对应目录结构

---

### 决策汇总更新

**本地优于上游的领域**:
- **15+ 独有 Skills** (brainstorming, creating-changes, tdd, systematic-debugging 等)
- **Observer 持续学习系统** (5 个 hooks)
- **Wave 系统** (wave-grouper, worktree-manager)
- **29 个本地独有 Hooks** (TDD Guard, Plan 管理等)
- **ADHD 上下文** (Momus 严格审查)
- **`changes/` 路径** (vs `.sisyphus/`)

**上游优于本地的领域**:
- **模块化重构** (prometheus, sisyphus-junior, atlas, delegate-task, skills)
- **GPT 模型路由** (Claude vs GPT 优化 prompt)
- **Hephaestus Agent** (自主深度工作)
- **ZERO USER INTERVENTION QA** (Metis 中的 23 行新增)
- **分层审查体系** (Metis 前置严格 + Momus 后置宽松)
- **delegate-task-retry Hook** (错误自动修复)
- **Background-Agent 增强** (并发槽位泄漏修复、variant 处理等)
- **Native AGENTS.md 检测** (版本检测自动禁用)
- **完整测试覆盖** (delegate-task 2783 行测试)

---

### 5. Wave 系统改进 (方案 C: 全面改进)

| 决策 | **Hook 拦截 + Skill 改进 + 自动激活** |
|------|---------------------------------------|
| 发现 | Wave 系统已支持文件级别 (`TaskFiles` 接口) |
| 发现 | `wave-grouper.ts` 已有自动冲突检测和依赖推断 |
| 问题 | `creating-changes` skill 没有强制标准格式 |
| 问题 | Wave 需要用户手动选择激活 |

**改进项 (按优先级)**:

#### 5.1 tasks-md-creation-guard hook (高优先级)
- 拦截 Write/Edit/MultiEdit 对 `changes/*/tasks.md` 的首次创建
- 强制先使用 `creating-changes` skill
- 子代理解锁状态共享到主会话

#### 5.2 改进 creating-changes skill (高优先级)
- 强制使用标准格式声明文件:
  ```markdown
  ### Task 1.1: 实现登录功能
  <!-- depends_on: none -->
  <!-- Risk: Tier-2 -->
  <!-- type: code -->
  <!-- agent: implementer -->
  
  **Files**:
  - Create: `src/auth/login.ts`
  - Modify: `src/routes/index.ts`
  - Test: `src/auth/login.test.ts`
  ```
- 让 `task-parser.ts` 能正确解析文件信息
- 自动传递给 `wave-grouper.ts` 进行依赖分析

#### 5.3 Wave 自动激活 (中优先级)
- 修改 `start-work` hook
- 任务 > 5 且 Wave 0 有多个任务时自动激活
- 跳过 Question，直接加载 `wave-parallel-execution` skill

**Wave 系统现有能力确认**:
```typescript
// wave-grouper.ts 已有
interface TaskFiles {
  create: string[]   // 要创建的文件
  modify: string[]   // 要修改的文件
  test: string[]     // 测试文件
}

// 自动冲突检测: 多任务修改同一文件 → 自动添加依赖
// Worktree 隔离: 每个 Wave 独立 git worktree
```

---

### 6. tasks.md 创建前置检查 (Hook 拦截方案)

| 决策 | **新增 `tasks-md-creation-guard` Hook** |
|------|----------------------------------------|
| 问题 | Agent 可能跳过 creating-changes 直接创建 tasks.md |
| 方案 | 添加 PreToolUse hook 拦截 Write/Edit/MultiEdit |
| 拦截模式 | `changes/*/tasks.md` (首次创建时) |
| 不拦截 | TodoWrite (简单任务用这个)、已存在的 tasks.md 更新 |

**用户确认的参数**:
- MultiEdit: ✅ 也拦截
- 子代理会话: ✅ 共享解锁状态
- 提示消息: "请先使用 skill('creating-changes') 规划任务依赖关系，然后再创建 tasks.md"

**实施方案**:
1. 新建 `src/hooks/tasks-md-creation-guard/index.ts`
2. PostToolUse: 记录 `creating-changes` skill 使用 (跨会话共享)
3. PreToolUse: 拦截 Write/Edit/MultiEdit 对 `changes/*/tasks.md` 的首次创建
4. 使用 `GlobMatcher` 匹配路径，`existsSync` 判断首次创建
5. 注册到 `src/hooks/index.ts` 和 `src/config/schema.ts`

---

### 7. 合并实验环境

| 项目 | 说明 |
|------|------|
| **当前工作目录** | `C:/github/oh-my-opencode-update` (保持干净) |
| **合并实验目录** | `C:/github/oh-my-opencode-merge-lab` (副本) |
| **状态** | 48 个冲突待解决 |
| **操作** | 所有合并操作在 merge-lab 中进行 |

---

## 📋 下一步

1. [x] Task 系统决策已确认
2. [ ] 更新 `changes/upstream-sync/tasks.md` 计划
3. [ ] 在 `merge-lab` 中按优先级执行冲突解决
4. [ ] 实现 Wave 自动激活改进
5. [ ] 实现 task-creation-guard hook

---

### 41. Index.ts (主入口) 合并决策

**冲突位置**: 行 36-73 (Hook 导入)

**本地独有导入 (30 个，全部保留)**:
- TDD/调试: `createTddGuardHook`, `createDebugInjectorHook`, `createFailureCounterHook`
- 规划: `createPlanningFlowGuideHook`, `createPhaseFlowEnforcerHook`, `createPlanReorganizerHook`
- Observer: `createObservationRecorderHook`, `createObserverDetectorHook`
- Instinct: `createInstinctTriggerHook`, `createInstinctLearnerHook`, `createPatternExtractionHook`
- 其他: `createSecretScannerHook`, `createVerbosityControllerHook`, 等 20+ 个

**上游独有导入 (6 个，采纳)**:
- `createSubagentQuestionBlockerHook`
- `createStopContinuationGuardHook`
- `createCompactionContextInjector`
- `createUnstableAgentBabysitterHook`
- `createPreemptiveCompactionHook`
- `createTasksTodowriteDisablerHook`

**合并操作**: 保留本地 30 个 + 添加上游 6 个

---

### 42. Agents/utils.ts 合并决策

**冲突位置**: 行 13-24 (导入), 行 66-72 (agentMetadata)

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| prometheus 导入 | `./prometheus-prompt` | `./prometheus/` (模块化) | **采用上游** |
| observer 导入 | 有 | 无 | **保留本地** |
| hephaestus 导入 | 无 | 有 | **采用上游** |
| prometheus metadata | `PROMETHEUS_PROMPT_METADATA` | 无 | **保留本地** |
| metis/momus/atlas metadata | 无 | 有 | **采用上游** |

**合并操作**: 
- 采用上游模块化导入结构
- 保留本地 `createObserverAgent`
- 合并 agentMetadata (prometheus + metis/momus/atlas)

---

### 43. Momus.ts 合并决策

**冲突位置**: 行 22-260 (大范围，prompt 差异)

**核心差异**:

| 维度 | 本地 | 上游 | 决策 |
|------|------|------|------|
| **审查风格** | 严格详细 (~300 行) | 实用宽松 (~200 行) | **合并** |
| **路径支持** | `changes/` + `.sisyphus/` | 主要 `.sisyphus/` | **保留本地** |
| **提取算法** | 7 步详细算法 | 简化 | **保留本地** |
| **APPROVAL BIAS** | 无 | 有 | **采用上游** |
| **Max 3 issues** | 无 | 有 | **采用上游** |

**合并策略**: 保留本地路径支持和验证逻辑 + 采用上游实用主义理念 (APPROVAL BIAS, Max 3 issues)

---

### 44. Builtin-Skills/skills.ts 合并决策

**冲突位置**: 行 8-32 (技能读取逻辑)

**本地独有内容 (保留)**:
- `builtinSkillTemplateCache` 缓存机制
- `readBuiltinSkillTemplate()` 函数
- `sourceSkillRoot` 开发路径支持

**决策**: **保留本地** - 本地有完整的技能模板读取机制，上游可能缺失

---

### 37. Background-Task/tools.ts 合并决策

**冲突位置**: 行 550-566

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| metadata 注入 | `ctx.metadata` 用于 UI | 无 | **保留本地** |
| full_session 参数 | 无 | `formatFullSession()` 调用 | **采用上游** |

**合并操作**: 保留本地 `ctx.metadata` 调用 + 添加上游 `full_session` 处理

---

### 38. Keyword-Detector/constants.ts 合并决策

**冲突位置**: 行 13-110 (大范围)

**本地独有内容 (保留)**:
- `PROMETHEUS_PLANNING_CONTEXT` (~50 行规划上下文)
- `isPlannerAgent()` 函数
- `brainstorm-mode` 检测器
- `consult-metis-mode` 检测器 (复杂/模糊请求)
- 扩展 `analyze` 正则 (中/日/韩/越语)

**上游改进 (采纳)**:
- `KeywordDetector` 类型定义
- 模块化导出结构 (`./ultrawork`, `./search`, `./analyze`)

**合并操作**: 采用上游模块化结构，将本地独有检测器迁移到新结构

---

### 39. Todo-Continuation-Enforcer.ts 合并决策

**冲突位置**: 行 396-411, 668-677

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| Prompt 格式 | 简洁 `[Status: X/Y]` | 详细 + 任务列表 | **采用上游** |
| 停止检查 | 无 | `isContinuationStopped` | **采用上游** |

**理由**: 上游增加了更好的用户控制 (`stop-continuation` 命令支持)

---

### 40. Compaction-Context-Injector/index.ts 合并决策

**冲突位置**: 行 49-66 (Section 7 定义)

**本地 Section 7** (保留):
```
Todo List Preservation (CRITICAL)
- DO NOT modify the todo list during compaction
- Preserve ALL existing todo items
```

**上游 Section 7** (采纳):
```
Agent Verification State (Critical for Reviewers)
- Current Agent, Verification Progress
- Previous Rejections, Acceptance Status
```

**合并操作**: 合并为 Section 7 (Todo Preservation) + Section 8 (Agent Verification State)

---

### 45. Background-Agent/manager.ts 详细合并决策

**冲突位置**: 行 936-940 (单个冲突点)

**冲突内容**:
```typescript
// 本地
}, 10000)

// 上游
}, POLLING_INTERVAL_MS)
```

**差异**: 硬编码 `10000` vs 常量 `POLLING_INTERVAL_MS`

**决策**: **采用上游** - 使用常量更规范，便于统一配置

---

### 46. Agents/atlas/default.ts 详细合并决策

**冲突位置**: 行 380-433
**冲突类型**: 文件路径变化 (`atlas.ts` → `atlas/default.ts` 模块化)

**本地独有内容** (需迁移到上游模块):
1. `getDefaultAtlasPrompt()` 函数中的 prompt 替换逻辑
2. `createAtlasAgent(ctx: OrchestratorContext)` 函数定义
3. `atlasPromptMetadata` 定义

**决策**: **采用上游模块化** - 确认上游 `atlas/index.ts` 包含等效功能后迁移

---

### 47. Hooks/interactive-bash-session/index.ts 详细合并决策

**冲突位置**: 行 150-162

**本地独有内容** (必须保留):
```typescript
// Skip on Windows - tmux is not available
if (process.platform === "win32") {
  return {
    "tool.execute.after": async () => {},
    event: async () => {},
  }
}
```

**上游**: 无 Windows 平台检查

**决策**: **保留本地** - Windows 平台兼容性检查是必要的，上游缺失这个重要判断

---

### 48. Delegate-Task/constants.ts 详细合并决策

**冲突位置**: 行 256, 313, 682 (3 个冲突点)
**文件规模**: 本地 686 行 vs 上游 527 行

**冲突 1: DEFAULT_CATEGORIES (行 256-306)**

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| `defaultSkills` 字段 | 有 | 无 | **保留本地** |
| `deep` category | 无 | 有 | **采用上游** |
| `most-capable` category | 有 | 无 | **保留本地** |
| `general` category | 有 | 无 | **保留本地** |

**冲突 2: CATEGORY_PROMPT_APPENDS (行 313-318)**

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| `ultrabrain` prompt | `STRATEGIC + IMPLEMENTER_DISCIPLINE` | `ULTRABRAIN_CATEGORY_PROMPT_APPEND` | **合并** - 保留 IMPLEMENTER_DISCIPLINE |
| `deep` entry | 无 | 有 | **采用上游** |

**冲突 3: 尾部空行 (行 682)** - 无实质差异

**合并策略**:
1. 合并 DEFAULT_CATEGORIES: 保留本地 `defaultSkills` + 添加上游 `deep`
2. 合并 CATEGORY_PROMPT_APPENDS: 保留本地 IMPLEMENTER_DISCIPLINE + 添加上游 `deep`
3. 保留本地 `most-capable` 和 `general` categories

---

### 49. Builtin-Commands/types.ts 详细合并决策

**冲突位置**: 行 3-21

**本地**:
```typescript
export type BuiltinCommandName =
  | "init-deep" | "ralph-loop" | "cancel-ralph" | "ulw-loop"
  | "refactor" | "start-work"
  | "status" | "revert" | "evolve"           // 本地独有 8 个
  | "instinct-import" | "instinct-export"
  | "instinct-status" | "build-fix" | "learn"
```

**上游**:
```typescript
export type BuiltinCommandName = "init-deep" | "ralph-loop" | "cancel-ralph" | "ulw-loop" | "refactor" | "start-work" | "stop-continuation"
```

**决策**: **合并两边** - 保留本地 8 个独有命令 + 采用上游 `stop-continuation`

---

### 33. Schema.ts HookNameSchema 合并决策

**冲突位置**: 行 109-143

**本地独有 Hooks (30 个，全部保留)**:
```
sisyphus-orchestrator, tdd-guard, debugging-injector, failure-counter,
skill-suggestion, planning-flow-guide, lsp-diagnostics-enforcer,
subagent-verification, codebase-assessment, phase-flow-enforcer,
plan-reorganizer, plan-update-reminder, plan-attention-refresher,
mdsel-reminder, mdsel-enforcer, observation-recorder, observer-detector,
instinct-trigger, instinct-learner, pattern-extraction, observation-write-guard,
secret-scanner, skill-auto-injector, behavior-anchor, verbosity-controller,
phase-rules-injector, knowledge-injection, project-context-injector, pr-context-injector
```

**上游独有 Hooks (3 个，采纳)**:
```
unstable-agent-babysitter, stop-continuation-guard, tasks-todowrite-disabler
```

**合并操作**: 保留本地 30 个 + 添加上游 3 个 = 33 个 Hooks

---

### 34. Model-Requirements.ts 合并决策 (修正)

**冲突位置**: 多处 (行 38-54 及类型定义)

**上游新增内容 (全部采纳)**:

| # | 新增 | 说明 |
|---|------|------|
| MR1 | `requiresModel?: string` | 类型新增：指定必需模型 |
| MR2 | `requiresAnyModel?: boolean` | 类型新增：要求至少一个模型可用 |
| MR3 | `hephaestus` Agent 配置 | 新 Agent，需要 `gpt-5.2-codex` |
| MR4 | `sisyphus` 新增 kimi 模型 | `kimi-k2.5-free` + `requiresAnyModel: true` |
| MR5 | `explore` 更新模型 | `grok-code-fast-1` 替代 `gpt-5-mini` |
| MR6 | `multimodal-looker` 新增 kimi | `kimi-k2.5-free` |

**冲突解决**:

| Agent | 本地 | 上游 | 决策 |
|-------|------|------|------|
| **librarian** | `big-pickle` | `glm-4.7-free` | **采用上游** `glm-4.7-free` |
| **observer** | 有配置 | 无 | **保留本地** (本地独有 Agent) |

**理由**: 上游版本更新，包含更多模型选择和新功能，优先采用上游

---

### 35. Plugin-Config.ts 合并决策

**冲突位置**: 行 144-150

| 差异 | 本地 | 上游 | 决策 |
|------|------|------|------|
| 调试日志 | `console.error` 调试输出 | 无 | **采用上游** |

**理由**: 调试日志应在发布前移除

---

### 36. Hooks/index.ts 合并决策

**本地独有导出 (30+ 个，全部保留)**:
- TDD 系统: `createTddGuardHook`
- 调试系统: `createDebugInjectorHook`, `createFailureCounterHook`
- 规划系统: `createPlanningFlowGuideHook`, `createPhaseFlowEnforcerHook`
- Observer 系统: 5 个 hooks
- Instinct 系统: 3 个 hooks
- Plan 管理: 3 个 hooks
- mdsel 系统: 2 个 hooks
- 其他: `createSecretScannerHook`, `createVerbosityControllerHook` 等

**上游独有导出 (6 个，全部采纳)**:
- `createSubagentQuestionBlockerHook`
- `createStopContinuationGuardHook`
- `createCompactionContextInjector`
- `createUnstableAgentBabysitterHook`
- `createPreemptiveCompactionHook`
- `createTasksTodowriteDisablerHook`

**合并操作**: 保留本地所有导出 + 添加上游 6 个导出

---

### 32. 上游模块化全景分析

**分析时间**: 2026-02-04

#### 整体文件数对比

| 目录 | 本地 | 上游 | 差异 |
|------|------|------|------|
| src/agents/ | 26 个 | 31 个 | 上游 +5 (模块化拆分) |
| src/hooks/ | **249 个** | 150 个 | **本地 +99** |
| src/tools/ | 76 个 | 97 个 | 上游 +21 (Task 系统 + 模块化) |

#### 上游模块化详情

| 模块 | 本地结构 | 上游结构 | 决策 |
|------|---------|---------|------|
| **prometheus** | 单文件 `prometheus-prompt.ts` | 7 文件目录 | 采用上游 (决策 #11) |
| **sisyphus-junior** | 单文件 | 4 文件目录 (GPT/Claude 分离) | 采用上游 (决策 #12) |
| **agents/atlas** | 单文件 `atlas.ts` | 4 文件目录 (GPT/Claude 分离) | 采用上游 (决策 #24) |
| **delegate-task** | 5 文件 | 10 文件 (executor 分离) | 采用上游 (决策 #31) |
| **task 系统** | ❌ 无 | 12 文件新增 | 不采用 (决策 #3) |

#### 本地独有 Agents (必须保留)

| Agent | 文件 | 用途 |
|-------|------|------|
| **archiver** | `archiver.ts` + test | Phase 3 归档执行 |
| **implementer** | `implementer.ts` + test | 专注实现的执行者 |
| **observer** | `observer.ts` + test | 持续学习系统核心 |

#### 上游新增 Agent

| Agent | 文件 | 用途 | 决策 |
|-------|------|------|------|
| **hephaestus** | `hephaestus.ts` (592 行) | 工具/武器锻造者 | 采用 (决策 #21) |

#### 本地独有 Hooks (99 个文件差异)

本地比上游多 99 个 hooks 文件，包含:
- Observer 系统 (5+ hooks)
- TDD Guard
- Wave 系统 hooks
- Phase 控制 hooks
- Instinct 系统 hooks
- 其他质量保障 hooks

**决策**: 全部保留本地独有 hooks

---

### 29. Prometheus-MD-Only Hook 详细合并决策

**文件规模**: 本地 144 行 vs 上游 ~140 行 (相近)
**冲突类型**: Both modified (常量导入差异)

**冲突详情**:
```typescript
// 本地
import { PROMETHEUS_AGENTS, ALLOWED_PATH_PREFIXES, ... } from "./constants"

// 上游
import { PROMETHEUS_AGENT, ALLOWED_PATH_PREFIX, ... } from "./constants"
```

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| PM1 | **常量命名** | 复数形式 `PROMETHEUS_AGENTS`, `ALLOWED_PATH_PREFIXES` | 单数形式 | **保留本地** | 本地支持多个路径前缀 |
| PM2 | **PROMETHEUS_WORKFLOW_REMINDER** | 无 | 新增 | **采用上游** | 有用的提醒 |
| PM3 | **路径验证逻辑** | 使用 `ALLOWED_PATH_PREFIXES.some()` | 单一前缀 | **保留本地** | 本地更灵活 |

**合并操作**:
1. 保留本地的复数形式常量
2. 添加上游的 `PROMETHEUS_WORKFLOW_REMINDER` 到 constants.ts
3. 确保路径验证支持 `changes/` 目录

---

### 30. Shared/index.ts 详细合并决策

**文件规模**: 本地 54 行 vs 上游 ~45 行
**冲突类型**: Both modified (导出差异)

**本地独有导出 (9 个，保留)**:
| 模块 | 用途 |
|------|------|
| `skill-reminder-generator` | 生成 Skill 使用提醒 |
| `blocked-task-detector` | 检测阻塞的任务响应 |
| `test-quality-gate` | 测试质量门禁 |
| `slop-detector` | AI slop 检测器 |
| `relevance-scorer` | 相关性评分 |
| `anti-pattern-tracker` | 反模式追踪 |
| `isolation-checker` | 隔离检查器 |
| `ast-coverage-checker` | AST 覆盖检查 |
| `part-factory` | 消息 Part 工厂 |

**上游新增导出 (采纳)**:
| 模块 | 用途 |
|------|------|
| `model-suggestion-retry` | 模型建议重试逻辑 |

**合并操作**:
1. 保留本地所有 9 个独有导出
2. 添加上游 `model-suggestion-retry` 导出
3. 确保所有模块文件存在

---

### 31. Delegate-Task/tools.ts 详细合并决策 (深度分析)

**文件规模**: 本地 1093 行 vs 上游模块化 (tools.ts 仅 ~200 行)
**冲突类型**: Both modified (上游重大重构)

**上游模块化结构**:
```
delegate-task/
├── tools.ts         (~200 行)  ← 入口，调用 executor
├── executor.ts      (~980 行)  ← 核心执行逻辑
├── constants.ts     (~530 行)  ← 常量 + Category Prompts
├── categories.ts    (~70 行)   ← Category 配置解析
├── helpers.ts       (~100 行)  ← 辅助函数
├── prompt-builder.ts(~30 行)   ← Prompt 构建
├── timing.ts        (~40 行)   ← 时间配置
├── types.ts         (~50 行)   ← 类型定义
└── index.ts         (~5 行)    ← 导出
```

**上游新增函数 (从 executor.ts 导入)**:
| 函数 | 用途 |
|------|------|
| `resolveSkillContent` | 解析 Skill 内容 |
| `resolveParentContext` | 解析父上下文 |
| `executeBackgroundContinuation` | 后台继续任务 |
| `executeSyncContinuation` | 同步继续任务 |
| `resolveCategoryExecution` | 解析 Category 执行 |
| `resolveSubagentExecution` | 解析 Subagent 执行 |
| `executeUnstableAgentTask` | 执行不稳定 Agent 任务 |
| `executeBackgroundTask` | 执行后台任务 |
| `executeSyncTask` | 执行同步任务 |

**本地独有功能 (需迁移到上游模块)**:
| 功能 | 位置 | 决策 |
|------|------|------|
| `AGENT_DEFAULT_SKILLS` | constants.ts | 迁移到上游 constants.ts |
| `generateSkillReminder` 调用 | tools.ts | 保留在新 executor 中 |
| `getAgentToolRestrictions` 调用 | tools.ts | 保留 |
| Category 默认 Skills 合并逻辑 | tools.ts | 迁移到 categories.ts |
| 详细错误格式化 (`formatDetailedError`) | tools.ts | 迁移到 helpers.ts |

**合并决策**:

| # | 差异项 | 本地 | 上游 | 决策 | 理由 |
|---|--------|------|------|------|------|
| DT1 | **架构** | 单体 1093 行 | 模块化 10 文件 | **采用上游模块化** | 可维护性更好 |
| DT2 | **executor 函数** | 内联 | 独立模块 | **采用上游** | 更清晰 |
| DT3 | **AGENT_DEFAULT_SKILLS** | 有 | 无 | **迁移到上游** | 保留本地功能 |
| DT4 | **generateSkillReminder** | 有 | 无 | **迁移到上游** | 保留本地功能 |
| DT5 | **formatDetailedError** | 有 | 无 | **迁移到上游 helpers** | 保留本地功能 |

**合并操作**:
1. 采用上游模块化结构
2. 将本地 `AGENT_DEFAULT_SKILLS` 迁移到 `constants.ts`
3. 将本地 `generateSkillReminder` 调用迁移到 `executor.ts`
4. 将本地 `formatDetailedError` 迁移到 `helpers.ts`
5. 确保所有本地独有功能在新模块中保留

---

### 26. Sisyphus.ts 详细合并决策

**文件规模**: 本地 921 行 vs 上游 ~530 行 (本地多 391 行)
**冲突类型**: Both modified (merge-lab 有冲突标记)

**本地独有内容 (保留)**:

| # | 内容 | 行数 | 决策 | 理由 |
|---|------|------|------|------|
| SI1 | **Skill Discipline** | ~60 行 | **保留本地** | 严格的 Skill 使用纪律 |
| SI2 | **Red Flags 表格** | ~15 行 | **保留本地** | 防止跳过 Skills |
| SI3 | **Skill Priority** | ~15 行 | **保留本地** | Process skills first, then implementation |
| SI4 | **Risk-Tiered TDD Enforcement** | ~15 行 | **保留本地** | Tier 0-3 TDD 分级 |
| SI5 | **Pre-Delegation Planning** | ~80 行 | **保留本地** | 4-part declaration 格式 |
| SI6 | **ImplementerTaskContext 模板** | ~50 行 | **保留本地** | 标准化委托格式 |
| SI7 | **Execution Mode Auto-Selection** | ~30 行 | **保留本地** | ≤5 tasks=Sequential, >5=Wave |
| SI8 | **Phase 3 Completion Flow** | ~60 行 | **保留本地** | Archiver dispatch 流程 |

**上游改进 (采纳)**:

| # | 改进 | 决策 | 理由 |
|---|------|------|------|
| SI9 | **结构化 Prompt** | **采用上游** | CONTEXT+GOAL+QUESTION+REQUEST 格式 |
| SI10 | **buildTaskManagementSection(useTaskSystem)** | **采用上游** | Task/Todo 双模式支持 |
| SI11 | **动态 Prompt Builder 导入** | **采用上游** | 更模块化 |

**合并操作**:
1. 解决冲突：合并两边的 `delegate_task` 调用语法
2. 保留本地所有 Skill Discipline 和 TDD Enforcement 内容
3. 采用上游的 `buildTaskManagementSection` 双模式设计
4. 保留本地的 Pre-Delegation Planning 4-part 声明格式

---

### 27. Atlas Hook 详细合并决策

**文件规模**: 本地 1132 行 vs 上游 ~760 行 (本地多 372 行)
**冲突类型**: Both modified (merge-lab 有冲突标记)

**本地独有内容 (保留)**:

| # | 内容 | 行数 | 决策 | 理由 |
|---|------|------|------|------|
| AT1 | **EXECUTION_MODE_AUTO_DECISION** | 24 行 | **保留本地** | 自动选择 Sequential/Wave 模式 |
| AT2 | **ARCHIVER_DISPATCH_PROMPT** | 70 行 | **保留本地** | Phase 3 完成流程 |
| AT3 | **VERIFICATION_REMINDER** | 55 行 | **保留本地** | 强制 LSP_DIAGNOSTICS 验证 |
| AT4 | **buildOrchestratorReminder** | 30 行 | **保留本地** | Boulder 状态追踪 |
| AT5 | **Skill phase tracking** | 20 行 | **保留本地** | brainstorming→planning, execution→executing |
| AT6 | **Phase enforcement (Task 9.3)** | 25 行 | **保留本地** | 阻止执行阶段调用规划 agents |
| AT7 | **Blocked response retry logic** | 50 行 | **保留本地** | incrementRetry, isMaxRetries |

**上游改进 (采纳)**:

| # | 改进 | 决策 | 理由 |
|---|------|------|------|
| AT8 | **Guard against undefined output** | **采用上游** | 防止 /review 命令导致的 undefined (issue #1035) |
| AT9 | **Post-compact cooldown** | **已有** | 本地和上游都有 |

**合并操作**:
1. 解决冲突：在 `tool.execute.after` 开头添加 undefined guard
2. 保留本地所有独有内容 (EXECUTION_MODE_AUTO_DECISION, Skill phase tracking 等)
3. 保留本地的 Phase enforcement 逻辑

---

### 28. Commands.ts 详细合并决策

**文件规模**: 本地 183 行 vs 上游 ~96 行 (本地多 87 行)
**冲突类型**: Both modified (merge-lab 有冲突标记)

**本地独有命令 (8 个，全部保留)**:

| 命令 | 描述 | 模板文件 |
|------|------|---------|
| `status` | 显示当前变更执行状态 | `templates/status.ts` |
| `revert` | 回滚到之前的检查点 | `templates/revert.ts` |
| `evolve` | 分析和聚类相关 instincts | `templates/evolve.ts` |
| `instinct-import` | 导入 instincts | `templates/instinct-import.ts` |
| `instinct-export` | 导出 instincts | `templates/instinct-export.ts` |
| `instinct-status` | 显示 instincts 状态报告 | `templates/instinct-status.ts` |
| `build-fix` | 增量修复 TypeScript 构建错误 | `templates/build-fix.ts` |
| `learn` | 从当前会话提取模式创建可重用 skills | `templates/learn.ts` |

**上游新增命令 (采纳)**:

| 命令 | 描述 | 模板文件 |
|------|------|---------|
| `stop-continuation` | 停止所有继续机制 (ralph loop, todo continuation, boulder) | `templates/stop-continuation.ts` |

**合并操作**:
1. 解决冲突：保留本地 8 个命令
2. 添加上游 `stop-continuation` 命令
3. 添加上游 `STOP_CONTINUATION_TEMPLATE` 导入
4. 更新 `types.ts` 添加 `stop-continuation` 到 `BuiltinCommandName` 类型

---

## 🔧 配置文件决策 (4 个)

### 50. .gitignore 合并决策

**文件位置**: `.gitignore` (行 34-43)

**冲突标记**:
```gitignore
<<<<<<< HEAD

# Worktrees
.worktrees/
=======
*.bun-build
>>>>>>> upstream/dev
```

**详细分析**:

| 项目 | LOCAL (HEAD) | UPSTREAM (dev) |
|------|--------------|----------------|
| **新增内容** | `.worktrees/` 目录 | `*.bun-build` 模式 |
| **用途** | 忽略 Git Worktree 工作目录 | 忽略 Bun 构建临时文件 |
| **必要性** | ✅ 本地使用 worktree 功能 | ✅ 防止构建噪音提交 |

**决策**: **合并两边**

**合并后内容**:
```gitignore
# Worktrees
.worktrees/

# Bun build artifacts
*.bun-build
```

**理由**: 两者互不冲突，都是有效的忽略规则。

---

### 51. package.json 合并决策

**文件位置**: `package.json` (行 75-93)

**冲突标记**:
```json
<<<<<<< HEAD
    "bun-types": "latest",
    "mdast-util-gfm": "^3.1.0",
    "mdast-util-to-markdown": "^2.1.2",
    "mdast-util-to-string": "^4.0.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "typescript": "^5.7.3",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.1.0",
    "unist-util-visit-parents": "^6.0.2"
=======
    "bun-types": "1.3.6",
    "typescript": "^5.7.3"
>>>>>>> upstream/dev
```

**详细分析**:

| 项目 | LOCAL (HEAD) | UPSTREAM (dev) |
|------|--------------|----------------|
| **bun-types** | `latest` (不稳定) | `1.3.6` (固定版本) |
| **mdast/remark/unified** | 8 个依赖 | 无 |
| **用途** | mdsel 功能需要 Markdown AST 解析 | 标准配置 |

**本地独有依赖 (8 个)**:

| 依赖 | 版本 | 用途 |
|------|------|------|
| `mdast-util-gfm` | ^3.1.0 | GFM Markdown AST |
| `mdast-util-to-markdown` | ^2.1.2 | AST 转 Markdown |
| `mdast-util-to-string` | ^4.0.0 | AST 转字符串 |
| `remark-gfm` | ^4.0.1 | GFM 解析插件 |
| `remark-parse` | ^11.0.0 | Markdown 解析器 |
| `unified` | ^11.0.5 | 统一处理管道 |
| `unist-util-visit` | ^5.1.0 | AST 遍历 |
| `unist-util-visit-parents` | ^6.0.2 | 带父节点的 AST 遍历 |

**决策**: **保留本地依赖 + 采用上游固定版本**

**合并后内容**:
```json
"bun-types": "1.3.6",
"mdast-util-gfm": "^3.1.0",
"mdast-util-to-markdown": "^2.1.2",
"mdast-util-to-string": "^4.0.0",
"remark-gfm": "^4.0.1",
"remark-parse": "^11.0.0",
"typescript": "^5.7.3",
"unified": "^11.0.5",
"unist-util-visit": "^5.1.0",
"unist-util-visit-parents": "^6.0.2"
```

**理由**: 
1. `bun-types: 1.3.6` 固定版本确保构建可复现
2. mdast/remark 依赖是 mdsel 功能必须的

---

### 52. bun.lock 合并决策

**文件位置**: `bun.lock` (整个文件)

**冲突类型**: 二进制锁文件，包含大量哈希值冲突

**详细分析**:

| 项目 | 说明 |
|------|------|
| **冲突原因** | package.json 依赖差异导致 |
| **手动合并可行性** | ❌ 不可行，锁文件由工具生成 |
| **正确做法** | 先解决 package.json，再重新生成 |

**决策**: **删除后重新生成**

**操作步骤**:
```bash
# 1. 先解决 package.json 冲突
# 2. 删除冲突的 bun.lock
git checkout --theirs bun.lock  # 或直接删除
# 3. 重新安装生成
bun install
# 4. 提交新的 bun.lock
git add bun.lock
```

**理由**: 锁文件应该由包管理器生成，不应手动编辑。

---

### 53. tsconfig.json 合并决策

**文件位置**: `tsconfig.json` (行 16-22)

**冲突标记**:
```json
<<<<<<< HEAD
  "exclude": ["node_modules", "dist", "src/features/builtin-skills/mdsel/cli-src"]
=======
  "exclude": ["node_modules", "dist", "**/*.test.ts", "script"]
>>>>>>> upstream/dev
```

**详细分析**:

| 项目 | LOCAL (HEAD) | UPSTREAM (dev) |
|------|--------------|----------------|
| **排除项** | `mdsel/cli-src` | `**/*.test.ts`, `script` |
| **用途** | mdsel CLI 有独立构建 | 测试文件和脚本不编译 |

**决策**: **合并两边**

**合并后内容**:
```json
"exclude": [
  "node_modules",
  "dist",
  "src/features/builtin-skills/mdsel/cli-src",
  "**/*.test.ts",
  "script"
]
```

**理由**: 所有排除项都是有效的，互不冲突。

---

## 📄 Schema/文档文件决策 (2 个)

### 54. oh-my-opencode.schema.json 合并决策

**文件位置**: `assets/oh-my-opencode.schema.json` (行 94-137)

**冲突焦点**: `disabled_hooks` enum 定义

**本地独有 hooks (29 个)**:
`sisyphus-orchestrator`, `tdd-guard`, `debugging-injector`, `failure-counter`, `skill-suggestion`, `planning-flow-guide`, `lsp-diagnostics-enforcer`, `subagent-verification`, `codebase-assessment`, `phase-flow-enforcer`, `plan-reorganizer`, `plan-update-reminder`, `plan-attention-refresher`, `mdsel-reminder`, `mdsel-enforcer`, `observation-recorder`, `observer-detector`, `instinct-trigger`, `instinct-learner`, `pattern-extraction`, `observation-write-guard`, `secret-scanner`, `skill-auto-injector`, `behavior-anchor`, `verbosity-controller`, `phase-rules-injector`, `knowledge-injection`, `project-context-injector`, `pr-context-injector`

**上游独有 hooks (3 个)**:
`unstable-agent-babysitter`, `stop-continuation-guard`, `tasks-todowrite-disabler`

**决策**: **合并所有 32 个 hooks**

**理由**: Schema 应包含所有可用 hooks 以便配置。

---

### 55. src/hooks/AGENTS.md 合并决策

**文件位置**: `src/hooks/AGENTS.md` (3 处冲突)

**冲突 1 - OVERVIEW**: LOCAL 38 hooks vs UPSTREAM 34 hooks + Event Types 表格

**冲突 2 - STRUCTURE**: LOCAL 10 个 planning hooks vs UPSTREAM 2 个 guard hooks

**冲突 3 - EXECUTION ORDER**: 两边执行顺序包含各自独有 hooks

**决策**: **采用上游文档格式 + 合并本地 hooks 列表**

**合并后内容**:
- 更新 hook 总数为 44
- 保留上游 Event Types 表格格式
- 合并两边 hook 目录结构
- 合并执行顺序

---

## 🧪 测试文件决策 - 第一批 (8 个)

### 56. boulder-state/storage.test.ts

**冲突焦点**: Mock drivers 差异
**决策**: **保留本地 mocks + 采用上游 async cleanup**
**理由**: 本地 mock 更全面，上游 cleanup 更规范

### 57. builtin-skills/skills.test.ts

**冲突焦点**: Skill 数量期望值
**决策**: **合并两边 skill 测试**
**理由**: 需要测试本地 mdsel 等新增 skills

### 58. context-injector/collector.test.ts

**冲突焦点**: AST 深度 vs Token 计数优化策略
**决策**: **采用上游 token-based 逻辑**
**理由**: Token 计数是 LLM 效率的新标准

### 59. skill-mcp-manager/env-cleaner.test.ts

**冲突焦点**: Regex vs Zod 验证方式
**决策**: **采用上游 Zod + 保留本地边界测试**
**理由**: Zod 验证更类型安全

### 60. atlas/index.test.ts

**冲突焦点**: Sequential vs Parallel 执行测试
**决策**: **采用上游并行逻辑**
**理由**: 匹配 manager.ts 当前行为

### 61. compaction-context-injector/index.test.ts

**冲突焦点**: Hardcoded vs Config-driven 阈值
**决策**: **采用上游 describe.each 矩阵**
**理由**: 更好的测试覆盖率

### 62. keyword-detector/index.test.ts

**冲突焦点**: Security vs Architectural 关键词
**决策**: **合并两边 + 转换为 BDD 风格**
**理由**: 保留安全检测，采用 BDD 规范

### 63. prometheus-md-only/index.test.ts

**冲突焦点**: Basic mock vs Integrated interception
**决策**: **采用上游集成拦截**
**理由**: 更可靠的 Prometheus 约束验证

---

## 🧪 测试文件决策 - 第二批 (8 个)

### 64. rules-injector/finder.test.ts

**冲突焦点**: Path normalization 差异
**决策**: **保留本地 normalizePath**
**理由**: 确保 Windows/Linux 跨平台测试通过

### 65. start-work/index.test.ts

**冲突焦点**: `changes/` vs `.sisyphus/` 路径
**决策**: **采用上游 .sisyphus/ + 保留 BDD 注释**
**理由**: 项目已迁移到 .sisyphus/ 结构

### 66. mcp/index.test.ts

**冲突焦点**: 重复测试块，`#given` 标签差异
**决策**: **保留本地 BDD 版本**
**理由**: BDD 标签提高可读性

### 67. opencode-config-dir.test.ts

**冲突焦点**: Win32 vs Linux 路径处理
**决策**: **保留本地跨平台逻辑**
**理由**: 防止 Windows CI 失败

### 68. tmux/tmux-utils.test.ts

**冲突焦点**: 环境隔离方式
**决策**: **保留本地 Object.defineProperty 隔离**
**理由**: 更健壮的 CI 环境隔离

### 69. delegate-task/tools.test.ts

**冲突焦点**: 错误消息字符串差异
**决策**: **采用上游错误消息**
**理由**: 匹配最新实现

### 70. session-manager/tools.test.ts

**冲突焦点**: `projectDir` 常量定义缺失
**决策**: **采用上游文件结构**
**理由**: 修复变量引用错误

### 71. skill-mcp/tools.test.ts

**冲突焦点**: `ToolContext` 类型导入缺失
**决策**: **采用上游类型 + 保留本地 mock helpers**
**理由**: 确保类型正确

---

## 📊 决策统计总览 (71 项)

| 类别 | 已决策数量 |
|------|-----------|
| 核心源文件 | 49 项 (#1-49) |
| 配置文件 | 4 项 (#50-53) |
| Schema/文档 | 2 项 (#54-55) |
| 测试文件 | 16 项 (#56-71) |
| **总计** | **71 项** |

---

## 📋 下一步

1. [x] 所有 46 个冲突文件已分析完成
2. [x] 71 项决策已记录
3. [ ] 创建 `changes/upstream-sync/tasks.md` 执行计划
4. [ ] 在 `merge-lab` 中按优先级执行冲突解决
5. [ ] 验证构建 `bun run build` 和测试 `bun test`

---

## 参考文件

| 文件 | 用途 |
|------|------|
| `changes/upstream-sync/findings/conflicts.txt` | 46 个冲突文件列表 |
| `changes/upstream-sync/tasks.md` | 同步计划 (待更新) |
| `C:/github/oh-my-opencode-merge-lab/` | 合并实验目录 |
