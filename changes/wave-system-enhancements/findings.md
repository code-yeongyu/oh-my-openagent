# Findings: wave-system-enhancements

<!-- 
  WHAT: Your knowledge base for the task. Stores everything you discover and decide.
  WHY: Context windows are limited. This file is your "external memory" - persistent and unlimited.
  WHEN: Update after ANY discovery, especially after 2 view/browser/search operations (2-Action Rule).
-->

> This file tracks research discoveries, decisions, and issues during planning and execution.
> **2-Action Rule**: After every 2 browser/view operations, save findings here.

## Requirements

[Captured from Decision #5 in upstream-sync/findings/decisions.md]

- Requirement 1: 更新 `creating-changes` skill 添加标准任务格式规范
- Requirement 2: 创建 `tasks-md-creation-guard` hook 拦截直接创建 tasks.md
- Requirement 3: 实现 Wave 自动激活 (tasks > 5 时自动加载 wave-parallel-execution)
- Requirement 4: 注册 hook 并验证集成

## Research Findings

### Wave System 现有能力

- Finding: `wave-grouper.ts` 已支持 `TaskFiles` 接口 (create/modify/test 数组)
- Source: 决策文档 Decision #5
- Implications: 只需要确保 tasks.md 格式能被正确解析

### 上游模块化状态验证

- Finding: Prometheus, Sisyphus-Junior, Atlas, Hephaestus 均已实现模块化
- Source: glob 搜索 `src/agents/` 目录
- Implications: Decision #11, #12, #21, #24 已完成，无需重复规划

### tasks-md-creation-guard 不存在

- Finding: `src/hooks/tasks-md-creation-guard/` 目录不存在
- Source: glob 搜索结果为空
- Implications: 需要从头创建此 hook

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| 元数据格式 | HTML 注释 `<!-- key: value -->` | 不影响渲染，易解析 | YAML frontmatter, JSON |
| 拦截范围 | 仅首次创建 | 允许正常更新迭代 | 所有写入都拦截 |
| 自动激活阈值 | > 5 任务 | 平衡简单性与并行收益 | > 3, > 10 |
| 覆盖机制 | "use sequential" 关键词 | 保留用户控制权 | 配置项，无覆盖 |

## Issues Encountered

| Issue | Status | Resolution |
|-------|--------|------------|
| 原 tasks.md 格式不符合 creating-changes skill 规范 | Resolved | 按标准模板重新创建 |
| Skill 加载返回空内容 | Noted | 直接读取 SKILL.md 文件 |

## Resources

- `src/features/builtin-skills/creating-changes/SKILL.md`: Skill 定义
- `src/features/builtin-skills/creating-changes/reference.md`: 模板参考
- `changes/upstream-sync/findings/decisions.md`: 决策记录

## Visual/Browser Findings

> 无 UI 工作，此部分暂不适用。

---

*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*

## [2026-02-04] Task 2.1 Findings

- Created `src/hooks/tasks-md-creation-guard/constants.ts` with required constants and literal strings.
- Pattern used: `changes/*/tasks.md`; intercepted tools list uses `as const`.
- LSP diagnostics could not run because `typescript-language-server` is not installed in this environment.

## [2026-02-04] Task Findings

- Added Prometheus-level task format section after the Task Example block in `src/features/builtin-skills/creating-changes/reference.md`.
- LSP diagnostics for `.md` failed because no markdown LSP server is configured.
- Added Zero Human Intervention principle to the Key Principles list in `src/features/builtin-skills/creating-changes/SKILL.md`.
- LSP diagnostics for `src/features/builtin-skills/creating-changes/SKILL.md` failed because no markdown LSP server is configured.

## [2026-02-04] Task Findings (Standard Task Format Section)

- Added the Standard Task Format section after Step 4 in `src/features/builtin-skills/creating-changes/SKILL.md`.
- LSP diagnostics for `src/features/builtin-skills/creating-changes/SKILL.md` failed because no markdown LSP server is configured.

## [2026-02-04] Task 2.2 Findings

- Implemented `src/hooks/tasks-md-creation-guard/index.ts` with pattern matching and skill tracking to block first-time tasks.md creation.
- Guard allows edits when tasks.md already exists or creating-changes skill was used in the session.
- LSP diagnostics for `src/hooks/tasks-md-creation-guard/index.ts` failed because `typescript-language-server` is not installed.

## [2026-02-04] Skill Metadata Investigation

- Found `src/tools/skill/tools.ts` returns a plain string; no metadata is emitted for hooks.
- Root cause for unblock failure: tasks-md-creation-guard checks `output.metadata.name`, but skill tool never sets metadata.
- Fix applied: emit `ctx.metadata` with `name`, `skillName`, and `dir` after skill load.
- LSP diagnostics failed: `typescript-language-server` not installed.
