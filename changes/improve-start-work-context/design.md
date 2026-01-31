# Design: improve-start-work-context

## Goal

让 AI 在 start-work 和 boulder continuation 时都能获得完整的任务上下文（proposal + design + tasks 合并），并通过 todo 缓存确保上下文可读。

## Architecture

三个入口点的上下文准备流程：

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   start-work    │  │ boulder cont.   │  │  todo cont.     │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│  提示 AI 执行以下动作（不是代码自动执行）：                    │
│                                                              │
│  1. 调用 progressive-disclosure-md skill                     │
│     - start-work: 合并 proposal + design → tasks.md          │
│     - boulder/todo cont: 读取已合并的 tasks.md               │
│                                                              │
│  2. 只读取未完成的 task（检查 [ ] 而非 [x]）                  │
│                                                              │
│  3. 将未完成任务写入 todowrite                                │
│     - status 根据 checkbox: [x]=completed, [ ]=pending       │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  AI 从 todo 读取任务上下文，开始执行                          │
└──────────────────────────────────────────────────────────────┘
```

### 为什么用"提示 AI"而不是"代码自动执行"

| 维度 | 提示 AI | 代码自动 |
|------|---------|----------|
| 实现复杂度 | ✅ 简单 | ❌ 需写解析代码 |
| 状态覆盖风险 | ✅ AI 理解 checkbox | ❌ 需额外逻辑防覆盖 |
| 灵活性 | ✅ 可适应格式变化 | ❌ 格式变需改代码 |
| Token 消耗 | ⚠️ 有消耗 | ✅ 零消耗 |

选择"提示 AI"方案，因为简单且能自然处理状态同步。

## Tech Stack

- Runtime: Bun
- Language: TypeScript  
- Testing: bun test
- 依赖: `progressive-disclosure-md` skill (已安装)

## File Structure

```
src/features/builtin-commands/templates/
├── start-work.ts              # Modify: 添加合并指令和 todo 写入
src/hooks/
├── boulder-continuation/      # Create: 新 hook 处理 boulder continuation
│   └── index.ts               # 注入合并后的上下文到 todo
```

## Key Decisions

1. **Decision**: 只合并关键部分，不是全文
   - **Why**: 全文太长（proposal ~500字 + design ~500字），浪费 token
   - **Trade-off**: 可能遗漏某些上下文，但关键信息都在
   - **合并内容**:
     - proposal.md: Problem Statement, Success Criteria
     - design.md: Goal, Architecture, Key Decisions

2. **Decision**: 使用 progressive-disclosure-md skill 增量合并
   - **Why**: 精准选择器，token 高效
   - **Trade-off**: 依赖外部 skill

3. **Decision**: 每个 Task 解析为独立 todo item
   - **Why**: 便于追踪进度，AI 可直接读取
   - **Trade-off**: 任务多时 todo 列表会很长

4. **Decision**: 合并是一次性的（写入文件）
   - **Why**: 避免每次 session 都重新合并
   - **Trade-off**: tasks.md 会被修改

## Edge Cases

- progressive-disclosure-md 未安装：提示用户安装
- tasks.md 已包含合并内容：跳过合并（检测 `<!-- MERGED CONTEXT -->` 标记）
- proposal.md 或 design.md 不存在：警告但继续执行
- 任务数量为 0：报错并退出

## Open Questions

- [x] 合并哪些部分？→ Problem Statement, Success Criteria, Goal, Architecture, Key Decisions
- [x] todo 格式？→ 每个 `### Task X.Y` 作为独立 todo item
