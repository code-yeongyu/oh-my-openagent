# Proposal: improve-start-work-context

## Problem Statement

当前 `creating-changes` skill 创建 5 个独立文件（proposal.md, design.md, tasks.md, findings.md, progress.md），但 `start-work` 只读取 tasks.md。这导致：

1. **AI 执行时缺少上下文** - 不知道问题背景（proposal）和架构决策（design）
2. **boulder continuation 也缺少上下文** - 只注入 tasks.md 路径
3. **Todo 中没有任务详情** - AI 无法从 todo 直接读取任务上下文

## Proposed Solution

在 `start-work` 和 `boulder continuation` 两个入口点，使用 `progressive-disclosure-md` skill 进行增量合并，并将结果写入 todo：

### 核心改动

1. **start-work 时**：
   - 调用 `progressive-disclosure-md` 增量合并 proposal + design → tasks.md（文件级别，一次性）
   - 将合并后的 tasks.md 解析为独立 todo items 写入 todowrite

2. **boulder continuation 时**：
   - 调用 `progressive-disclosure-md` 增量读取已合并的 tasks.md
   - 将任务解析为独立 todo items 写入 todowrite

3. **已有功能保持不变**：
   - `plan-update-reminder` hook 继续提醒更新 findings.md 和 progress.md

### 关键设计

- **合并是永久性的** - start-work 首次执行时合并到 tasks.md 文件
- **Todo 是运行时缓存** - 每个 `### Task X.Y` 解析为独立的 todo item
- **两个入口都写 todo** - 确保无论从哪个入口进入，AI 都能从 todo 读取

## Success Criteria

- [ ] start-work 时自动合并 proposal + design 关键部分到 tasks.md
- [ ] 合并后的 tasks.md 包含足够的上下文（Problem, Goal, Architecture, Key Decisions）
- [ ] 每个任务解析为独立 todo item，包含完整的任务描述
- [ ] boulder continuation 时能从 todo 读取任务上下文
- [ ] plan-update-reminder hook 正常触发（每 2 次代码修改提醒）

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| tasks.md 合并后太长 | Medium | Medium | 只合并关键部分，不是全文 |
| progressive-disclosure-md 未安装 | Low | High | 检测并提示安装 |
| Todo items 太多导致性能问题 | Low | Low | 只解析当前 Phase 的任务 |

## Alternatives Considered

### Option 1: 修改 start-work 读取 5 个文件（不推荐）
- **Pros**: 不修改文件结构
- **Cons**: 每次都要读取多个文件，浪费 token；boulder continuation 仍然缺少上下文
- **Why not chosen**: 不解决根本问题，每次都要重复读取

### Option 2: 在 creating-changes 时就合并到 tasks.md（不推荐）
- **Pros**: 一次性解决
- **Cons**: tasks.md 太长，人无法审阅；违背文件职责分离
- **Why not chosen**: 用户明确要求创建阶段保持 5 个独立文件

### Option 3: 使用 progressive-disclosure-md 增量合并 + todo 写入（推荐）
- **Pros**: 
  - 创建阶段保持 5 个独立文件（人可审阅）
  - 执行阶段合并关键上下文
  - Todo 缓存确保两个入口都能读取
- **Cons**: 需要修改 start-work 模板和 boulder continuation 逻辑
- **Why chosen**: 最佳平衡点

## Dependencies

- `progressive-disclosure-md` skill（已安装）
- `plan-update-reminder` hook（已存在）
- `boulder-state` feature（已存在）

## Timeline

- Phase 1: 修改 start-work 模板 - 0.5 天
- Phase 2: 修改 boulder continuation 注入 - 0.5 天
- Phase 3: 测试验证 - 0.5 天
