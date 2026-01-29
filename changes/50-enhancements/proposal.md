# Proposal: 50项功能增强

## Problem Statement

oh-my-opencode 项目与 everything-claude-code 对比后发现 9 个核心系统存在 50 处可优化点。当前实现存在以下问题：

1. **TDD 守卫形同虚设**：`hasFailingTest` 硬编码为 `false`，从未真正验证测试
2. **安全漏洞**：敏感信息（API Key、密码）可能被写入代码，无预防机制
3. **技能需手动调用**：AI 必须主动调用 `skill()` 才能获得技能指令
4. **Agent 交接信息丢失**：依赖隐式 session_id，无结构化交接格式
5. **并行任务可能冲突**：不分析依赖关系就并行执行

## Proposed Solution

从 everything-claude-code 的 `.qoder/repowiki/zh/` 目录复制已验证的最佳实践，适配到 oh-my-opencode。

- **Key approach**: 复制粘贴 + 适配（非从零开发）
- **Scope**: 仅增强现有功能，不新增架构组件
- **Estimated effort**: Large（50项，预计4-5周）

## Success Criteria

- [ ] 所有 17 项高优先级增强完成
- [ ] 每项增强有对应的测试用例
- [ ] `bun run typecheck` 0 错误
- [ ] `bun test` 全部通过
- [ ] `bun run build` 构建成功
- [ ] 现有功能无回归

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| 破坏现有 API | Medium | High | 每项增强独立提交，便于回滚 |
| TDD 真实执行拖慢流程 | Low | Medium | 添加超时机制和开关 |
| 技能自动注入过度 | Medium | Medium | 提供配置项禁用 |
| 并行依赖分析不准确 | Low | Low | 保守策略：不确定时串行 |

## Alternatives Considered

### Option 1: 复制粘贴 + 适配 (Recommended)
- **Pros**: 已验证的实现，风险低，速度快
- **Cons**: 需要理解两个代码库的差异
- **Why chosen**: everything-claude-code 的实现经过验证

### Option 2: 从零实现
- **Pros**: 完全适配本项目架构
- **Cons**: 耗时长，可能引入新 bug
- **Why not chosen**: 增强项太多，时间成本过高

### Option 3: 只做高优先级
- **Pros**: 快速见效
- **Cons**: 中优先级也有很多有价值的增强
- **Why not chosen**: 用户选择了全部 50 项

## Dependencies

- everything-claude-code 仓库（参考来源）
- 现有测试基础设施（bun test）
- 现有构建系统（bun build）

## Timeline

- Phase 1: 高优先级 17 项 - Week 1-2
- Phase 2: 中优先级 28 项 - Week 3-4
- Phase 3: 低优先级 5 项 - 按需
