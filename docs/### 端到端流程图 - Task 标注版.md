### 端到端流程图 - 目标流程 (Target Flow)

> 以下是**目标流程图**，描述了理想状态下的完整工作流程。
> 
> **注意**: 此流程假设用户通过 Sisyphus 编排器进入，所有 skill 注入和 defaultSkills 合并正常工作。
>
> **图例说明**:
>
> - `───▶` 表示步骤之间的衔接
> - `【链接机制】` 说明前一步骤如何触发后一步骤
> - `【Skill注入】` 说明自动 skill 加载点
>
> **⚠️ 重要修正说明** (2026-01-22):
>
> | 修正项 | 原文档描述 | 实际代码实现 |
> |--------|-----------|-------------|
> | 状态文件 | `.superpowers/status.json` | `boulder.json` (由 `src/features/boulder-state/` 管理) |
> | 执行模式选择 | 代码自动决策 (≤5 串行, >5 并行) | **/start-work 后使用 Question 工具询问用户选择** |
> | Phase 强制 | Hook 阻止在 executing 阶段调用规划 agents | `planning-flow-guide` 只发出警告，**不阻塞** |
> | Worktree 管理 | 每 Wave 自动创建 `.worktrees/wave-N` | **未实现**，需手动调用 `using-git-worktrees` skill |
> | Skill 机制 | 注入完整 SKILL.md 内容 | **提醒优于注入**：defaultSkills 只生成提醒文本，用户显式传入 skills 时才注入完整内容 |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户请求                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
        【链接机制】用户消息 → OpenCode session.prompt() → Sisyphus agent
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 0: 意图门控 (Sisyphus)                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Step 0: 检查 Skills → 匹配则选择对应 Subagent    【Task 2.1】       │    │
│  │   【链接】Sisyphus 调用 skill("brainstorming") 工具加载 skill 内容  │    │
│  │                                                                     │    │
│  │ Step 1: 分类请求类型                              【现有提示】       │    │
│  │   【链接】LLM 内部判断，无工具调用                                  │    │
│  │                                                                     │    │
│  │ Step 2: 检查歧义性 → 2x 工作量差异则询问          【Task 2.2】       │    │
│  │   【链接】LLM 内部判断，必要时输出问题等待用户回复                  │    │
│  │                                                                     │    │
│  │ Step 3: 验证假设、搜索范围、选择目标 Subagent     【现有提示】       │    │
│  │   【链接】LLM 决定下一步：需要规划 or 直接执行                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              需要规划？                         直接执行？
              【Task 10.2】                          │
                    │                               │
  【链接机制 - Task 10.2】                   【链接机制】Sisyphus 调用
  Sisyphus 检测触发条件后调用               sisyphus_task(category=xxx)
  sisyphus_task(subagent_type=               跳转到 PHASE 2B
  "Metis (Plan Consultant)")                        │
                    │                               │
                    ▼                               │
┌───────────────────────────────────────────────────────────────────────────────┐
│              PLANNING PHASE (Subagent 调用 Skill 实现)                        │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Sisyphus 调用 → Metis Subagent                   【Task 8.5, 10.2】    │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 【Skill注入 - Task 8.5】                                          │  │  │
│  │  │ sisyphus_task(subagent_type="Metis (Plan Consultant)", skills=[]) │  │  │
│  │  │   → 自动合并 agent.defaultSkills:                                 │  │  │
│  │  │     • brainstorming                                               │  │  │
│  │  │     • codex-mcp-collaboration                                     │  │  │
│  │  │   → resolveMultipleSkills() 加载 SKILL.md 内容                    │  │  │
│  │  │   → session.prompt({ system: skillContent }) 注入到 Metis         │  │  │
│  │  │                                                                   │  │  │
│  │  │ Metis 执行: 澄清问题 + 隐藏需求 + 风险警告                        │  │  │
│  │  │ 输出: 返回分析结果给 Sisyphus                                     │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
│  【链接机制】Metis 完成 → sisyphus_task 返回结果 → Sisyphus 继续              │
│  【链接机制 - Task 10.1】Sisyphus 调用 sisyphus_task(subagent_type="Prometheus")│
│    → Task 10.1 确保 "Prometheus" 能正确匹配到 "Prometheus (Planner)"          │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Sisyphus 调用 → Prometheus Subagent              【Task 3.1, 10.1】    │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 【Skill注入 - Task 8.5】                                          │  │  │
│  │  │ sisyphus_task(subagent_type="Prometheus", skills=[])              │  │  │
│  │  │   → 自动合并 agent.defaultSkills:                                 │  │  │
│  │  │     • brainstorming (新增)                                        │  │  │
│  │  │     • creating-changes                                            │  │  │
│  │  │     • dispatching-parallel-agents                                 │  │  │
│  │  │   → 生成 skill 提醒文本（非完整内容注入）                          │  │  │
│  │  │   → session.prompt({ system: reminderText }) 注入到 Prometheus    │  │  │
│  │  │                                                                   │  │  │
│  │  │ Prometheus 执行: 创建 design.md + tasks.md                        │  │  │
│  │  │ 输出: 写入 changes/{name}/ 目录，返回结果给 Sisyphus              │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
│  【链接机制】Prometheus 完成 → Sisyphus 读取 design.md + tasks.md             │
│  【链接机制】Sisyphus 调用 sisyphus_task(subagent_type="Momus (Plan Reviewer)")│
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Sisyphus 调用 → Momus Subagent                   【Task 3.1, 3.2】     │  │
│  │  ┌───────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 【Skill注入 - Task 8.5】                                          │  │  │
│  │  │ sisyphus_task(subagent_type="Momus (Plan Reviewer)", skills=[])   │  │  │
│  │  │   → 自动合并 agent.defaultSkills:                                 │  │  │
│  │  │     • verification-before-completion                              │  │  │
│  │  │   → session.prompt({ system: skillContent }) 注入到 Momus         │  │  │
│  │  │                                                                   │  │  │
│  │  │ Momus 执行: 审查 design.md + tasks.md                             │  │  │
│  │  │ 输出: OKAY → 继续 / REJECT → 返回 Prometheus   【Task 3.2】       │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
│  【链接机制 - Task 3.2, 9.3】                                                │
│    OKAY → Phase 强制 Hook 更新状态为 executing 【Task 9.3】                 │
│    REJECT → Sisyphus 重新调用 Prometheus (状态机循环)                         │
│                                    │                                          │
│                                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ /start-work 命令                                                        │  │
│  │ 【链接机制】状态持久化 (boulder-state feature)                          │  │
│  │   → 创建/更新 boulder.json (phase: "executing")                        │  │
│  │   → planning-flow-guide Hook 发出警告 (⚠️ 不阻塞，只警告)              │  │
│  │   → Sisyphus 读取 tasks.md 开始执行                                    │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】boulder.json 状态变更 → Sisyphus 进入执行阶段
  【链接机制】planning-flow-guide 只发出警告，不阻塞 (如需阻塞需代码增强)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 1: 代码库评估 (Sisyphus)      【Task 8.1】        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 【链接机制】Sisyphus 内部 LLM 判断，检查项目配置文件和代码风格       │    │
│  │                                                                     │    │
│  │ Disciplined  → 严格遵循现有风格                                      │    │
│  │ Transitional → 询问用户遵循哪种模式                                  │    │
│  │ Legacy       → 提议新规范                                           │    │
│  │ Greenfield   → 应用最佳实践                                         │    │
│  │                                                                     │    │
│  │ 输出: 设置内部状态变量 codebaseStyle，影响后续代码生成               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】评估完成 → Sisyphus 继续执行，可能需要先探索
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2A: 探索与研究                【Task 4.1】       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 【链接机制】Sisyphus 并行调用多个 sisyphus_task (background=true)    │    │
│  │                                                                     │    │
│  │ sisyphus_task(subagent_type="explore", run_in_background=true, ...) │    │
│  │ sisyphus_task(subagent_type="explore", run_in_background=true, ...) │    │
│  │ sisyphus_task(subagent_type="librarian", run_in_background=true,...)│    │
│  │                                                                     │    │
│  │ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │    │
│  │ │ explore: 内部代码 │  │ explore: 模式搜索 │  │ librarian: 文档  │   │    │
│  │ │ (无 skill 注入)  │  │ (无 skill 注入)  │  │ (无 skill 注入)  │   │    │
│  │ └──────────────────┘  └──────────────────┘  └──────────────────┘   │    │
│  │                                                                     │    │
│  │ 【链接机制】background_output(task_id=xxx) 收集结果                  │    │
│  │ 停止条件：足够上下文 / 重复信息 / 2次无新数据 / 直接答案             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】探索完成 → Sisyphus 综合结果 → 进入实现阶段
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2B: 实现 (混合架构)                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ STEP 1: Sisyphus 创建 TODO 列表，统计任务数量                          │    │
│  │ 【链接机制】Sisyphus 调用 todowrite 工具创建任务列表                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│  【/start-work 后询问用户选择执行模式】                                    │
│    使用 Question 工具显示选项：                                            │
│    ┌────────────────────────────────────────────────────────────────────┐  │
│    │ 选择执行模式:                                                       │  │
│    │  ○ 串行执行 (推荐 ≤5 任务) - 逐个任务执行，每任务自动 git checkpoint │  │
│    │  ○ 并行执行 (推荐 >5 任务) - 按 Wave 分组并行执行                   │  │
│    │  ○ 自动选择 - 根据任务数量自动决定                                  │  │
│    └────────────────────────────────────────────────────────────────────┘  │
│    用户选择后 → 调用对应 skill                                             │
│                                    │                                        │
│         ┌──────────────────────────┴──────────────────────────┐             │
│         │                                                     │             │
│         ▼                                                     ▼             │
│  ┌────────────────────────────────┐    ┌────────────────────────────────┐   │
│  │     SEQUENTIAL EXECUTION       │    │      PARALLEL EXECUTION        │   │
│  │     (任务 ≤5 个)               │    │  (任务 >5 个)                   │   │
│  │     【LLM 决策】               │    │     【LLM 决策】                │   │
│  │                                │    │                                │   │
│  │  Per-Task Execution Loop:     │    │  Wave 分组 + 并行执行           │   │
│  │  ① codex-mcp-collab           │    │  ⚠️ Worktree 需手动调用 skill   │   │
│  │    【链接】Sisyphus 调用       │    │  【链接】Sisyphus 读取          │   │
│  │    codex MCP 获取原型         │    │  tasks.md 分析依赖关系          │   │
│  │                                │    │  按 Wave 分组无依赖任务         │   │
│  │  ② Dispatch 执行者:           │    │  ⚠️ 需调用 using-git-worktrees  │   │
│  │    【链接】sisyphus_task()    │    │     skill 手动创建 worktree     │   │
│  │    • 代码 → Junior            │    │                                │   │
│  │    • UI → Frontend            │    │  【链接】每个 Wave 并行派发     │   │
│  │    • 文档 → Doc-Writer        │    │    sisyphus_task()             │   │
│  │                                │    │                                │   │
│  │  ③ codex-mcp-collab 【1.2】   │    │  每 Wave 完成后:                │   │
│  │    【链接】Sisyphus 调用       │    │  【链接】background_output()   │   │
│  │    codex MCP 审查代码          │    │  收集结果 → codex 审查         │   │
│  │                                │    │  【Task 10.3】合并+清理 Worktree│   │
│  │  ④ 验证 lsp_diagnostics【6.1】│    │  验证 lsp_diagnostics 【6.1】  │   │
│  │    【链接】Sisyphus 调用       │    │  【链接】同左                  │   │
│  │    lsp_diagnostics 工具        │    │                                │   │
│  └────────────────────────────────┘    └────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 执行者类型说明 - 【Skill提醒机制 - Task 8.5】                          │    │
│  │                                                                     │    │
│  │ **提醒优于注入原则**:                                                │    │
│  │ • defaultSkills → 只生成提醒文本，节省上下文                         │    │
│  │ • 用户显式传入 skills 参数 → 注入完整 SKILL.md 内容                  │    │
│  │                                                                     │    │
│  │ ┌─────────────────────────────────────────────────────────────────┐ │    │
│  │ │ Sisyphus-Junior (category-based)                                │ │    │
│  │ │ 【Task 1.2, 8.5】                                               │ │    │
│  │ │                                                                 │ │    │
│  │ │ sisyphus_task(category="ultrabrain", skills=[])                 │ │    │
│  │ │   → 自动合并 category.defaultSkills:                            │ │    │
│  │ │     • systematic-debugging                                      │ │    │
│  │ │     • codex-mcp-collaboration                                   │ │    │
│  │ │   → 生成 skill 提醒文本（非完整内容注入）                        │ │    │
│  │ │   → session.prompt({ system: reminderText }) 注入到 Junior      │ │    │
│  │ │                                                                 │ │    │
│  │ │ 注入三阶段流程:                                                 │ │    │
│  │ │ • Codex原型 (skill: codex-mcp-collaboration)                    │ │    │
│  │ │ • TDD (skill: tdd / test-driven-development)                    │ │    │
│  │ │ • Codex审阅 (skill: codex-mcp-collaboration)                    │ │    │
│  │ └─────────────────────────────────────────────────────────────────┘ │    │
│  │                                                                     │    │
│  │ ┌─────────────────────────────────────────────────────────────────┐ │    │
│  │ │ Frontend-UI-UX (subagent_type)                                  │ │    │
│  │ │ 【现有功能, Task 8.5】                                          │ │    │
│  │ │                                                                 │ │    │
│  │ │ sisyphus_task(subagent_type="frontend-ui-ux-engineer", skills=[])│ │    │
│  │ │   → 自动合并 agent.defaultSkills:                               │ │    │
│  │ │     • frontend-ui-ux                                            │ │    │
│  │ │     • playwright                                                │ │    │
│  │ │   → session.prompt({ system: skillContent }) 注入               │ │    │
│  │ └─────────────────────────────────────────────────────────────────┘ │    │
│  │                                                                     │    │
│  │ ┌─────────────────────────────────────────────────────────────────┐ │    │
│  │ │ Document-Writer (subagent_type)                                 │ │    │
│  │ │ 【Task 5.1】                                                    │ │    │
│  │ │                                                                 │ │    │
│  │ │ sisyphus_task(subagent_type="document-writer", skills=[])       │ │    │
│  │ │   → 无 defaultSkills (使用 agent 内置规则)                      │ │    │
│  │ └─────────────────────────────────────────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】执行者完成任务 → sisyphus_task 返回结果 → Sisyphus 验证
  【链接机制】如果失败 → 进入 PHASE 2C
  【链接机制】如果成功 → 继续下一个任务或进入 PHASE 3
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2C: 失败恢复                  【Task 9.2】        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 【链接机制 - Task 9.2】失败计数器 Hook (代码驱动)                    │    │
│  │                                                                     │    │
│  │ 第1次失败:                                                          │    │
│  │   【链接】sisyphus_task 重新派发，自动注入 systematic-debugging      │    │
│  │   → category.defaultSkills 包含 systematic-debugging                │    │
│  │                                                                     │    │
│  │ 第2次失败:                                                          │    │
│  │   【链接】Sisyphus 调用 sisyphus_task(subagent_type="oracle")       │    │
│  │   → Consult Oracle Agent 获取建议                                   │    │
│  │                                                                     │    │
│  │ 第3次连续失败:                                                      │    │
│  │   【链接】Sisyphus 执行硬编码恢复流程:                              │    │
│  │   1. STOP 所有编辑 → 停止当前任务                                   │    │
│  │   2. REVERT → git checkout 或 undo edits                           │    │
│  │   3. DOCUMENT → 记录失败原因到消息                                  │    │
│  │   4. ASK USER → 输出问题等待用户响应                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】所有任务完成 → Sisyphus 检查 TODO 状态 → 进入 PHASE 3
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 3: 完成                                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Step 3.1: Sisyphus 执行 verification-before-completion 【Task 8.4】 │    │
│  │ 【链接机制】Sisyphus 调用 skill("verification-before-completion")   │    │
│  │   → 运行时加载 skill 内容                                           │    │
│  │   → 执行验收检查: ✓ 验收标准满足 / ✓ 所有测试通过 / ✓ Linters 干净  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                │                                            │
│  【链接机制】验收通过 → 继续 / 验收失败 → 返回 PHASE 2B 修复                │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Step 3.2: Sisyphus 执行 finishing-a-development-branch 【Task 8.4】 │    │
│  │ 【链接机制】Sisyphus 调用 skill("finishing-a-development-branch")   │    │
│  │   → 运行时加载 skill 内容                                           │    │
│  │   → 询问用户 Git 策略: merge / pr / keep / discard                  │    │
│  │   → 等待用户选择                                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                │                                            │
│  【链接机制】用户选择 Git 策略 → Sisyphus 派发 Archiver                     │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Step 3.3: Sisyphus 派发 → Archiver Agent            【Task 1.1】    │    │
│  │                                                                     │    │
│  │ 【Skill注入 - Task 8.5】                                            │    │
│  │ sisyphus_task(subagent_type="archiver", skills=[])                  │    │
│  │   → 自动合并 agent.defaultSkills:                                   │    │
│  │     • verification-before-completion                                │    │
│  │     • finishing-a-development-branch                                │    │
│  │     • archiving-changes                                             │    │
│  │   → session.prompt({ system: skillContent }) 注入到 Archiver        │    │
│  │                                                                     │    │
│  │ Archiver 执行:                                                      │    │
│  │   • 运行 lsp_diagnostics / 构建验证                                 │    │
│  │   • 执行 Git 策略 (merge/pr/keep/discard)                           │    │
│  │   • 合并 Worktree / 删除 Worktree                                   │    │
│  │   • 移动到归档目录 changes/archive/YYYY-MM-DD-{name}/               │    │
│  │                                                                     │    │
│  │ 输出: 返回归档结果给 Sisyphus                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                │                                            │
│  【链接机制】Archiver 完成 → sisyphus_task 返回 → Sisyphus 最终清理         │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Step 3.4: Sisyphus 最终职责                         【现有功能】     │    │
│  │ 【链接机制】Sisyphus 执行清理操作:                                   │    │
│  │   • background_cancel(all=true) → 取消所有后台任务                  │    │
│  │   • todoread → 确认所有 TODO 完成                                   │    │
│  │   • 输出最终报告给用户                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
  【链接机制】Sisyphus 输出完成消息 → 用户收到响应
                                    │
                                    ▼
                              ✅ 任务完成
```