# 连接 Instinct 学习系统存储层

## Context

### Original Request
连接 oh-my-opencode 断开的 Instinct 学习管道：
- 现有 hooks 已实现检测逻辑，但存储路径未配置
- 需要让观察者、存储、提醒、演化几个 sub-agent 能够互相联动

### Key Insight
通过分析 everything-claude-code 原版实现，发现：
- **代码逻辑已存在**（observer-detector, instinct-learner, pattern-extraction）
- **只是存储路径断开**
- 只需配置存储位置，不需要修改代码

---

## Work Objectives

### Core Objective
创建共享存储层，让断开的 hooks 能够通过目录联动。

### Concrete Deliverables
1. `references/observations/` 目录 - 观察存储
2. `references/evolved/` 目录 - 演化产物
3. 更新的 `SKILL.md` - 提醒文档
4. 更新的 `config.json` - 存储路径配置

### Definition of Done
- [x] 目录结构创建完成
- [x] SKILL.md 更新为模式 B
- [x] config.json 路径更新
- [x] 验证：主 agent 能通过 skill 找到存储目录

---

## 联动机制

```
┌─────────────────────────────────────────────────────────────┐
│              continuous-learning/references/                 │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │  observations/  │───→│    evolved/     │                 │
│  │  (存储层)        │    │  (产出层)        │                 │
│  └─────────────────┘    └─────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
        ▲ 写入                    ▲ 生成
┌───────┴───────┐         ┌───────┴───────┐
│  观察者 Hooks   │         │  演化命令      │
│ observer-detector       │ /evolve        │
│ instinct-learner        │ skill-create   │
│ pattern-extraction      │               │
└───────────────┘         └───────────────┘
```

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Approach**: 手动验证（目录/文档变更）
- **Framework**: N/A

### 大型 Markdown 编辑规范
编辑 SKILL.md 时必须使用 progressive-disclosure-md：
```bash
# 索引
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs "SKILL.md"
# 选择章节
node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs h2.N "SKILL.md"
# 用 edit 逐节修改
```

---

## TODOs

- [x] 1. 使用 skill-studio 为 continuous-learning 添加 references 目录

  **What to do**:
  - 调用 skill-studio 的 skill-create-and-change
  - 为现有 `continuous-learning` skill 添加 `references/` 目录结构：
    ```
    references/
    ├── observations/
    │   └── index.md          # 观察索引
    └── evolved/
        ├── drafts/.gitkeep   # 草稿阶段（待审核）
        └── published/.gitkeep # 已发布
    ```
  - 在 SKILL.md 中添加目录结构说明

  **调用方式**:
  ```
  调用 skill-studio → skill-create-and-change
  说明：为 continuous-learning skill 添加 references 目录，
       包含 observations/ 和 evolved/drafts/ 子目录
  ```

  **Parallelizable**: NO

  **References**:
  - skill-studio 的 skill-create-and-change
  - `C:\github\everything-claude-code\skills\continuous-learning-v2\` - 原版结构参考

  **Acceptance Criteria**:
  - [x] references/ 目录结构存在
  - [x] observations/index.md 包含说明
  - [x] SKILL.md 包含目录结构说明

  **Commit**: YES
  - Message: `feat(continuous-learning): add references directory via skill-studio`
  - Files: `references/`, `SKILL.md`

---

- [x] 2. 更新 config.json 存储路径

  **What to do**:
  - 修改 `src/features/builtin-skills/continuous-learning/config.json`
  - 更新 `observation.store_path` 指向 `references/observations/`
  - 更新 `instincts.personal_path` 指向 `references/observations/`
  - 更新 `evolution.evolved_path` 指向 `references/evolved/`

  **Parallelizable**: YES (与 Task 3)

  **References**:
  - `C:\github\everything-claude-code\skills\continuous-learning-v2\config.json` - 原版配置

  **Acceptance Criteria**:
  - [x] 路径指向 references/ 子目录
  - [x] JSON 格式有效

  **Commit**: YES
  - Message: `feat(continuous-learning): update storage paths to references/`
  - Files: `config.json`

---

- [x] 3. 使用 skill-studio 更新 SKILL.md 添加存储位置说明

  **What to do**:
  - 调用 skill-studio 的 skill-create-and-change
  - 更新 `continuous-learning` 的 SKILL.md：
    - 添加存储目录结构说明
    - 添加联动机制说明
    - 添加 agent 行为指南（何时写入 observations/）
    - 添加两阶段产出说明（drafts/ → published/）

  **调用方式**:
  ```
  调用 skill-studio → skill-create-and-change
  说明：更新 continuous-learning 的 SKILL.md，
       添加存储位置、联动机制、agent 行为指南
  ```

  **Must NOT do**:
  - 不删除有用的背景信息
  - 不改变原有设计理念

  **Parallelizable**: NO (依赖 Task 1 目录结构)

  **References**:
  - skill-studio 的 skill-create-and-change
  - `design.md` - 联动机制设计

  **Acceptance Criteria**:
  - [x] SKILL.md 包含目录结构说明
  - [x] SKILL.md 包含联动机制说明
  - [x] SKILL.md 包含 agent 行为指南

  **Commit**: YES
  - Message: `docs(continuous-learning): add storage location and linkage docs via skill-studio`
  - Files: `SKILL.md`

---

- [x] 4. 创建 observation-write-guard hook

  **What to do**:
  - 参考 `src/hooks/notepad-write-guard/` 的实现模式
  - 创建 `src/hooks/observation-write-guard/` 目录
  - 实现 PreToolUse hook，拦截对 `references/observations/` 的 Write 操作
  - 允许首次创建（文件不存在）
  - 阻止覆盖已存在的观察文件
  - 返回提示：使用 Edit 追加而非 Write 覆盖

  **Must NOT do**:
  - 不阻止 Edit 工具（追加是允许的）
  - 不阻止首次创建

  **Parallelizable**: YES

  **References**:
  - `src/hooks/notepad-write-guard/index.ts` - 实现模式参考
  - `src/hooks/notepad-write-guard/constants.ts` - 常量定义参考

  **Acceptance Criteria**:
  - [x] **RED**: 创建 `src/hooks/observation-write-guard/index.test.ts`
    - 测试: 首次创建允许
    - 测试: 覆盖已存在文件阻止
    - `bun test src/hooks/observation-write-guard/` → FAIL
  - [x] **GREEN**: 实现 hook
    - `bun test src/hooks/observation-write-guard/` → PASS
  - [x] 在 `src/index.ts` 注册 hook
  - [x] `bun run typecheck` → 无错误

  **Commit**: YES
  - Message: `feat(hooks): add observation-write-guard to protect observation files`
  - Files: `src/hooks/observation-write-guard/`

---

- [x] 5. 删除冗余的 hooks/observe.sh

  **Why**:
  - TypeScript 版本 `observation-recorder` 已完整实现相同功能
  - observe.sh 是 Claude Code 的 Shell hook，不会被 OpenCode 触发
  - 保留会造成混淆

  **What to do**:
  - 删除 `src/features/builtin-skills/continuous-learning/hooks/observe.sh`
  - 如果 hooks/ 目录为空，也删除目录

  **Parallelizable**: YES

  **Acceptance Criteria**:
  - [x] observe.sh 已删除
  - [x] 无遗留引用

  **Commit**: YES
  - Message: `chore(continuous-learning): remove redundant observe.sh (replaced by observation-recorder hook)`
  - Files: `hooks/observe.sh`

  **Acceptance Criteria**:
  - [x] observe.sh 已删除或标记废弃
  - [x] 无遗留引用

  **Commit**: YES
  - Message: `chore(continuous-learning): remove deprecated observe.sh`
  - Files: `hooks/observe.sh`

---

- [x] 6. 验证联动

  **What to do**:
  - 手动验证目录结构正确
  - 验证 SKILL.md 能被主 agent 读取
  - 验证 config.json 路径正确

  **Acceptance Criteria**:
  - [x] 目录存在且可写
  - [x] SKILL.md 可读
  - [x] config.json 格式正确

  **Commit**: NO (验证阶段)

---

- [x] 7. 使用 skill-studio 创建 evolve skill

  **What to do**:
  - 调用 skill-studio 的 skill-create-and-change
  - 创建 `evolve` skill，支持自然语言触发演化
  - Skill 功能：
    1. 读取 `references/observations/` 中的观察记录
    2. 分析高置信度模式（confidence >= 0.7）
    3. 聚类相关模式
    4. 生成 Skill 草稿到 `references/evolved/drafts/`
    5. 询问用户是否发布到 `builtin-skills/` 或 `~/.claude/skills/`

  **Natural Language Triggers**:
  - "演化"、"evolve"
  - "把观察变成技能"
  - "从模式生成 skill"
  - "帮我演化最近的观察"

  **Two-Stage Output**:
  ```
  Stage 1 (Draft):
    references/evolved/drafts/{skill-name}.md  →  待审核
  
  Stage 2 (Publish):
    用户确认后 → builtin-skills/ 或 ~/.claude/skills/
  ```

  **Parallelizable**: NO (依赖前置任务完成)

  **References**:
  - skill-studio 的 skill-create-and-change
  - `C:\github\everything-claude-code\skills\continuous-learning-v2\` - 原版演化逻辑

  **Acceptance Criteria**:
  - [x] evolve skill 创建成功
  - [x] 自然语言触发有效
  - [x] 两阶段产出路径正确
  - [x] 用户确认流程存在

  **Commit**: YES
  - Message: `feat(skills): add evolve skill for observation-to-skill transformation`
  - Files: `src/features/builtin-skills/evolve/` 或 `~/.claude/skills/evolve/`

---

## Commit Strategy

| After Task | Message | Files |
|------------|---------|-------|
| 1 | `feat(continuous-learning): add references directory structure` | references/ |
| 2 | `feat(continuous-learning): update storage paths to references/` | config.json |
| 3 | `docs(continuous-learning): update to Mode B architecture` | SKILL.md |
| 4 | `chore(continuous-learning): remove deprecated observe.sh` | hooks/ |

---

## Success Criteria

### Final Checklist
- [x] 目录结构: `references/observations/` 和 `references/evolved/` 存在
- [x] 配置更新: config.json 路径正确
- [x] 文档更新: SKILL.md 描述模式 B
- [x] 联动验证: 观察者 → 存储 → 演化 路径通畅
