# Tasks: 50项功能增强

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

---

## Phase 1: 安全与TDD强化 (Week 1)

### Task 1.1: TDD 真实测试验证 <!-- Risk: Tier-3 -->

**Description:**
将 `hasFailingTest` 从硬编码 `false` 改为真正执行测试命令，验证 RED 阶段确实有失败测试。

**Files:**
- Modify: `src/hooks/tdd-guard/index.ts` - 实现真实测试执行
- Modify: `src/hooks/tdd-guard/types.ts` - 添加执行结果类型
- Test: `src/hooks/tdd-guard/index.test.ts` - 添加测试用例

**Acceptance Criteria:**
- [ ] 当存在失败测试时，`hasFailingTest` 返回 `true`
- [ ] 当所有测试通过时，`hasFailingTest` 返回 `false`
- [ ] 测试执行超过 30 秒自动超时，返回 `true`（保守策略）
- [ ] 支持通过配置禁用真实执行

**TDD Test Cases:**
1. **Test**: should return true when tests fail
   - **Given**: 项目中存在一个失败的测试文件
   - **When**: 调用 `hasFailingTest()`
   - **Then**: 返回 `true`

2. **Test**: should return false when all tests pass
   - **Given**: 项目中所有测试都通过
   - **When**: 调用 `hasFailingTest()`
   - **Then**: 返回 `false`

3. **Test**: should timeout after 30 seconds
   - **Given**: 测试执行时间超过 30 秒
   - **When**: 调用 `hasFailingTest()`
   - **Then**: 返回 `true`（保守策略，假设有失败测试）

**Edge Cases:**
- 没有测试文件：返回 `false`（允许继续）
- 测试命令不存在：返回 `false` 并警告
- 并发调用：使用锁防止重复执行

**Dependencies:** None

---

### Task 1.2: 敏感信息预扫描钩子 <!-- Risk: Tier-3 -->

**Description:**
在 PreToolUse 阶段新增敏感信息检测，在写入磁盘前拦截可能的密钥、密码等。

**Files:**
- Create: `src/hooks/secret-scanner/index.ts` - 钩子主逻辑
- Create: `src/hooks/secret-scanner/patterns.ts` - 检测模式定义
- Create: `src/hooks/secret-scanner/types.ts` - 类型定义
- Test: `src/hooks/secret-scanner/index.test.ts` - 测试用例
- Modify: `src/index.ts` - 注册新钩子

**Acceptance Criteria:**
- [ ] 检测到 `API_KEY=xxx` 格式时阻断并警告
- [ ] 检测到 `password: "xxx"` 格式时阻断并警告
- [ ] 检测到 AWS/Azure/GCP 密钥格式时阻断
- [ ] 正常代码不触发误报
- [ ] 支持配置白名单路径

**TDD Test Cases:**
1. **Test**: should block content with API key pattern
   - **Given**: 工具输出包含 `API_KEY="sk-12345"`
   - **When**: PreToolUse 钩子执行
   - **Then**: 返回 `{ decision: "block", message: "检测到敏感信息" }`

2. **Test**: should allow normal code
   - **Given**: 工具输出是正常的代码 `const api = fetchData()`
   - **When**: PreToolUse 钩子执行
   - **Then**: 返回 `{ decision: "allow" }`

3. **Test**: should respect whitelist paths
   - **Given**: 文件路径在白名单中，内容包含密钥模式
   - **When**: PreToolUse 钩子执行
   - **Then**: 返回 `{ decision: "allow" }`

**Edge Cases:**
- 测试文件中的 mock 密钥：检查路径是否为 test 目录
- 环境变量引用：`process.env.API_KEY` 不应阻断
- 注释中的示例：检测但降低严重级别

**Dependencies:** None

---

### Task 1.3: 高风险操作双重审计 <!-- Risk: Tier-2 -->

**Description:**
在规则注入器中新增安全等级分类，高风险操作（删除、执行）强制输出安全分析摘要。

**Files:**
- Modify: `src/hooks/rules-injector/index.ts` - 添加安全等级逻辑
- Create: `src/hooks/rules-injector/security-tiers.ts` - 安全等级定义
- Test: `src/hooks/rules-injector/security-tiers.test.ts` - 测试用例

**Acceptance Criteria:**
- [ ] 定义三个安全等级：LOW (read), MEDIUM (write), HIGH (delete/exec)
- [ ] HIGH 级别操作自动注入"安全分析要求"到上下文
- [ ] 安全等级可通过配置自定义
- [ ] 不影响现有规则注入逻辑

**TDD Test Cases:**
1. **Test**: should classify delete operations as HIGH
   - **Given**: 工具调用为 `bash` 且命令包含 `rm`
   - **When**: 评估安全等级
   - **Then**: 返回 `SecurityTier.HIGH`

2. **Test**: should inject security analysis prompt for HIGH tier
   - **Given**: 操作被分类为 HIGH
   - **When**: 规则注入执行
   - **Then**: 上下文包含"请输出安全分析摘要"

**Edge Cases:**
- `rm` 在注释中：不应触发
- 用户明确授权：仍然注入但不阻断

**Dependencies:** None

---

### Task 1.4: 角色感知规则注入 <!-- Risk: Tier-2 -->

**Description:**
根据当前 Agent 类型动态注入不同规则集。Oracle 收到架构规则，Explore 收到轻量规则。

**Files:**
- Modify: `src/hooks/rules-injector/index.ts` - 添加角色检测
- Create: `src/hooks/rules-injector/role-rules.ts` - 角色规则映射
- Test: `src/hooks/rules-injector/role-rules.test.ts` - 测试用例

**Acceptance Criteria:**
- [ ] Oracle agent 收到架构和设计相关规则
- [ ] Explore agent 收到精简的搜索规则
- [ ] Sisyphus 收到完整规则集
- [ ] 未知 agent 使用默认规则

**TDD Test Cases:**
1. **Test**: should inject architecture rules for Oracle
   - **Given**: 当前 agent 为 `oracle`
   - **When**: 规则注入执行
   - **Then**: 规则包含"架构评审要点"

2. **Test**: should inject minimal rules for Explore
   - **Given**: 当前 agent 为 `explore`
   - **When**: 规则注入执行
   - **Then**: 规则字数少于 500

**Edge Cases:**
- Agent 名称大小写：统一转小写比较
- 自定义 agent：使用默认规则

**Dependencies:** Task 1.3 (共享 rules-injector 文件)

---

## Phase 2: 技能与上下文 (Week 1-2)

### Task 2.1: 技能自动注入机制 <!-- Risk: Tier-3 -->

**Description:**
通过 Hook 检测任务类型，自动将相关技能指令注入上下文，减少对 AI 主动调用 `skill()` 的依赖。

**Files:**
- Create: `src/hooks/skill-auto-injector/index.ts` - 自动注入钩子
- Create: `src/hooks/skill-auto-injector/detectors.ts` - 任务类型检测器
- Test: `src/hooks/skill-auto-injector/index.test.ts` - 测试用例
- Modify: `src/index.ts` - 注册新钩子

**Acceptance Criteria:**
- [ ] 检测到 git 相关操作时自动注入 git-master 技能
- [ ] 检测到浏览器相关任务时自动注入 playwright 技能
- [ ] 检测到前端任务时自动注入 frontend-ui-ux 技能
- [ ] 用户手动调用 `skill()` 优先于自动注入
- [ ] 可通过配置禁用特定自动注入

**TDD Test Cases:**
1. **Test**: should inject git-master for git operations
   - **Given**: 用户提示包含 "commit" 或 "git"
   - **When**: UserPromptSubmit 钩子执行
   - **Then**: 上下文包含 git-master 技能指令

2. **Test**: should not duplicate if skill already loaded
   - **Given**: 用户已手动调用 `skill("git-master")`
   - **When**: 检测到 git 操作
   - **Then**: 不重复注入

**Edge Cases:**
- 多个技能匹配：按优先级注入最相关的一个
- 技能不存在：跳过并警告

**Dependencies:** None

---

### Task 2.2: 统一技能文档格式 <!-- Risk: Tier-1 -->

**Description:**
统一所有内置技能采用 git-master 模板格式，每个技能必须包含 Boundaries 和 Anti-Patterns。

**Files:**
- Modify: `src/features/builtin-skills/*/SKILL.md` - 统一格式
- Modify: `src/features/builtin-skills/skills.ts` - 更新描述

**Acceptance Criteria:**
- [ ] 所有 SKILL.md 包含 "## When to Use" 部分
- [ ] 所有 SKILL.md 包含 "## Not For / Boundaries" 部分
- [ ] 所有 SKILL.md 包含 "## Anti-Patterns" 部分
- [ ] 格式与 git-master/SKILL.md 一致

**TDD Test Cases:**
1. **Test**: all skills should have required sections
   - **Given**: 读取所有 SKILL.md 文件
   - **When**: 检查必需部分
   - **Then**: 每个文件都包含 When to Use, Boundaries, Anti-Patterns

**Edge Cases:**
- 新增技能：提供模板检查脚本

**Dependencies:** None

---

### Task 2.3: 意图模式切换 <!-- Risk: Tier-3 -->

**Description:**
实现三种意图模式（开发/审查/研究），根据任务类型动态调整系统指令。

**Files:**
- Modify: `src/features/context-injector/collector.ts` - 添加模式检测
- Create: `src/features/context-injector/intent-modes.ts` - 模式定义
- Test: `src/features/context-injector/intent-modes.test.ts` - 测试用例

**Acceptance Criteria:**
- [ ] 检测到 "review"、"审查" 关键词切换到审查模式
- [ ] 检测到 "research"、"研究"、"探索" 切换到研究模式
- [ ] 默认为开发模式
- [ ] 每种模式注入不同的系统指令

**TDD Test Cases:**
1. **Test**: should switch to review mode
   - **Given**: 用户提示包含 "请审查这段代码"
   - **When**: 意图检测执行
   - **Then**: 模式为 `review`，注入审查相关指令

2. **Test**: should default to dev mode
   - **Given**: 用户提示是普通开发任务
   - **When**: 意图检测执行
   - **Then**: 模式为 `dev`

**Edge Cases:**
- 混合意图：优先级为 review > research > dev
- 用户明确指定模式：`--mode=review` 覆盖自动检测

**Dependencies:** None

---

### Task 2.4: 战略性主动压缩 <!-- Risk: Tier-2 -->

**Description:**
检测到阶段完成时主动提示压缩，而非等待窗口溢出才被动压缩。

**Files:**
- Modify: `src/hooks/compaction-context-injector/index.ts` - 添加阶段检测
- Create: `src/hooks/compaction-context-injector/milestone-detector.ts` - 里程碑检测
- Test: `src/hooks/compaction-context-injector/milestone-detector.test.ts`

**Acceptance Criteria:**
- [ ] 检测到 "done"、"完成"、"finished" 触发压缩建议
- [ ] 检测到 Phase 切换触发压缩建议
- [ ] 压缩建议以非阻断方式呈现
- [ ] 用户拒绝后本轮不再提醒

**TDD Test Cases:**
1. **Test**: should suggest compaction on milestone
   - **Given**: 助手输出包含 "Phase 1 完成"
   - **When**: 里程碑检测执行
   - **Then**: 返回压缩建议

**Edge Cases:**
- 频繁触发：同一会话最多提醒 3 次

**Dependencies:** None

---

## Phase 3: 代理与并行 (Week 2)

### Task 3.1: Oracle 决策框架 <!-- Risk: Tier-2 -->

**Description:**
在 Oracle 提示词中加入 Effort Estimate 要求，强制 "One Clear Path" 输出格式。

**Files:**
- Modify: `src/agents/oracle.ts` - 更新系统提示词

**Acceptance Criteria:**
- [ ] Oracle 输出必须包含 "## Effort Estimate" 部分
- [ ] Oracle 输出必须包含 "## Recommended Path" 部分
- [ ] 估算格式为：小/中/大 + 预计时间

**TDD Test Cases:**
1. **Test**: Oracle prompt should require effort estimate
   - **Given**: 读取 Oracle 系统提示词
   - **When**: 检查内容
   - **Then**: 包含 "必须输出 Effort Estimate"

**Edge Cases:**
- 简单问题：允许简化输出

**Dependencies:** None

---

### Task 3.2: 结构化交接协议 <!-- Risk: Tier-3 -->

**Description:**
强制生成 Summary/Discovery/Questions/Suggestions 格式的交接信息。

**Files:**
- Modify: `src/features/background-agent/manager.ts` - 添加输出解析
- Create: `src/features/background-agent/handover-protocol.ts` - 交接格式定义
- Test: `src/features/background-agent/handover-protocol.test.ts`

**Acceptance Criteria:**
- [ ] Agent 返回结果必须包含四部分结构
- [ ] 缺少任何部分时自动补充占位符
- [ ] 支持从非结构化输出中提取关键信息

**TDD Test Cases:**
1. **Test**: should parse structured handover
   - **Given**: Agent 输出符合格式
   - **When**: 解析执行
   - **Then**: 返回包含四部分的对象

2. **Test**: should handle unstructured output
   - **Given**: Agent 输出不符合格式
   - **When**: 解析执行
   - **Then**: 自动提取并填充缺失部分

**Edge Cases:**
- 空输出：返回全空的结构化对象

**Dependencies:** None

---

### Task 3.3: 依赖图感知波次执行 <!-- Risk: Tier-3 -->

**Description:**
分析任务依赖关系，只有互不干扰的任务放入同一 Wave。

**Files:**
- Modify: `src/features/background-agent/manager.ts` - 添加依赖分析
- Create: `src/features/background-agent/dependency-graph.ts` - 依赖图实现
- Test: `src/features/background-agent/dependency-graph.test.ts`

**Acceptance Criteria:**
- [ ] 解析任务中的 "Dependencies: Task X.Y" 字段
- [ ] 构建有向无环图 (DAG)
- [ ] 按拓扑排序生成 Wave
- [ ] 循环依赖时报错

**TDD Test Cases:**
1. **Test**: should group independent tasks into same wave
   - **Given**: Task A 和 Task B 无依赖
   - **When**: 生成 Wave
   - **Then**: A 和 B 在同一 Wave

2. **Test**: should sequence dependent tasks
   - **Given**: Task B 依赖 Task A
   - **When**: 生成 Wave
   - **Then**: A 在 Wave 1，B 在 Wave 2

3. **Test**: should detect circular dependency
   - **Given**: A 依赖 B，B 依赖 A
   - **When**: 生成 Wave
   - **Then**: 抛出循环依赖错误

**Edge Cases:**
- 无依赖信息：每个任务独立一个 Wave（保守策略）

**Dependencies:** None

---

### Task 3.4: 缓存友好型上下文重组 <!-- Risk: Tier-2 -->

**Description:**
标准化注入顺序以最大化 Prompt Caching 命中率。

**Files:**
- Modify: `src/features/context-injector/collector.ts` - 固定注入顺序

**Acceptance Criteria:**
- [ ] 注入顺序固定为：system → agents.md → rules → skills → dynamic
- [ ] 静态内容放前面，动态内容放后面
- [ ] 顺序可通过配置调整

**TDD Test Cases:**
1. **Test**: should maintain fixed injection order
   - **Given**: 收集多个上下文来源
   - **When**: 执行注入
   - **Then**: 输出顺序符合预定义

**Edge Cases:**
- 某个来源为空：跳过但保持其他顺序

**Dependencies:** Task 2.3 (共享 collector.ts)

---

## Phase 4: MCP与钩子 (Week 2)

### Task 4.1: 本地 Stdio MCP 支持 <!-- Risk: Tier-3 -->

**Description:**
增加 `LocalMcpConfig` 类型，允许 `npx/uvx` 启动本地 MCP 进程。

**Files:**
- Modify: `src/mcp/index.ts` - 添加本地服务器支持
- Modify: `src/config/schema.ts` - 添加 LocalMcpConfig 类型
- Test: `src/mcp/index.test.ts` - 添加测试用例

**Acceptance Criteria:**
- [ ] 支持 `{ type: "local", command: "npx xxx" }` 配置
- [ ] 自动管理本地进程生命周期
- [ ] 进程退出时自动重启（可配置）
- [ ] 不影响现有 Remote HTTP 支持

**TDD Test Cases:**
1. **Test**: should start local MCP process
   - **Given**: 配置包含 local MCP
   - **When**: 初始化 MCP
   - **Then**: 进程启动成功

**Edge Cases:**
- 命令不存在：报错并跳过
- 进程崩溃：重试 3 次后标记失败

**Dependencies:** None

---

### Task 4.2: MCP 工具数量警告 <!-- Risk: Tier-1 -->

**Description:**
当启用 MCP 工具总数超过 80 时发出警告。

**Files:**
- Modify: `src/mcp/index.ts` - 添加数量检查
- Modify: `src/config/schema.ts` - 添加阈值配置

**Acceptance Criteria:**
- [ ] 工具数 > 80 时输出警告
- [ ] 警告不阻断启动
- [ ] 阈值可配置

**TDD Test Cases:**
1. **Test**: should warn when tool count exceeds threshold
   - **Given**: 加载 85 个 MCP 工具
   - **When**: 初始化完成
   - **Then**: 输出警告消息

**Edge Cases:**
- 恰好 80 个：不警告

**Dependencies:** Task 4.1 (共享 mcp/index.ts)

---

### Task 4.3: 标准化 HookMatcher <!-- Risk: Tier-3 -->

**Description:**
抽象 `HookMatcher` 接口，支持正则和 Glob 配置。

**Files:**
- Modify: `src/hooks/index.ts` - 抽象匹配器
- Create: `src/hooks/matchers/index.ts` - 匹配器实现
- Create: `src/hooks/matchers/regex-matcher.ts` - 正则匹配
- Create: `src/hooks/matchers/glob-matcher.ts` - Glob 匹配
- Test: `src/hooks/matchers/index.test.ts`

**Acceptance Criteria:**
- [ ] 定义 `HookMatcher` 接口
- [ ] 实现 RegexMatcher
- [ ] 实现 GlobMatcher
- [ ] 现有硬编码逻辑迁移到 Matcher

**TDD Test Cases:**
1. **Test**: RegexMatcher should match patterns
   - **Given**: 模式为 `/\.ts$/`
   - **When**: 匹配 `file.ts`
   - **Then**: 返回 `true`

2. **Test**: GlobMatcher should match patterns
   - **Given**: 模式为 `src/**/*.ts`
   - **When**: 匹配 `src/hooks/index.ts`
   - **Then**: 返回 `true`

**Edge Cases:**
- 无效正则：报错并跳过
- 空模式：匹配所有

**Dependencies:** None

---

## Phase 5: 测试与命令 (Week 2)

### Task 5.1: TDD 测试模板自动生成 <!-- Risk: Tier-2 -->

**Description:**
TDD 拦截时自动生成针对目标修改的测试文件脚手架。

**Files:**
- Modify: `src/hooks/tdd-guard/index.ts` - 添加模板生成
- Create: `src/hooks/tdd-guard/template-generator.ts` - 模板生成逻辑
- Test: `src/hooks/tdd-guard/template-generator.test.ts`

**Acceptance Criteria:**
- [ ] 生成的模板包含 describe/it 结构
- [ ] 模板包含目标文件的 import
- [ ] 不覆盖已存在的测试文件
- [ ] 模板路径遵循项目约定

**TDD Test Cases:**
1. **Test**: should generate test template
   - **Given**: 目标文件为 `src/utils/helper.ts`
   - **When**: 生成模板
   - **Then**: 创建 `src/utils/helper.test.ts` 包含基本结构

**Edge Cases:**
- 测试文件已存在：跳过生成
- 无法推断测试路径：使用默认约定

**Dependencies:** Task 1.1 (共享 tdd-guard)

---

### Task 5.2: /plan 风险矩阵 <!-- Risk: Tier-2 -->

**Description:**
在 Prometheus 输出中强制包含"风险与缓解"部分。

**Files:**
- Modify: `src/agents/prometheus-prompt.ts` - 更新提示词模板

**Acceptance Criteria:**
- [ ] 计划输出包含 "## Risk Assessment" 部分
- [ ] 风险矩阵包含：风险、可能性、影响、缓解
- [ ] 破坏性更改有明确标记

**TDD Test Cases:**
1. **Test**: Prometheus prompt should require risk matrix
   - **Given**: 读取 Prometheus 系统提示词
   - **When**: 检查内容
   - **Then**: 包含风险矩阵要求

**Edge Cases:**
- 简单任务：允许简化风险评估

**Dependencies:** None

---

## Phase 6-10: 中优先级增强 (Week 3-4)

> 以下为 28 项中优先级增强的概要。每项遵循相同的 TDD 工作流。

### Task 6.1: M2 - 配置模板化与环境变量解耦 <!-- Risk: Tier-2 -->
- [ ] 引入 `mcp_templates` 概念
- [ ] 用户只需提供 Key 即可激活预设 MCP

### Task 6.2: M4 - 懒加载与 CLI 封装 <!-- Risk: Tier-2 -->
- [ ] 实现"影子 MCP"
- [ ] 仅在调用特定 Category 时动态挂载

### Task 6.3: M5 - 后置 Hook 联动 <!-- Risk: Tier-2 -->
- [ ] MCP 修改代码后自动触发 LSP 诊断

### Task 7.1: S2 - Frontmatter 扩展 <!-- Risk: Tier-2 -->
- [ ] 支持从 SKILL.md YAML 读取匹配 Hooks

### Task 7.2: S4 - 模式探测 <!-- Risk: Tier-2 -->
- [ ] 引入初始探测阶段识别项目风格

### Task 8.1: C2 - 上下文相关性排序优化 <!-- Risk: Tier-2 -->
- [ ] 根据意图模式动态调整资源权重

### Task 8.2: C4 - 摘要增加反模式记录 <!-- Risk: Tier-2 -->
- [ ] 记录"哪些路径尝试失败了"

### Task 8.3: C5 - 行为准则周期性锚定 <!-- Risk: Tier-2 -->
- [ ] 检测 AI Slop 时自动注入行为准则

### Task 9.1: R2 - 任务阶段感知规则注入 <!-- Risk: Tier-2 -->
- [ ] 不同阶段注入不同规则

### Task 9.2: R4 - 基于 AST 的测试覆盖匹配 <!-- Risk: Tier-3 -->
- [ ] 验证测试是否引用目标函数符号

### Task 9.3: R5 - 测试质量门禁升级 <!-- Risk: Tier-2 -->
- [ ] 检测直接操作数据库/网络的测试

### Task 9.4: R8 - PR 历史追溯注入 <!-- Risk: Tier-2 -->
- [ ] 自动运行 `git diff [base]...HEAD` 注入上下文

### Task 10.1: A1 - 多阶段验证循环 <!-- Risk: Tier-3 -->
- [ ] 引入"批判者模型"进行语义审查

### Task 10.2: A2 - 动态阶段回溯机制 <!-- Risk: Tier-3 -->
- [ ] 验证失败时自动提取原因并重组 tasks.md

### Task 10.3: A4 - 分层上下文压缩 <!-- Risk: Tier-2 -->
- [ ] 提取"已解决 Bug 模式"到 knowledge.json

### Task 10.4: A6 - 动态 Verbosity 控制 <!-- Risk: Tier-2 -->
- [ ] 接近 Token 限制时切换 minimal 模式

### Task 11.1: T1 - 统一验证运行器 <!-- Risk: Tier-2 -->
- [ ] 实现 `doctor --test` 聚合统计

### Task 11.2: T3 - TDD 状态感知显示 <!-- Risk: Tier-1 -->
- [ ] 终端显示 `[TDD: RED]` 状态

### Task 11.3: T4 - 会话质量评分 <!-- Risk: Tier-2 -->
- [ ] 会话结束时对测试完整性评分

### Task 12.1: D2 - /refactor 整合清理工具 <!-- Risk: Tier-2 -->
- [ ] 加入 knip 检测未使用代码

### Task 12.2: D3 - 循环检测算法 <!-- Risk: Tier-2 -->
- [ ] 连续两次相同错误触发战略调整

### Task 12.3: D4 - 场景化预设 <!-- Risk: Tier-2 -->
- [ ] 增加 `--mode` 参数 (quick/full/pre-pr)

### Task 13.1: G2 - Librarian 文档发现流程 <!-- Risk: Tier-2 -->
- [ ] 先获取 Sitemap 再抓取内容

### Task 13.2: G3 - Explore 意图分析 <!-- Risk: Tier-2 -->
- [ ] 按安全性/质量/性能三维度排序输出

### Task 13.3: G5 - 预定义协作序列 <!-- Risk: Tier-2 -->
- [ ] 为 Bugfix 和 Refactor 定义专用代理链

### Task 14.1: H2 - 上下文感知匹配 <!-- Risk: Tier-2 -->
- [ ] 支持根据包管理器类型启用/禁用钩子

### Task 14.2: H3 - Stop 阶段最终审计 <!-- Risk: Tier-2 -->
- [ ] 高成本检查仅在 Stop 时运行

### Task 14.3: H4 - 优雅降级 <!-- Risk: Tier-2 -->
- [ ] 钩子失败时标记 unstable 并跳过

---

## Phase 11: 低优先级增强 (按需)

### Task 15.1: M6 - 健康检查与降级策略 <!-- Risk: Tier-1 -->
- [ ] 启动时异步检测 Remote MCP 可用性

### Task 15.2: R9 - 原子化提交强制约束 <!-- Risk: Tier-1 -->
- [ ] 单次 Commit 涉及文件 > 3 时提示分拆

### Task 15.3: T5 - 跨 Agent 验证链 <!-- Risk: Tier-2 -->
- [ ] 自动指派 Oracle 编写独立集成测试

### Task 15.4: G6 - 风险分级 TDD 配置 <!-- Risk: Tier-1 -->
- [ ] 为不同文件路径配置 `tdd_requirement`

### Task 15.5: S5 - 引入外部引用 <!-- Risk: Tier-1 -->
- [ ] 将复杂模板移至 references/ 目录

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
