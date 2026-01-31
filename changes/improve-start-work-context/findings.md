# Findings: improve-start-work-context

> **2-Action Rule**: 每2次浏览器/搜索操作后更新此文件。

## Requirements

从用户对话中捕获的需求：

- creating-changes 创建的 5 个文件在执行阶段上下文不完整
- start-work 只读取 tasks.md，缺少 proposal 和 design 上下文
- 需要使用 progressive-disclosure-md skill 增量合并
- 合并 proposal + design 关键部分到 tasks.md
- 每个任务解析为独立 todo item
- boulder continuation 也需要同样的上下文注入

## Research Findings

### plan-update-reminder hook 分析

- **Finding**: 已存在 `plan-update-reminder` hook，实现 2-Action Rule
- **Source**: `src/hooks/plan-update-reminder/index.ts`
- **Implications**: 不需要新增 findings/progress 更新机制，只需确保 hook 正常触发

### progressive-disclosure-md skill 分析

- **Finding**: skill 支持增量合并，使用 mdsel 选择器精准提取
- **Source**: `~/.claude/skills/progressive-disclosure-md/SKILL.md`
- **Implications**: 可用于合并 proposal + design 关键部分

### 合并内容范围确定

- **Finding**: 合并约 430 字的关键内容
- **Source**: 用户确认
- **合并部分**:
  - proposal.md: Problem Statement (h2.0), Success Criteria (h2.2)
  - design.md: Goal (h2.0), Architecture (h2.1), Key Decisions (h2.4)

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| 合并工具 | progressive-disclosure-md | 精准选择器，token 高效 | 全文读取（浪费 token） |
| 合并时机 | start-work 时 | 一次性合并，后续复用 | 每次 session 都合并（重复工作） |
| Todo 格式 | 每个 Task 独立 item | 便于追踪和读取 | 全文作为一个 item（难以追踪） |
| 执行方式 | **提示 AI 执行** | 简单、能自然处理 checkbox 状态 | 代码自动执行（需额外逻辑防覆盖） |
| 注入方式 | **修改现有 todo-continuation-enforcer** | 简单、不增加 hook | 新建 hook（复杂、多一个组件） |
| 状态同步 | **AI 读取 checkbox 状态** | 自然理解 `[x]` 和 `[ ]` | 代码解析（需维护解析逻辑） |

## Issues Encountered

| Issue | Status | Resolution |
|-------|--------|------------|
| 无法直接测试 hook 触发 | Resolved | hook 是运行时行为，需在实际 OpenCode 中测试 |

## Resources

- `src/hooks/plan-update-reminder/index.ts` - 现有的计划更新提醒 hook
- `src/features/builtin-commands/templates/start-work.ts` - start-work 模板
- `~/.claude/skills/progressive-disclosure-md/SKILL.md` - 渐进式披露 skill

## Visual/Browser Findings

> 本次规划未使用浏览器操作。

---

*Update after every 2 view/browser/search operations*
