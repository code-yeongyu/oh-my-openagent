# Tasks: implement-missing-features

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **⚠️ 核心原则：复制 → 粘贴 → 适配**
> 
> 所有任务必须遵循：
> 1. **先找到** everything-claude-code 中的对应实现
> 2. **复制粘贴** 原项目的代码/文件
> 3. **适配修改** 到 oh-my-opencode 的架构
> 4. **禁止** 根据理解重写

> **⚠️ 本能设计关键点**
> 
> 本能不是独立的存储系统，而是：
> 1. 通过 `skill("skill-create-and-change")` 创建的**正式完整技能**
> 2. 存储在 `~/.claude/skills/instincts/{name}/SKILL.md`
> 3. 调用/触发功能保持不变，只是存储和创建方式改变

---

## Phase 1: 持续学习 Skill (P0)

### Task 1.1: 复制 continuous-learning-v2 Skill <!-- Risk: Tier-1 -->

**Description:**
从 everything-claude-code 复制 continuous-learning-v2 skill 到 oh-my-opencode。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\SKILL.md`
- `C:\github\everything-claude-code\skills\continuous-learning-v2\config.json`

**Files:**
- Create: `src/features/builtin-skills/continuous-learning/SKILL.md`
- Create: `src/features/builtin-skills/continuous-learning/config.json`

**Acceptance Criteria:**
- [ ] 复制 SKILL.md，更新路径引用（homunculus → 适配 oh-my-opencode）
- [ ] 复制 config.json，更新路径
- [ ] instincts.personal_path 改为 `~/.claude/skills/instincts/`
- [ ] 保持原文内容，只做路径适配

**Dependencies:** None

---

### Task 1.2: 复制 observe.sh 观察钩子脚本 <!-- Risk: Tier-2 -->

**Description:**
复制观察钩子脚本，记录工具调用到 observations.jsonl。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\hooks\observe.sh`

**Files:**
- Create: `src/features/builtin-skills/continuous-learning/hooks/observe.sh`

**Acceptance Criteria:**
- [ ] 复制 observe.sh 脚本
- [ ] 更新 CONFIG_DIR 为 `~/.claude/homunculus`（保持与原项目一致）
- [ ] 更新 OBSERVATIONS_FILE 路径
- [ ] 确保脚本在 Windows (Git Bash) 和 Unix 上都能运行

**Dependencies:** Task 1.1

---

### Task 1.3: 创建 TypeScript 观察钩子适配器 <!-- Risk: Tier-3 -->

**Description:**
创建 TypeScript 钩子，在 PostToolUse 时调用 observe.sh 脚本。

**复制粘贴来源:**
- `src/hooks/` 下现有钩子结构（如 `comment-checker/`）

**Files:**
- Create: `src/hooks/observation-recorder/index.ts`
- Create: `src/hooks/observation-recorder/index.test.ts`

**Acceptance Criteria:**
- [ ] 创建 `createObservationRecorderHook()` 工厂函数
- [ ] 在 PostToolUse 时调用 observe.sh 脚本
- [ ] 传递工具名称、输入、输出、会话 ID
- [ ] 处理脚本执行错误（静默失败，不影响主流程）

**TDD Test Cases:**
1. **Test**: should call observe.sh on PostToolUse
   - **Given**: PostToolUse event with tool data
   - **When**: Hook fires
   - **Then**: observe.sh called with correct JSON

2. **Test**: should handle script errors gracefully
   - **Given**: observe.sh fails
   - **When**: Hook fires
   - **Then**: No error thrown, warning logged

**Dependencies:** Task 1.2

---

## Phase 2: Observer 代理 (P0)

### Task 2.1: 复制并转换 Observer 代理 <!-- Risk: Tier-3 -->

**Description:**
从 everything-claude-code 复制 observer.md，转换为 TypeScript 代理定义。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\agents\observer.md`
- `src/agents/` 下现有代理结构（如 `oracle.ts`）

**Files:**
- Create: `src/agents/observer.ts`
- Create: `src/agents/observer.test.ts`
- Modify: `src/config/schema.ts` - 添加 "observer" 到 `OverridableAgentNameSchema`

**Acceptance Criteria:**
- [ ] 创建 `createObserverAgent(model: string): AgentConfig`
- [ ] 默认模型：`Antigravity-Gemini/gemini-3-flash`
- [ ] 系统提示词从 observer.md 复制（Pattern Detection 章节）
- [ ] 只读工具限制：read, grep, glob
- [ ] 添加到 `OverridableAgentNameSchema` 允许用户覆盖模型
- [ ] 添加 `OBSERVER_PROMPT_METADATA`

**TDD Test Cases:**
1. **Test**: should create agent with default model
   - **Given**: No model parameter
   - **When**: Create observer agent
   - **Then**: Agent uses "Antigravity-Gemini/gemini-3-flash"

2. **Test**: should restrict to read-only tools
   - **Given**: Observer agent config
   - **When**: Check denied tools
   - **Then**: write, edit, task, delegate_task are denied

3. **Test**: should allow model override from config
   - **Given**: User config with observer.model = "custom-model"
   - **When**: Create observer agent
   - **Then**: Agent uses "custom-model"

**Dependencies:** Phase 1 完成

---

### Task 2.2: 注册 Observer 代理 <!-- Risk: Tier-1 -->

**Description:**
将 Observer 代理添加到 agentSources 数组。

**Files:**
- Modify: `src/agents/utils.ts` - 添加 observer 到 agentSources

**Acceptance Criteria:**
- [ ] Observer 代理可通过 `subagent_type="observer"` 调用
- [ ] 正确的模型配置从用户配置读取

**Dependencies:** Task 2.1

---

### Task 2.3: 实现 L1 轻量检测（钩子内同步） <!-- Risk: Tier-3 -->

**Description:**
在 PostToolUse 钩子中实现轻量级异常检测。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\agents\observer.md` - Pattern Detection 章节

**Files:**
- Create: `src/hooks/observer-detector/index.ts`
- Create: `src/hooks/observer-detector/detector.ts`
- Create: `src/hooks/observer-detector/index.test.ts`

**Acceptance Criteria:**
- [ ] 检测循环：同一工具连续调用 3+ 次
- [ ] 检测失败：连续失败 2+ 次
- [ ] 检测到异常时写入 `findings.md`（带 `<!-- observer -->` 标记）
- [ ] 维护工具调用计数器（每 20 次触发 L2）

**TDD Test Cases:**
1. **Test**: should detect loop pattern
   - **Given**: 3 consecutive edit calls
   - **When**: PostToolUse processes 3rd call
   - **Then**: Loop warning added to findings.md

2. **Test**: should trigger L2 every 20 calls
   - **Given**: 19 tool calls processed
   - **When**: 20th call processed
   - **Then**: L2 analysis flag set

**Dependencies:** Task 2.1, Task 2.2

---

### Task 2.4: 实现 L2 定期分析（后台代理） <!-- Risk: Tier-2 -->

**Description:**
每 20 次工具调用启动后台 Observer 代理进行深度分析。

**Files:**
- Modify: `src/hooks/observer-detector/index.ts` - 添加 L2 触发逻辑
- Create: `src/hooks/observer-detector/l2-analyzer.ts`

**Acceptance Criteria:**
- [ ] 调用 `delegate_task(subagent_type="observer", run_in_background=true)`
- [ ] 传入最近 20 次工具调用的摘要
- [ ] Observer 分析后将发现写入 findings.md
- [ ] 可配置触发频率（默认 20）

**Dependencies:** Task 2.3

---

## Phase 3: 本能触发系统 (P0)

### Task 3.1: 实现本能触发钩子 <!-- Risk: Tier-3 -->

**Description:**
创建 PreToolUse 钩子，扫描 `~/.claude/skills/instincts/` 目录，匹配用户输入并注入建议。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\SKILL.md` - The Instinct Model 章节

**Files:**
- Create: `src/hooks/instinct-trigger/index.ts`
- Create: `src/hooks/instinct-trigger/matcher.ts`
- Create: `src/hooks/instinct-trigger/index.test.ts`

**Acceptance Criteria:**
- [ ] 创建 `createInstinctTriggerHook()` 工厂函数
- [ ] 扫描 `~/.claude/skills/instincts/` 目录
- [ ] 读取每个本能的 SKILL.md，提取 trigger 和 confidence
- [ ] 匹配用户输入（正则/关键词）
- [ ] 只注入 confidence >= 0.7 的本能
- [ ] 注入 Action 作为系统提示

**TDD Test Cases:**
1. **Test**: should scan instincts directory
   - **Given**: 2 instinct skills in ~/.claude/skills/instincts/
   - **When**: Hook initializes
   - **Then**: Both instincts loaded

2. **Test**: should match trigger pattern
   - **Given**: Instinct with trigger "when writing functions"
   - **When**: User input contains "writing a function"
   - **Then**: Instinct matches

3. **Test**: should filter by confidence
   - **Given**: Instincts with confidence 0.5 and 0.8
   - **When**: Both match
   - **Then**: Only 0.8 confidence instinct injected

**Dependencies:** Phase 2 完成

---

### Task 3.2: 实现本能学习钩子 <!-- Risk: Tier-3 -->

**Description:**
创建 PostToolUse 钩子，检测成功模式并通过 skill-create-and-change 创建本能。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\agents\observer.md` - Pattern Detection 章节

**Files:**
- Create: `src/hooks/instinct-learner/index.ts`
- Create: `src/hooks/instinct-learner/pattern-detector.ts`
- Create: `src/hooks/instinct-learner/index.test.ts`

**Acceptance Criteria:**
- [ ] 创建 `createInstinctLearnerHook()` 工厂函数
- [ ] 检测重复成功模式（3+ 次相同序列）
- [ ] **调用 `skill("skill-create-and-change")` 创建本能 skill**
- [ ] 本能 SKILL.md 包含 `instinct: true` frontmatter
- [ ] 存储到 `~/.claude/skills/instincts/{name}/SKILL.md`

**模式检测规则（从 observer.md 复制）:**
1. 用户纠正 → 学习偏好
2. 错误修复 → 学习解决方案
3. 重复工作流 → 学习序列
4. 工具偏好 → 学习习惯

**TDD Test Cases:**
1. **Test**: should detect repeated workflow
   - **Given**: grep → read → edit sequence 3 times
   - **When**: 3rd sequence completes
   - **Then**: Workflow instinct created

2. **Test**: should create instinct via skill-create-and-change
   - **Given**: Pattern detected
   - **When**: Creating instinct
   - **Then**: skill("skill-create-and-change") called

**Dependencies:** Task 3.1

---

## Phase 4: 模式提取钩子 (P0)

### Task 4.1: 实现 L3 会话总结提取 <!-- Risk: Tier-3 -->

**Description:**
在 onSummarize 或 session.deleted 时进行完整模式提取。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\SKILL.md` - How It Works 章节

**Files:**
- Create: `src/hooks/pattern-extraction/index.ts`
- Create: `src/hooks/pattern-extraction/pattern-analyzer.ts`
- Create: `src/hooks/pattern-extraction/index.test.ts`

**Acceptance Criteria:**
- [ ] 创建 `createPatternExtractionHook()` 工厂函数
- [ ] 监听 `onSummarize` 事件
- [ ] 分析即将压缩的历史，识别成功模式
- [ ] 模式置信度 > 0.7 时通过 skill-create-and-change 创建本能
- [ ] 本能带 source 字段追溯到原始任务

**TDD Test Cases:**
1. **Test**: should extract pattern from successful sequence
   - **Given**: History with 5 successful TDD cycles
   - **When**: onSummarize triggered
   - **Then**: TDD pattern extracted with confidence > 0.8

2. **Test**: should not create instinct below threshold
   - **Given**: Pattern with confidence 0.5
   - **When**: Pattern analyzed
   - **Then**: No instinct created

**Dependencies:** Phase 3 完成

---

## Phase 5: 命令系统 (P1)

### Task 5.1: 复制并实现 /evolve 命令 <!-- Risk: Tier-2 -->

**Description:**
复制 evolve.md，转换为命令模板。

**复制粘贴来源:**
- `C:\github\everything-claude-code\skills\continuous-learning-v2\commands\evolve.md`

**Files:**
- Create: `src/features/builtin-commands/templates/evolve.ts`
- Modify: `src/features/builtin-commands/commands.ts` - 注册命令

**Acceptance Criteria:**
- [ ] 复制 evolve.md 的逻辑
- [ ] 扫描 `~/.claude/skills/instincts/`
- [ ] 分析相似度和使用频率
- [ ] 聚类相关本能
- [ ] **调用 `skill("skill-create-and-change")` 生成进化 skill**
- [ ] **调用 `skill("skill-backup")` 备份**
- [ ] 生成的 skill 带 `evolved_from` 字段追溯来源

**Dependencies:** Phase 4

---

### Task 5.2: 实现 /learn 命令 <!-- Risk: Tier-2 -->

**Description:**
从当前会话提取模式并生成技能。

**Files:**
- Create: `src/features/builtin-commands/templates/learn.ts`
- Modify: `src/features/builtin-commands/commands.ts` - 注册命令

**Acceptance Criteria:**
- [ ] 分析当前会话历史
- [ ] 调用 pattern-extraction 逻辑
- [ ] **调用 `skill("skill-create-and-change")` 生成 skill**
- [ ] 保存到用户技能目录

**Dependencies:** Phase 4

---

### Task 5.3: 实现 /instinct-status 命令 <!-- Risk: Tier-1 -->

**Description:**
显示本能状态报告。

**Files:**
- Create: `src/features/builtin-commands/templates/instinct-status.ts`
- Modify: `src/features/builtin-commands/commands.ts` - 注册命令

**Acceptance Criteria:**
- [ ] 扫描 `~/.claude/skills/instincts/`
- [ ] 读取每个本能的 SKILL.md
- [ ] 显示 confidence、domain、evidence
- [ ] 支持排序参数（--sort usage/confidence）

**Dependencies:** Phase 3

---

### Task 5.4: 实现 /instinct-import 和 /instinct-export 命令 <!-- Risk: Tier-1 -->

**Description:**
本能导入导出功能。

**Files:**
- Create: `src/features/builtin-commands/templates/instinct-import.ts`
- Create: `src/features/builtin-commands/templates/instinct-export.ts`
- Modify: `src/features/builtin-commands/commands.ts` - 注册命令

**Acceptance Criteria:**
- [ ] /instinct-export 打包指定本能为 zip
- [ ] /instinct-import 从 zip 或 URL 导入
- [ ] 导入时**调用 `skill("skill-create-and-change")` 创建**
- [ ] 支持 --filter 参数筛选

**Dependencies:** Phase 3

---

### Task 5.5: 实现 /build-fix 命令 <!-- Risk: Tier-2 -->

**Description:**
增量修复 TypeScript 构建错误。

**Files:**
- Create: `src/features/builtin-commands/templates/build-fix.ts`
- Modify: `src/features/builtin-commands/commands.ts` - 注册命令

**Acceptance Criteria:**
- [ ] 运行 `bun run build`
- [ ] 解析错误输出
- [ ] 按文件分组
- [ ] 逐个修复
- [ ] 最大迭代次数限制（默认 10）

**Dependencies:** None (独立命令)

---

## Phase 6: MCP 集成 (P1)

### Task 6.1: 集成 Memory MCP <!-- Risk: Tier-2 -->

**Description:**
集成 Memory MCP 实现跨会话记忆。

**Files:**
- Modify: `src/mcp/index.ts` - 添加 memory MCP 配置
- Create: `src/mcp/memory/index.ts`

**Acceptance Criteria:**
- [ ] 配置 `@anthropic/memory-mcp`
- [ ] 自动设置 MEMORY_STORE_PATH
- [ ] 提供 memory 工具给 agent

**Dependencies:** None

---

### Task 6.2: 集成 Sequential Thinking MCP <!-- Risk: Tier-2 -->

**Description:**
集成 Sequential Thinking MCP 实现链式推理。

**Files:**
- Modify: `src/mcp/index.ts` - 添加配置

**Acceptance Criteria:**
- [ ] 配置 `@anthropic/sequential-thinking-mcp`
- [ ] 提供 thinking 工具给 agent

**Dependencies:** None

---

## Phase 7: 领域技能 (P2)

### Task 7.1: 创建 security-audit 技能 <!-- Risk: Tier-0 -->

**Files:**
- Create: `src/features/builtin-skills/security-audit/SKILL.md`

**Acceptance Criteria:**
- [ ] 包含安全审查清单
- [ ] 集成 npm audit, trufflehog 等工具
- [ ] 正确的 YAML frontmatter

**Dependencies:** None

---

### Task 7.2: 创建 database-optimization 技能 <!-- Risk: Tier-0 -->

**Files:**
- Create: `src/features/builtin-skills/database-optimization/SKILL.md`

**Acceptance Criteria:**
- [ ] 包含数据库优化指南
- [ ] 索引分析、N+1 检测等

**Dependencies:** None

---

### Task 7.3: 创建 backend-pattern-* 技能 <!-- Risk: Tier-0 -->

**Files:**
- Create: `src/features/builtin-skills/backend-pattern-go/SKILL.md`
- Create: `src/features/builtin-skills/backend-pattern-java/SKILL.md`
- Create: `src/features/builtin-skills/backend-pattern-python/SKILL.md`

**Acceptance Criteria:**
- [ ] 每个技能包含语言特定的最佳实践
- [ ] 正确的触发词

**Dependencies:** None

---

## Phase 8: 系统集成 (P0)

### Task 8.1: 注册所有新钩子 <!-- Risk: Tier-2 -->

**Files:**
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 注册 observation-recorder
- [ ] 注册 observer-detector
- [ ] 注册 instinct-trigger
- [ ] 注册 instinct-learner
- [ ] 注册 pattern-extraction
- [ ] 钩子优先级正确设置
- [ ] 可通过 disabled_hooks 禁用

**Dependencies:** Phase 1-4

---

### Task 8.2: 注册 continuous-learning Skill <!-- Risk: Tier-1 -->

**Files:**
- Modify: `src/features/builtin-skills/skills.ts` - 添加 skill

**Acceptance Criteria:**
- [ ] continuous-learning skill 可通过 `skill()` 调用
- [ ] 触发词正确配置

**Dependencies:** Task 1.1

---

### Task 8.3: 注册领域技能 <!-- Risk: Tier-1 -->

**Files:**
- Modify: `src/features/builtin-skills/skills.ts` - 添加 5 个新技能

**Acceptance Criteria:**
- [ ] 所有新技能可通过 `skill()` 调用
- [ ] 触发词正确配置

**Dependencies:** Phase 7

---

### Task 8.4: 最终集成测试 <!-- Risk: Tier-3 -->

**Files:**
- Create: `src/features/continuous-learning/integration.test.ts`

**Acceptance Criteria:**
- [ ] 端到端测试：观察 → 模式检测 → 本能创建 → 本能触发
- [ ] `bun run build` 成功
- [ ] `bun test` 全部通过
- [ ] 无类型错误

**Dependencies:** All above

---

## Legend

- `[ ]` = Pending
- `[x]` = Complete
- `[~]` = In Progress
- `[-]` = Skipped

## Risk Tiers

| Tier | Description | TDD Requirement |
|------|-------------|-----------------|
| **0** | Always allowed (docs, comments, .gitignore) | None |
| **1** | Allowed with logging (CSS, renames) | None, logged |
| **2** | Require failing test OR exemption | Test or exemption |
| **3** | Strict TDD (core logic, new features) | Mandatory test first |

## Summary

| Phase | Tasks | Focus |
|:------|:-----:|:------|
| Phase 1: 持续学习 Skill | 3 | 复制 everything-claude-code 的 skill |
| Phase 2: Observer 代理 | 4 | 转换 observer.md 为 TypeScript |
| Phase 3: 本能触发系统 | 2 | 触发和学习钩子 |
| Phase 4: 模式提取 | 1 | L3 会话总结 |
| Phase 5: 命令系统 | 5 | /evolve, /learn, /instinct-* |
| Phase 6: MCP 集成 | 2 | Memory, Sequential Thinking |
| Phase 7: 领域技能 | 3 | security, database, backend |
| Phase 8: 系统集成 | 4 | 注册和测试 |
| **Total** | **24** | |

## 关键复制粘贴清单

| 源文件 | 目标 | 适配 |
|:-------|:-----|:-----|
| `continuous-learning-v2/SKILL.md` | builtin-skills | 更新路径 |
| `continuous-learning-v2/config.json` | builtin-skills | 更新路径 |
| `hooks/observe.sh` | builtin-skills | 适配钩子系统 |
| `agents/observer.md` | src/agents/observer.ts | 转换为 TS |
| `commands/evolve.md` | builtin-commands | 转换为模板 |

## 调用现有流程清单

| 操作 | 调用 |
|:-----|:-----|
| 创建本能 | `skill("skill-create-and-change")` |
| 备份本能 | `skill("skill-backup")` |
| 读取大文件 | `skill("progressive-disclosure-md")` + mdsel |
| 进化本能 | skill-create-and-change + skill-backup |
