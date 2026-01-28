# Proposal: implement-missing-features

## Problem Statement

oh-my-opencode 插件与 everything-claude-code 对比后，发现 **19 项核心功能缺失**，包括：
- 持续学习 v2 系统（模式提取、知识沉淀）
- 本能模型（高频操作模式存储）
- Observer 观察者代理（后台行为审计）
- 6 个新命令（/evolve, /learn, /instinct-*, /build-fix）
- 2 个钩子（OnTaskComplete, PatternExtraction）
- 5 个领域技能（security-audit, database-optimization, backend-pattern-*）
- 2 个 MCP 服务（Memory, Sequential Thinking）

这些功能的缺失导致插件无法实现自动化学习和持续进化。

## Proposed Solution

分三阶段实施 19 项缺失功能：

- **Phase 1 (核心能力)**: 持续学习 v2 + 本能模型 + Observer 代理 + 钩子 + Memory MCP
- **Phase 2 (命令系统)**: 6 个新命令实现
- **Phase 3 (扩展能力)**: 5 个领域技能 + Sequential Thinking MCP

关键技术策略：
- 使用 OpenCode SDK 的 `event` hook 和 `onSummarize` 实现模式提取
- 本能存储使用 JSONC 格式，支持用户编辑
- Observer 代理使用轻量级模型（grok-code）在后台运行
- 遵循 TDD 开发流程，每个功能先写测试

## Success Criteria

- [ ] 持续学习系统能自动提取会话中的成功模式
- [ ] 本能模型能存储、触发、更新高频操作模式
- [ ] Observer 代理能在后台监控并报告异常行为
- [ ] 6 个新命令全部可执行且功能正确
- [ ] 2 个新钩子正确触发并提取模式
- [ ] 5 个领域技能可通过 `skill()` 调用
- [ ] Memory MCP 能跨会话保持记忆
- [ ] `bun run build` 成功
- [ ] `bun test` 全部通过（新增测试覆盖率 > 80%）
- [ ] 无新增 `as any` 或 `@ts-ignore`

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| OpenCode SDK 不支持某些 hook 类型 | Low | High | 提前验证 SDK 能力，设计降级方案 |
| 本能模型存储格式不兼容 | Medium | Medium | 使用 Zod 验证，提供迁移工具 |
| Observer 代理消耗过多资源 | Medium | Medium | 使用轻量级模型，设置调用频率限制 |
| Memory MCP 包不存在或已弃用 | Low | High | 先验证包可用性，准备自建方案 |
| 测试覆盖不足导致回归 | Medium | High | 严格 TDD，每个功能先写测试 |

## Alternatives Considered

### Option 1: 分阶段实施 (Recommended)
- **Pros**: 风险可控，每阶段可独立验证，允许中途调整
- **Cons**: 总时间较长（约 5 周）
- **Why chosen**: 降低风险，确保每个功能稳定后再进行下一阶段

### Option 2: 并行开发所有功能
- **Pros**: 理论上更快
- **Cons**: 集成风险高，调试困难，依赖关系复杂
- **Why not chosen**: 本能模型依赖持续学习系统，命令依赖本能模型，必须顺序开发

### Option 3: 只实现核心功能
- **Pros**: 工作量减少 50%
- **Cons**: 无法实现完整的自动化学习闭环
- **Why not chosen**: 用户期望完整功能集

## Dependencies

- **External**: 
  - `@anthropic/memory-mcp` (需验证包可用性)
  - `@anthropic/sequential-thinking-mcp` (需验证包可用性)
- **Internal**: 
  - 现有 `src/hooks/` 架构
  - 现有 `src/features/background-agent/` 机制
  - 现有 `src/features/builtin-commands/` 模板系统
  - 现有 `src/features/builtin-skills/` 技能加载器

## Timeline

- **Phase 1**: 核心能力 - 9.5 天
- **Phase 2**: 命令系统 - 3.5 天
- **Phase 3**: 扩展能力 - 3.5 天
- **总计**: 约 16.5 天（3-4 周）
