# Proposal: 修复未注册钩子 + 实现缺失的高级功能

## Problem Statement

根据 `changes/verify-all-features/findings.md` 的验证结果，发现以下问题：

### 高优先级问题
1. **2 个钩子已实现但未注册**: `secret-scanner` 和 `skill-auto-injector` 代码完整但未在 `src/index.ts` 中注册，导致功能无法生效

### 中优先级问题  
2. **13 项高级功能完全缺失**: 50-enhancements Part 6-10 的所有文件不存在

## Proposed Solution

### Phase 1: 快速修复（30分钟）
注册已存在的 2 个钩子到 `src/index.ts`

### Phase 2: 实现缺失功能（分批实现）
按优先级实现 13 项缺失的高级功能

## Success Criteria

- [ ] `secret-scanner` 钩子正常触发
- [ ] `skill-auto-injector` 钩子正常触发
- [ ] 13 项高级功能文件全部存在
- [ ] `bun run typecheck` 无错误
- [ ] `bun test` 全部通过

## Scope

### IN Scope
- 注册 2 个未注册的钩子
- 实现 13 项缺失的高级功能
- 相关单元测试

### OUT of Scope
- 修改已存在功能的逻辑
- 新增计划外的功能
- 文档更新（除必要注释外）

## Risk Assessment

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 钩子注册顺序错误 | 低 | 中 | 参考现有钩子注册模式 |
| 新功能与现有功能冲突 | 中 | 高 | 每个功能独立测试 |
| 实现复杂度超预期 | 中 | 中 | 分批实现，优先核心功能 |

## Timeline

| Phase | 预计时间 | 说明 |
|-------|----------|------|
| Phase 1 | 30 分钟 | 注册 2 个钩子 |
| Phase 2 Wave 1 | 2 小时 | 高优先级功能 (5项) |
| Phase 2 Wave 2 | 3 小时 | 中优先级功能 (5项) |
| Phase 2 Wave 3 | 2 小时 | 低优先级功能 (3项) |
| **总计** | **~8 小时** | |
