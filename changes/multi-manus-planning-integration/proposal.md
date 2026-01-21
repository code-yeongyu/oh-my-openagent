# Proposal: Manus Planning Integration (Revised)

## Why This Change

将 [planning-with-files](https://github.com/OthmanAdi/planning-with-files) v2.5.0 的 Manus 原则**深度融合**到 oh-my-opencode 的现有 Sisyphus 工作流中。

### 问题陈述

1. **Todo 丢失** - OpenCode 的 TodoWrite 在 context compact 或 /clear 后丢失
2. **目标遗忘** - 长上下文中 AI 忘记原始目标（50+ 工具调用后）
3. **Checkbox 不更新** - AI 完成任务但忘记勾选 tasks.md
4. **前 30 行截断** - 如果完成的任务在前面，关键信息被挤出视野
5. **缺少 Manus 最佳实践** - 2-Action Rule、3-Strike Protocol 未集成

### 现有功能已覆盖 (无需新增)

| 需求 | 现有功能 | 位置 |
|------|----------|------|
| 多项目管理 | `findPrometheusPlans()` + `/start-work` | boulder-state/storage.ts |
| 项目切换 | `/start-work [name]` | hooks/start-work/ |
| 工作区隔离 | `using-git-worktrees` skill | builtin-skills/ |
| Git 操作 | `git-master` skill | builtin-skills/ |
| 计划执行 | `executing-plans`, `wave-parallel-execution` | builtin-skills/ |

### 解决方案

**核心策略：增强现有钩子，而非新建独立系统**

| 问题 | 解决方案 | 实现方式 |
|------|----------|----------|
| Todo 丢失 | File → OpenCode 同步 | tasks.md 是真相来源，同步到 OpenCode todos |
| 目标遗忘 | PostToolUse 提醒 | 代码变更后提醒更新 tasks.md |
| Checkbox 不更新 | 强制提醒 + 拒绝停止 | 检测代码变更但无 checkbox 更新 |
| 前 30 行截断 | 完成任务移到底部 | 自动将完成的 Phase 移到 `## Completed Phases` |
| 缺少最佳实践 | 增强执行技能 | 在 executing-plans 中注入 Manus 原则 |

## What Will Be Modified

### 新建模块

| 模块 | 说明 |
|------|------|
| `src/features/plan-todo-sync/` | File → OpenCode todo 同步 |
| `src/features/plan-reorganizer/` | 完成任务移到底部 |
| `src/hooks/plan-update-reminder/` | PostToolUse 提醒更新 tasks.md |
| `src/features/builtin-skills/manus-principles/` | Manus 6 大原则参考文档 |

### 修改文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/features/boulder-state/types.ts` | 增强 | 添加 PhaseInfo 类型 |
| `src/features/boulder-state/storage.ts` | 增强 | 增强 `getPlanProgress()` 支持阶段解析 |
| `src/hooks/todo-continuation-enforcer.ts` | 增强 | 集成 File→Todo 同步 + 强制提醒 |
| `src/features/builtin-skills/executing-plans/SKILL.md` | 增强 | 注入 Manus 原则 |
| `src/features/builtin-skills/wave-parallel-execution/SKILL.md` | 增强 | 注入 Manus 原则 |
| `src/index.ts` | 增强 | 注册新钩子 |
| `src/config/schema.ts` | 增强 | 添加钩子名称 |

## Core Design Decisions (User Confirmed)

| 决策点 | 选择 | 原因 |
|--------|------|------|
| **Plan Activation** | 需要 boulder.json 存在 | 避免在无计划时误触发 |
| **Todo Source** | File → OpenCode sync | tasks.md 持久化，解决 todo 丢失 |
| **Completion Detection** | checkboxes + phases + boulder.phase | 综合判断，避免误判 |
| **Checkbox Enforcement** | 强制提醒 + 拒绝停止 | 两者结合，确保更新 |
| **Auto-Checkbox** | 不自动勾选 | AI 必须手动确认完成 |
| **Completed Tasks** | 移到文档底部 | 保持前部只有未完成任务 |
| **Skill Strategy** | 复制并修改 | 不嵌套 skills |

## Success Criteria

### 功能验证

- [ ] `getPlanProgress()` 正确解析阶段语法 (`## Phase N: Name \`status\``)
- [ ] File → OpenCode todo 同步工作正常
- [ ] 代码变更但无 checkbox 更新时，触发强制提醒
- [ ] 连续 3 次未更新时，拒绝自动继续
- [ ] 完成的 Phase 自动移到文档底部
- [ ] PostToolUse 提醒正确触发
- [ ] `/manus-principles` 技能可加载

### 技术验证

- [ ] `bun run typecheck` 通过
- [ ] `bun test` 通过（现有测试不被破坏）
- [ ] 新功能有对应的测试覆盖
- [ ] `bun run build` 成功

### 兼容性

- [ ] 现有工作流不受影响
- [ ] 需要 boulder.json 才激活（/start-work 后）
- [ ] 可通过 `disabled_hooks` 禁用新功能

## Risk Assessment

| 风险 | 级别 | 缓解措施 |
|------|------|----------|
| todo-continuation-enforcer 复杂度增加 | 中 | 模块化设计，独立测试 |
| 文档重组可能破坏格式 | 中 | 完整的 TDD 测试 |
| 强制提醒可能过于频繁 | 低 | 可配置禁用 |

## Risk Tier

**Tier-2**: 增强现有核心功能，需要测试验证但风险可控。

## Timeline Estimate

| 阶段 | 预估时间 |
|------|----------|
| Phase 1: P0 修复 | ✅ 完成 |
| Phase 2: PlanProgress 增强 | 30 分钟 |
| Phase 3: File→Todo 同步 | 45 分钟 |
| Phase 4: todo-continuation 增强 | 45 分钟 |
| Phase 5: 完成任务移到底部 | 45 分钟 |
| Phase 6: 状态更新提醒 | 20 分钟 |
| Phase 7: 执行技能增强 | 20 分钟 |
| Phase 8: Manus 参考文档 | 15 分钟 |
| Phase 9: 验证收尾 | 20 分钟 |
| **总计** | **~4 小时** |

## References

### planning-with-files 源文件

- `C:\github\planning-with-files\README.md` - v2.5.0 文档
- `C:\github\planning-with-files\skills\planning-with-files\SKILL.md` - 技能定义
- `C:\github\planning-with-files\skills\planning-with-files\reference.md` - Manus 6 原则

### oh-my-opencode 核心文件

- `src/features/boulder-state/types.ts` - BoulderState 类型定义
- `src/features/boulder-state/storage.ts` - 状态存储 (308 行)
- `src/hooks/todo-continuation-enforcer.ts` - TODO 强制完成 (570 行)
