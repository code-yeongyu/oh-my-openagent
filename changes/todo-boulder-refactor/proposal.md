# Proposal: Todo/Boulder 任务追踪系统重构

## 问题陈述

当前 Todo Continuation 和 Boulder Continuation 两套机制存在以下问题：

| 问题 | 现状 | 影响 |
|------|------|------|
| **Todo 依赖 Boulder** | Todo enforcer 会读取 boulder.json 作为 source of truth | 逻辑耦合，职责不清 |
| **Boulder 全局生效** | 一旦有 boulder.json，所有会话都被它控制 | 新会话无法独立工作 |
| **Compaction 破坏 Todo** | Compaction 后 Todo 列表可能被改写 | Todo continuation 失效（已修复） |

## 目标

1. **Todo enforcer 回归纯净** - 只检测 OpenCode Todo API，不再读取 boulder.json
2. **Boulder 会话隔离** - 只对 `session_ids` 中记录的会话生效
3. **互斥机制优化** - Boulder 会话内 Todo 让位，其他会话 Todo 正常工作

## 预期效果

| 场景 | 之前 | 之后 |
|------|------|------|
| 轻量任务（新会话） | 可能被现有 Boulder 干扰 | 纯 Todo API 追踪，互不干扰 |
| /start-work 会话 | Boulder 全局生效 | 只在创建 Boulder 的会话生效 |
| 多会话并行 | 所有会话共享一个 Boulder | 每个会话独立追踪 |

## 范围

### 包含
- `src/hooks/todo-continuation-enforcer.ts` - 移除 Boulder 依赖
- `src/hooks/atlas/index.ts` - 添加会话隔离检查
- `src/hooks/continuation-mutex.ts` - 优化互斥逻辑

### 不包含
- Quick Plan 文件方案（未来增强）
- Boulder 状态持久化重构
- 新的 UI 组件

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 回归：现有 Boulder 工作流中断 | 中 | 高 | 充分测试 /start-work 流程 |
| Todo/Boulder 同时触发 | 低 | 中 | 保留互斥机制 |
| session_id 过期清理 | 低 | 低 | Boulder 已有 session_ids 字段 |

## 成功标准

- [ ] 新会话使用 Todo API 时不受现有 Boulder 影响
- [ ] /start-work 创建的 Boulder 只在当前会话生效
- [ ] Boulder 会话内，Todo enforcer 自动让位
- [ ] 现有测试全部通过
- [ ] `bun run typecheck` 0 错误
