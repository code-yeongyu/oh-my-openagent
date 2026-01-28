# Findings: implement-missing-features

> This file tracks research discoveries, decisions, and issues during planning and execution.
> **2-Action Rule**: After every 2 browser/view operations, save findings here.

## Requirements

[Captured from MISSING-FEATURES.md analysis]

- Requirement 1: 实现持续学习 v2 系统（模式提取、知识沉淀）
- Requirement 2: 实现本能模型（高频操作模式存储和触发）
- Requirement 3: 实现 Observer 观察者代理（后台行为审计）
- Requirement 4: 实现 6 个新命令（/evolve, /learn, /instinct-*, /build-fix）
- Requirement 5: 实现 2 个新钩子（OnTaskComplete, PatternExtraction）
- Requirement 6: 实现 5 个领域技能
- Requirement 7: 集成 2 个 MCP 服务（Memory, Sequential Thinking）

## Research Findings

### 现有系统分析

- Finding: findings.md 和 progress.md 已在 Atlas, Sisyphus-Junior, plan-update-reminder 等组件中完整集成
- Source: grep 搜索 `src/hooks/` 和 `src/agents/`
- Implications: 不需要重新实现这两个文件的模板，Observer 应该复用现有机制

### BackgroundManager 机制

- Finding: 现有 `BackgroundManager` 支持完整的后台任务生命周期（launch → poll → complete）
- Source: `src/features/background-agent/manager.ts` (1377 lines)
- Implications: Observer L2 分析可以使用 `delegate_task(run_in_background=true)` 实现

### 存储架构决策

- Finding: 短期存储（findings/progress）跟随 changes 目录，长期存储应独立
- Source: 用户反馈和架构讨论
- Implications: 设计三层存储架构（短期 → 本能 → 技能），每层都有追溯信息

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| 本能存储格式 | JSONC | 支持注释，用户可编辑 | JSON (无注释), YAML (解析复杂) |
| Observer 运行模式 | 混合（L1/L2/L3） | 平衡资源消耗和实时性 | 纯后台 (资源消耗高), 仅总结 (非实时) |
| Observer 发现存储 | 写入现有 findings.md | 统一视图，与现有系统集成 | 独立文件 (数据分散) |
| 追溯机制 | source 字段 + Origin 章节 | 保持知识来源可查 | 无追溯 (丢失历史) |

## Issues Encountered

| Issue | Status | Resolution |
|-------|--------|------------|
| 暂无 | - | - |

## Resources

- [MISSING-FEATURES.md](../../docs/upgrade-analysis/MISSING-FEATURES.md): 完整缺失功能清单
- [ENHANCEMENT-LIST.md](../../docs/upgrade-analysis/ENHANCEMENT-LIST.md): 增强功能清单
- [BackgroundManager](../../src/features/background-agent/manager.ts): 后台任务管理器
- [creating-changes skill](../../src/features/builtin-skills/creating-changes/SKILL.md): 规划文档模板

## Visual/Browser Findings

> For UI work: Record what you see after browser operations.

暂无（本任务不涉及 UI）

---

*Update this file after every 2 view/browser/search operations*
*This prevents visual information from being lost*

## Hook Script: observe.sh
- Copied from everything-claude-code/skills/continuous-learning-v2/hooks/observe.sh
- Target: src/features/builtin-skills/continuous-learning/hooks/observe.sh
- Purpose: Captures tool use events (PreToolUse/PostToolUse) for pattern analysis.
- Dependencies: Requires python3 for reliable JSON parsing.
- Data Storage: Writes to ~/.claude/homunculus/observations.jsonl
- Signal: Sends SIGUSR1 to observer process if pid file exists.
## Findings - Continuous Learning Skill Migration
- Migrated continuous-learning-v2 skill from everything-claude-code.
- Adapted paths from ~/.claude/homunculus/ to ~/.claude/skills/ to match oh-my-opencode-update architecture.
- Target instincts path: ~/.claude/skills/instincts/
## Task 4.1: Pattern Extraction Hook - COMPLETED

### Files Created
- src/hooks/pattern-extraction/index.ts - Factory: createPatternExtractionHook()
- src/hooks/pattern-extraction/pattern-analyzer.ts - Core analysis logic
- src/hooks/pattern-extraction/index.test.ts - 8 tests (all passing)

### Implementation Details
- Listens to session.summarize events (compaction trigger)
- Extracts successful tool sequences from session history
- Detects repeated workflows (3+ occurrences)
- Confidence calculation: 0.5 + (count * 0.1), max 0.9
- Only emits patterns with confidence >= 0.7
- Includes source tracking (sessionId, taskName)
- Non-blocking callback pattern (fire-and-forget)
- Silent error handling (no throws)

### Test Fix Applied
- Changed invalid .resolves.not.toThrow() to proper assertion pattern
- All 8 tests now passing


## Task 7.2: database-optimization 技能创建
- 已创建 `src/features/builtin-skills/database-optimization/SKILL.md`
- 包含了索引分析、N+1 检测、查询分析等核心优化建议
- 符合 SKILL.md 的 YAML frontmatter 规范
