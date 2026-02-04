# 提案: wave-system-enhancements

## 问题陈述

Wave 系统（来自 upstream-sync 的决策 #5）目前存在以下问题：

1. **tasks.md 格式不统一**: Agent 可能直接创建 tasks.md 而不使用 `creating-changes` skill，导致格式不符合 Wave 解析器要求
2. **Wave 激活需要手动选择**: 即使任务数 > 5，用户仍需手动选择 Wave 模式
3. **缺少格式强制机制**: 没有 hook 阻止不规范的 tasks.md 创建

这些问题导致 Wave 并行执行功能无法自动发挥作用。

## 建议解决方案

实现三个相互关联的增强：

1. **更新 creating-changes skill**: 添加标准任务格式规范（HTML 注释元数据）
2. **创建 tasks-md-creation-guard hook**: 拦截直接创建 tasks.md 的行为
3. **实现 Wave 自动激活**: 当任务数 > 5 时自动加载 wave-parallel-execution skill

- **核心方法**: Hook 拦截 + Skill 格式规范 + 自动激活逻辑
- **范围**: 仅影响 `changes/*/tasks.md` 文件的创建流程
- **预计工作量**: 中等（3-4 小时）

## 成功标准

- [ ] 直接 Write 到新的 `changes/*/tasks.md` 被阻止并提示使用 skill
- [ ] 已存在的 tasks.md 可以正常更新
- [ ] 使用 `creating-changes` skill 后可以正常创建 tasks.md
- [ ] 任务数 > 5 时自动激活 Wave 模式
- [ ] `bun run typecheck` 和 `bun run build` 通过

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Hook 拦截过于严格导致正常流程被阻断 | 中 | 高 | 允许更新已存在的 tasks.md，提供清晰的错误消息 |
| Wave 自动激活与手动选择冲突 | 低 | 中 | 支持 "use sequential" 关键词覆盖 |
| 性能影响（每次 Write 都检查） | 低 | 低 | 使用快速路径匹配，< 2ms 执行时间 |

## 备选方案

### 方案 1: Hook 拦截 + Skill 改进 + 自动激活（推荐）
- **优点**: 完整解决方案，强制标准化，自动化程度高
- **缺点**: 实现复杂度较高
- **选择原因**: 全面改进 Wave 系统，符合决策 #5 要求

### 方案 2: 仅更新 Skill 格式文档
- **优点**: 简单，无代码改动
- **缺点**: 无法强制执行，Agent 可能忽略
- **未选原因**: 不能保证格式一致性

### 方案 3: 仅实现 Wave 自动激活
- **优点**: 快速实现
- **缺点**: 不解决格式问题，Wave 解析可能失败
- **未选原因**: 治标不治本

## 依赖项

- `src/features/builtin-skills/creating-changes/SKILL.md` - 需要更新
- `src/hooks/start-work/index.ts` - 需要修改
- Wave 系统现有能力（`wave-grouper.ts`, `worktree-manager.ts`）

## 时间线

- 阶段 1: Skill 格式更新 + Guard Hook 创建 - 2 小时
- 阶段 2: Wave 自动激活 + 集成验证 - 1.5 小时
