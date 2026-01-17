# Oh My OpenCode 工作流文档

> 本文档描述 Oh My OpenCode 的统一工作流体系，以及 Skills 如何嵌入主流程

---

## 目录

1. [核心理解：Skills 是流程的一部分](#核心理解skills-是流程的一部分)
2. [统一工作流 (Sisyphus 主流程)](#统一工作流-sisyphus-主流程)
3. [Skill 触发机制](#skill-触发机制)
4. [流程分支详解](#流程分支详解)
5. [Skill 触发条件一览](#skill-触发条件一览)

---

## 核心理解：Skills 是流程的一部分

**重要澄清**: Brainstorming 流程**不是**与现有流程脱节的独立流程，而是**嵌入在 Sisyphus 主流程中的 Skill 链**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Sisyphus 统一工作流体系                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Sisyphus 主流程 (sisyphus.ts 定义)                                        │
│   ════════════════════════════════════                                      │
│                                                                             │
│   Phase 0: 意图识别                                                          │
│       ↓                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Skill Discipline (EMBEDDED)                                        │   │
│   │  ══════════════════════════════                                     │   │
│   │                                                                     │   │
│   │  "If you think there is even a 1% chance a skill might apply,      │   │
│   │   you ABSOLUTELY MUST invoke the skill."                            │   │
│   │                                                                     │   │
│   │  Skill Priority Order:                                              │   │
│   │  1. Process skills: brainstorming, debugging, creating-changes      │   │
│   │  2. Implementation skills: tdd, frontend-ui-ux, subagent-driven     │   │
│   │                                                                     │   │
│   │  "Let's build X" → brainstorming → creating-changes → impl skills   │   │
│   │  "Fix this bug"  → debugging → domain-specific skills               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│       ↓                                                                     │
│   Phase 1: 探索 & 研究 (并行 Agents)                                         │
│       ↓                                                                     │
│   Phase 2A: Plan Review Gate (BLOCKING)                                     │
│       "After creating-changes produces design.md + tasks.md,                │
│        wait for explicit confirmation before Phase 2B"                      │
│       ↓                                                                     │
│   Phase 2B: 实现 (TDD + Delegation)                                         │
│       ↓                                                                     │
│   Phase 3: 完成 & 归档                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键点**: 
- Skills 通过 `skill()` 工具在**运行时动态加载**
- Sisyphus 的 system prompt **强制要求**检查并调用相关 skills
- Brainstorming/creating-changes 是 Sisyphus 流程中的**必经检查点**，不是独立流程

---

## 统一工作流 (Sisyphus 主流程)

Sisyphus 主流程根据任务类型自动选择分支：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Sisyphus 统一工作流                                  │
└──────────────────────────────────────────────────────────────────────────┘

                              用户请求
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   Phase 0: 意图识别       │
                    │   检查 Skill 匹配 (强制)  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ "build/create"  │ │  "fix bug"      │ │ 明确实现请求     │
    │  新功能请求      │ │  修复问题       │ │ (ultrawork)     │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             ▼                   ▼                   ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ skill:          │ │ skill:          │ │ 直接进入        │
    │ brainstorming   │ │ systematic-     │ │ Phase 1         │
    │       ↓         │ │ debugging       │ │                 │
    │ skill:          │ │       ↓         │ │                 │
    │ creating-changes│ │ skill: tdd      │ │                 │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             └───────────────────┴───────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  Phase 1: 探索 & 研究     │
                    │  (并行 Explore/Librarian) │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  Phase 2A: Plan Review   │
                    │  Gate (BLOCKING)         │
                    │                          │
                    │  等待用户确认 design.md   │
                    │  + tasks.md              │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  Phase 2B: 实现          │
                    │  ├── skill: tdd          │
                    │  ├── skill: worktrees    │
                    │  └── skill: subagent-    │
                    │       driven-development │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  Phase 2C: 失败恢复      │
                    │  (如需要)                │
                    └────────────┬─────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │  Phase 3: 完成           │
                    │  ├── skill: verification │
                    │  ├── skill: finishing-   │
                    │  │    branch             │
                    │  └── skill: archiving    │
                    └──────────────────────────┘
```

---

## Skill 触发机制

### Sisyphus 的 Skill Discipline (强制规则)

来自 `sisyphus.ts`:

```
<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, 
you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. This is not optional.
</EXTREMELY-IMPORTANT>
```

### Skill 优先级顺序

| 优先级 | 类型 | Skills | 说明 |
|--------|------|--------|------|
| **1** | Process Skills | brainstorming, debugging, creating-changes | 决定 HOW to approach |
| **2** | Implementation Skills | tdd, frontend-ui-ux, subagent-driven | 指导执行 |

### 任务类型 → Skill 映射

| 任务类型 | Skill 链 |
|----------|----------|
| "Let's build X" | brainstorming → creating-changes → implementation skills |
| "Fix this bug" | debugging → domain-specific skills |
| 明确实现 (ulw) | 直接 TDD + 实现 |

---

## 流程分支详解

### 分支 A: Brainstorming 路径 (新功能)

```
用户: "build a new authentication system"
                    │
                    ▼
         ┌─────────────────────┐
         │ skill: brainstorming│  ← Phase 1-4 内部
         │                     │
         │ • 理解想法           │
         │ • 探索 2-3 方案      │
         │ • 展示设计           │
         │ • 创建 proposal.md  │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │skill:creating-changes│
         │                     │
         │ • 审阅 proposal     │
         │ • 写 design.md      │
         │ • 写 tasks.md       │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Plan Review Gate    │  ← Phase 2A
         │ (等待用户确认)       │
         └──────────┬──────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Phase 2B: 实现      │
         │ (TDD + Subagents)   │
         └─────────────────────┘
```

### 分支 B: 直接执行路径 (ULTRAWORK)

     用户请求 + "ultrawork" / "ulw"
              │
              ▼
    ┌─────────────────┐
    │  Phase 0: 意图  │◄──────────────────────────────────────┐
    │     识别        │                                       │
    └────────┬────────┘                                       │
             │                                                │
             ▼                                                │
    ┌─────────────────┐     并行启动                          │
    │  Phase 1: 探索  │────────────────┐                      │
    │                 │                │                      │
    └────────┬────────┘                ▼                      │
             │              ┌─────────────────────┐           │
             │              │  Explore Agent (bg) │           │
             │              │  Librarian Agent(bg)│           │
             │              │  Codex 需求分析      │           │
             │              └─────────────────────┘           │
             ▼                                                │
    ┌─────────────────┐                                       │
    │  Phase 2: TODO  │  创建详细任务列表                      │
    │     创建        │                                       │
    └────────┬────────┘                                       │
             │                                                │
             ▼                                                │
    ┌─────────────────┐                                       │
    │  Phase 3: TDD   │◄─────────────────────────────────┐    │
    │                 │                                  │    │
    │  ┌───────────┐  │     ┌───────────┐    ┌────────┐ │    │
    │  │  1. RED   │──┼────►│ 2. GREEN  │───►│3.REFAC │ │    │
    │  │ 写失败测试 │  │     │ 最小实现   │    │  优化  │ │    │
    │  └───────────┘  │     └───────────┘    └────────┘ │    │
    │                 │                          │      │    │
    └────────┬────────┘                          │      │    │
             │◄──────────────────────────────────┘      │    │
             │  (每个 TODO 重复)                         │    │
             ▼                                          │    │
    ┌─────────────────┐                                 │    │
    │  Phase 4: 诊断  │  LSP / TypeCheck / Lint         │    │
    │     验证        │                                 │    │
    └────────┬────────┘                                 │    │
             │                                          │    │
             │  失败? ──────────────────────────────────┘    │
             │                                               │
             ▼                                               │
    ┌─────────────────┐                                      │
    │  Phase 5: 测试  │  运行完整测试套件                     │
    │     套件        │                                      │
    └────────┬────────┘                                      │
             │                                               │
             │  失败? ────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │  Phase 6: Code  │  Codex Review (可选)
    │     Review      │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  Phase 7: 完成  │  清理后台任务, 报告结果
    │                 │
    └─────────────────┘
```

### 关键特性

| 特性 | 描述 |
|------|------|
| **并行 Agent** | Explore + Librarian 后台并行执行 |
| **TDD 强制** | RED → GREEN → REFACTOR 循环 |
| **TODO 驱动** | 实时跟踪每个步骤状态 |
| **Codex 协作** | 需求分析 + 代码审查 |
| **诊断验证** | LSP/TypeCheck 确保代码质量 |

### 触发方式

```
用户: "ulw 添加一个函数来处理日期格式化"
用户: "ultrawork 修复这个 bug"
用户: "帮我实现这个功能 ulw"
```

---

## Brainstorming 流程 (嵌入 Sisyphus 主流程)

**重要**: 这不是独立流程，而是 Sisyphus 在检测到 "build/create/add/implement" 类请求时**自动触发**的 Skill 链。

### 完整流程图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       BRAINSTORMING 完整流程                              │
└──────────────────────────────────────────────────────────────────────────┘

     用户请求: "build", "create", "add", "implement" 新功能
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: brainstorming                                                   │
│  ═══════════════════                                                    │
│                                                                         │
│  Phase 1: 理解想法                                                       │
│  ├── 检查项目状态 (files, docs, commits)                                 │
│  ├── 逐个提问 (prefer 多选)                                              │
│  └── 聚焦: 目的, 约束, 成功标准                                           │
│                                                                         │
│  Phase 2: 探索方案                                                       │
│  ├── 提出 2-3 种方案                                                     │
│  ├── 分析权衡                                                            │
│  └── 给出推荐 + 理由                                                     │
│                                                                         │
│  Phase 3: 展示设计                                                       │
│  ├── 分段展示 (200-300 words/段)                                         │
│  ├── 每段确认                                                            │
│  └── 覆盖: 架构, 组件, 数据流, 错误处理, 测试                              │
│                                                                         │
│  Phase 4: 创建变更目录                                                   │
│  ├── 确定名称: kebab-case, 动词前缀 (add-, fix-, update-)                 │
│  ├── 创建: changes/<name>/                                              │
│  ├── 写入: proposal.md                                                  │
│  └── 更新: .superpowers/status.json                                          │
│                                                                         │
│  产出: changes/<name>/proposal.md                                       │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: creating-changes                                                │
│  ══════════════════════                                                 │
│                                                                         │
│  Step 1: 审阅 proposal.md                                               │
│  Step 2: 编写 design.md (技术设计)                                       │
│  Step 3: 编写 tasks.md (任务分解)                                        │
│  Step 4: 更新 .superpowers/status.json → phase: "ready"                      │
│                                                                         │
│  产出:                                                                   │
│  ├── changes/<name>/design.md                                           │
│  └── changes/<name>/tasks.md                                            │
│                                                                         │
│  询问用户选择执行方式:                                                    │
│  ├── 1. Subagent-Driven (推荐)                                          │
│  ├── 2. Sequential (当前会话)                                            │
│  └── 3. Create Worktree First (隔离)                                    │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ├── 选择 3 ──────────────────────────────────────┐
              │                                                │
              ▼                                                ▼
┌─────────────────────────────────────┐    ┌─────────────────────────────┐
│  SKILL: using-git-worktrees         │    │  创建隔离 Worktree          │
│  ══════════════════════════         │    │                             │
│                                     │    │  git worktree add           │
│  • 创建独立工作区                    │    │  feature/<name>-wave{N}     │
│  • 安全验证                         │    │                             │
│  • 智能目录选择                      │    └──────────────┬──────────────┘
└─────────────────────────────────────┘                   │
              │                                            │
              ▼◄───────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: subagent-driven-development                                     │
│  ══════════════════════════════════                                     │
│                                                                         │
│  ┌─────────────────── Per Task Loop ───────────────────────┐            │
│  │                                                         │            │
│  │   1. Dispatch Implementer Subagent                      │            │
│  │      ├── 提问? → 回答问题                                │            │
│  │      └── 实现 + 测试 + 提交 + 自审                       │            │
│  │                                                         │            │
│  │   2. Spec Reviewer (规范检查)                            │            │
│  │      ├── ✅ 符合 → 继续                                  │            │
│  │      └── ❌ 不符 → Implementer 修复 → 重新审查            │            │
│  │                                                         │            │
│  │   3. Quality Reviewer (质量检查)                         │            │
│  │      ├── ✅ 通过 → 标记完成                              │            │
│  │      └── ❌ 问题 → Implementer 修复 → 重新审查            │            │
│  │                                                         │            │
│  └─────────────────────────────────────────────────────────┘            │
│                                                                         │
│  所有任务完成后 → Final Code Reviewer                                    │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: verification-before-completion                                  │
│  ════════════════════════════════════                                   │
│                                                                         │
│  验收清单:                                                               │
│  ├── [ ] Acceptance criteria 满足                                       │
│  ├── [ ] 所有测试通过 (无跳过)                                           │
│  ├── [ ] Linters 清洁                                                   │
│  ├── [ ] 无调试日志残留                                                  │
│  ├── [ ] TODOs 已处理                                                   │
│  ├── [ ] 文档已更新                                                     │
│  ├── [ ] Commit messages 规范                                           │
│  └── [ ] 代码已审查                                                     │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: finishing-a-development-branch                                  │
│  ════════════════════════════════════                                   │
│                                                                         │
│  Step 1: 验证测试通过                                                    │
│  Step 2: 确定基础分支                                                    │
│  Step 3: 展示选项:                                                       │
│          1. Merge locally - 合并到 <base>                               │
│          2. Create PR - 推送并创建 PR                                    │
│          3. Keep as-is - 保留分支                                        │
│          4. Discard - 删除所有变更                                       │
│  Step 4: 执行选择                                                        │
│  Step 5: 清理 Worktree (如需)                                            │
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  SKILL: archiving-changes                                               │
│  ═══════════════════════                                                │
│                                                                         │
│  Step 1: 确认所有任务完成                                                │
│  Step 2: 运行 /archive {change-name}                                    │
│  Step 3: 验证归档:                                                       │
│          ├── changes/archive/YYYY-MM-DD-{name}/ 存在                    │
│          ├── metadata.json 包含 commit SHAs                             │
│          └── Worktree 已清理                                            │
│                                                                         │
│  产出: changes/archive/YYYY-MM-DD-{name}/                               │
│        ├── proposal.md                                                  │
│        ├── design.md                                                    │
│        ├── tasks.md                                                     │
│        └── metadata.json                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skill 依赖关系图

```
                              ┌──────────────────┐
                              │   brainstorming  │
                              │                  │
                              │ 产出: proposal.md│
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ creating-changes │
                              │                  │
                              │ 产出: design.md  │
                              │       tasks.md   │
                              └────────┬─────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌────────────────┐  ┌────────────┐  ┌──────────────────┐
           │using-git-      │  │(Sequential)│  │subagent-driven-  │
           │worktrees       │  │            │  │development       │
           └───────┬────────┘  └─────┬──────┘  └────────┬─────────┘
                   │                 │                  │
                   └─────────────────┼──────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
           ┌────────────────────┐           ┌────────────────┐
           │       tdd          │           │systematic-     │
           │                    │           │debugging       │
           │ RED→GREEN→REFACTOR │           │ (遇到 bug 时)  │
           └────────────────────┘           └────────────────┘
                    │
                    ▼
           ┌────────────────────┐
           │ verification-      │
           │ before-completion  │
           └─────────┬──────────┘
                     │
                     ▼
           ┌────────────────────┐
           │ finishing-a-       │
           │ development-branch │
           └─────────┬──────────┘
                     │
                     ▼
           ┌────────────────────┐
           │ archiving-changes  │
           └────────────────────┘
```

---

## Skill 触发条件一览

| Skill | 触发条件 | 手动命令 |
|-------|----------|----------|
| **brainstorming** | "build", "create", "add", "implement" + 新功能 | `/brainstorming` |
| **creating-changes** | brainstorming 完成后, proposal.md 存在 | `/creating-changes` |
| **using-git-worktrees** | 需要隔离工作区, 开始实现前 | `/using-git-worktrees` |
| **subagent-driven-development** | 有 tasks.md, 任务相互独立 | - |
| **tdd** | 实现功能, 修复 bug, TDD Guard 阻止编辑 | `/tdd` |
| **test-driven-development** | 实现任何功能或 bugfix 前 | `/test-driven-development` |
| **systematic-debugging** | 遇到 bug, 测试失败, 意外行为 | `/systematic-debugging` |
| **verification-before-completion** | 标记任务完成前, 归档前 | `/verification-before-completion` |
| **finishing-a-development-branch** | 实现完成, 测试通过, 需要集成 | `/finishing-a-development-branch` |
| **archiving-changes** | 分支已合并/PR 已创建 | `/archive {name}` |
| **requesting-code-review** | 完成任务, 实现主要功能, 合并前 | `/requesting-code-review` |
| **receiving-code-review** | 收到代码审查反馈 | `/receiving-code-review` |
| **dispatching-parallel-agents** | 2+ 独立任务, 无共享状态 | `/dispatching-parallel-agents` |
| **playwright** | 浏览器相关任务 | `/playwright` |
| **git-master** | Git 操作 (commit, rebase, squash, blame) | `/git-master` |
| **frontend-ui-ux** | 前端 UI/UX 设计和实现 | `/frontend-ui-ux` |
| **codex-mcp-collaboration** | 需要 Codex 协作的三阶段检查点 | `/codex-mcp-collaboration` |

---

## 流程选择指南

```
                          用户请求
                              │
                              ▼
                    ┌─────────────────┐
                    │  是新功能/设计?  │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ YES                         │ NO
              ▼                             ▼
    ┌─────────────────┐           ┌─────────────────┐
    │ 需要探索需求?    │           │  是 Bug 修复?   │
    └────────┬────────┘           └────────┬────────┘
             │                             │
     ┌───────┴───────┐             ┌───────┴───────┐
     │ YES           │ NO          │ YES           │ NO
     ▼               ▼             ▼               ▼
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│Brainstorm│   │ULTRAWORK │   │  TDD +   │   │ULTRAWORK │
│  流程    │   │  直接执行 │   │Debugging │   │  直接执行│
└──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### 快速参考

| 场景 | 推荐流程 | 原因 |
|------|----------|------|
| 添加全新功能模块 | Brainstorming | 需要设计探索 |
| 修改现有功能行为 | Brainstorming | 需要理解影响范围 |
| 简单 Bug 修复 | ULTRAWORK + TDD | 直接明确 |
| 添加简单工具函数 | ULTRAWORK + TDD | 范围清晰 |
| 重构现有代码 | Brainstorming | 需要设计决策 |
| 紧急热修复 | ULTRAWORK | 时间紧迫 |
| 探索性原型 | Brainstorming | 需求不明确 |

---

## 附录: Skill 内联引用

**Skills 是内联引用的吗?**

是的。Skills 通过 `skill` 工具动态加载，而非预编译。每个 Skill 是一个独立的 SKILL.md 文件，包含：

1. **Frontmatter**: 名称、描述、MCP 配置
2. **正文**: 详细的流程指导

```yaml
---
name: skill-name
description: "触发描述"
mcp:
  server-name:
    command: npx
    args: [...]
---

# Skill 内容
...
```

**调用方式:**

```typescript
// 通过 skill 工具加载
skill("brainstorming")

// 通过斜杠命令
/brainstorming

// 自动触发 (Keyword Detector Hook)
"build a new feature"  // → 自动检测并建议使用 brainstorming
```

**Skills 之间的引用:**

Skills 通过文档中的 "Next Step" 或 "REQUIRED SUB-SKILL" 建议下一个 skill。Sisyphus 的 Skill Discipline **强制要求** Agent 检查并调用相关 skills，形成自动化的流程链。

---

## 总结：Brainstorming 与现有流程的关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         关键理解                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ❌ 错误理解: Brainstorming 是独立于 ULTRAWORK 的另一套流程                   │
│                                                                             │
│  ✅ 正确理解: Brainstorming 是 Sisyphus 主流程的一个分支                      │
│              根据任务类型自动触发的 Skill 链                                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           Sisyphus 主流程                                    │
│                                 │                                           │
│              ┌──────────────────┼──────────────────┐                        │
│              │                  │                  │                        │
│              ▼                  ▼                  ▼                        │
│     ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│     │ 新功能请求   │    │  Bug 修复   │    │ 明确实现    │                   │
│     │             │    │             │    │ (ulw)      │                   │
│     └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                   │
│            │                  │                  │                          │
│            ▼                  ▼                  ▼                          │
│     Skill 链:           Skill 链:          直接执行:                        │
│     brainstorming       debugging          Phase 1-3                        │
│     → creating-changes  → tdd              (探索→实现→完成)                  │
│     → subagent/tdd      → verification                                      │
│     → verification                                                          │
│     → finishing                                                             │
│     → archiving                                                             │
│                                                                             │
│  所有分支最终汇入相同的: 实现 → 验证 → 完成 流程                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**核心机制:**

1. **Skill Discipline (强制)**: Sisyphus 被编程为"哪怕 1% 可能适用，也必须调用 skill"
2. **Skill Priority**: Process skills (brainstorming, debugging) 优先于 Implementation skills (tdd)
3. **动态加载**: Skills 通过 `skill()` 工具在运行时加载，不是预编译
4. **Plan Review Gate**: `creating-changes` 产出后，**必须等待用户确认**才能继续实现

---

*文档生成时间: 2026-01-12*
*项目: oh-my-opencode*
