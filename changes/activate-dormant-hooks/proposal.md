# Proposal: Activate Dormant Hooks

## Summary

激活项目中 9 个已开发完成但未生效的 hooks，恢复其设计功能。

## Problem

审查 `src/hooks/` 发现：

| 问题类型 | 数量 | 说明 |
|----------|------|------|
| **死代码** | 3 | 实例已创建，但未在生命周期中调用 |
| **未注册** | 6 | 代码完整，但未在 index.ts 导入使用 |

这些 hooks 包含关键功能：
- **TDD Guard**: 强制测试驱动开发
- **Failure Counter**: 失败升级机制（1次→注入skill，2次→派遣Oracle，3次→阻断）
- **Subagent Verification**: 委托任务完成后强制验证
- **Background Compaction**: 上下文压缩时保留后台任务状态

**这些功能从未执行，是重大遗漏。**

## Affected Hooks

### 死代码 (已创建未调用)

| Hook | 功能 | 遗漏位置 |
|------|------|----------|
| `skill-suggestion` | 检测关键词建议 skills | `chat.message` |
| `planning-flow-guide` | 监控 planning agents 调用顺序 | `tool.execute.after` (事件名也错了) |
| `tdd-guard` | TDD 强制执行 | 4 个生命周期全部遗漏 |

### 未注册 (代码完整未导入)

| Hook | 功能 | 优先级 |
|------|------|--------|
| `failure-counter` | 失败升级机制 | 🔴 高 |
| `subagent-verification` | 委托验证提醒 | 🔴 高 |
| `background-compaction` | 压缩时保留任务状态 | 🔴 高 |
| `codebase-assessment` | 首次评估代码库状态 | 🟡 中 |
| `debugging-injector` | 连续失败注入调试 skill | 🟢 低 |
| `lsp-diagnostics-enforcer` | 强制运行诊断 | 🟢 低 |
| `phase-flow-enforcer` | 监控 boulder 状态变更 | 🟢 低 |

## Proposed Solution

### Phase 1: 修复死代码
- 在对应生命周期中添加调用
- 修复 `planning-flow-guide` 事件名 (`PostToolUse` → `tool.execute.after`)

### Phase 2: 激活高优先级 hooks
- 导入并注册 3 个高优先级 hooks
- 默认启用

### Phase 3: 注册可选 hooks
- 导入并注册 4 个可选 hooks
- 默认禁用，可通过配置启用

### Phase 4: 配置与文档
- 更新 `HookNameSchema` 添加新 hook 名称
- 更新 `AGENTS.md` 同步文档

## Scope

### IN
- 激活 9 个 hooks
- 更新配置 schema
- 更新文档

### OUT
- 修改 hook 内部逻辑
- 添加新功能
- 性能优化

## Impact Assessment

| 方面 | 影响 |
|------|------|
| **代码质量** | ⬆️ TDD Guard 强制测试优先 |
| **可靠性** | ⬆️ Failure Counter 防止无限循环失败 |
| **可观察性** | ⬆️ Subagent Verification 确保验证 |
| **向后兼容** | ✅ 可选 hooks 默认禁用 |
| **性能** | ⚪ 无影响 (hooks 有 early return) |

## Risks

| 风险 | 概率 | 缓解 |
|------|------|------|
| TDD Guard 阻断正常开发 | 中 | 默认 `enabled: false` |
| Failure Counter 误判 | 低 | 5分钟窗口 + 成功重置 |
| 类型错误 | 低 | 每阶段运行 typecheck |

## Success Metrics

- [ ] 9 个 hooks 全部可通过配置控制
- [ ] `bun run typecheck` 通过
- [ ] `bun run build` 成功
- [ ] `bun test` 全部通过
- [ ] 文档与代码同步

## Estimated Effort

| Phase | 任务数 | 预估时间 |
|-------|--------|----------|
| Phase 0 | 1 | 5 min |
| Phase 1 | 3 | 15 min |
| Phase 2 | 3 | 15 min |
| Phase 3 | 4 | 20 min |
| Phase 4 | 3 | 15 min |
| **Total** | **14** | **~70 min** |

## Decision

- [ ] **Approved** - 继续创建 design.md 和 tasks.md
- [ ] **Rejected** - 说明原因
- [ ] **Needs Discussion** - 需要澄清的问题

---

## Approval

**Proposed by**: Prometheus (Planner)  
**Date**: 2026-01-22  
**Status**: Awaiting Review
