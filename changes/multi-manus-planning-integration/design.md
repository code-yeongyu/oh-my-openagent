# Design: Manus Planning Integration (Revised)

## Goal

将 planning-with-files 的 Manus 原则深度融合到 oh-my-opencode 的现有 Sisyphus 工作流中，解决 todo 丢失、目标遗忘、checkbox 不更新等问题。

## Architecture

### 核心设计原则

1. **增强而非替换** - 在现有钩子中添加功能，不新建独立系统
2. **File 是真相来源** - tasks.md 持久化，同步到 OpenCode todos
3. **条件激活** - 需要 boulder.json 存在才激活（/start-work 后）
4. **可配置禁用** - 所有新功能可通过 disabled_hooks 关闭

### 组件交互

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户交互层                                │
├─────────────────────────────────────────────────────────────────┤
│  /start-work        │  Edit/Write 代码    │  session.idle       │
│  创建 boulder.json  │  触发 PostToolUse   │  触发 continuation  │
└────────┬────────────────────┬─────────────────────┬─────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   plan-update-reminder (新建)                    │
├─────────────────────────────────────────────────────────────────┤
│  事件: tool.execute.after (Edit/Write)                          │
│  条件: boulder.json 存在且 active_plan 有效                      │
│  行为: 追加提醒 "If this completes a task, update tasks.md."    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   plan-reorganizer (新建模块)                    │
├─────────────────────────────────────────────────────────────────┤
│  触发: Edit/Write tasks.md 后                                   │
│  行为: 检测完成的 Phase，移到 ## Completed Phases 部分           │
│  目的: 保持文档前部只有未完成任务                                 │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   plan-todo-sync (新建模块)                      │
├─────────────────────────────────────────────────────────────────┤
│  触发: session.idle 时                                          │
│  行为: 从 tasks.md 读取进度，同步到 OpenCode TodoWrite          │
│  目的: 解决 context compact 后 todo 丢失问题                     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│              todo-continuation-enforcer (增强)                   │
├─────────────────────────────────────────────────────────────────┤
│  现有: 检查 OpenCode todos，注入继续提示                         │
│  新增:                                                          │
│    1. 调用 plan-todo-sync 同步 file → todos                     │
│    2. 检查 getPlanProgress().phases 状态                         │
│    3. 综合判断: checkboxes + phases + boulder.phase              │
│    4. 代码变更但无 checkbox 更新 → 强制提醒                       │
│    5. 连续 3 次未更新 → 拒绝自动继续                             │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
1. /start-work 触发
   └─> 创建 boulder.json，设置 active_plan
   └─> 激活所有 Manus 相关钩子

2. Edit/Write 代码触发
   └─> plan-update-reminder 追加提醒
   └─> AI 应该更新 tasks.md

3. Edit/Write tasks.md 触发
   └─> plan-reorganizer 检查
       └─> 如果有 Phase 全部 checkbox 都是 [x]
           └─> 将该 Phase 移到 ## Completed Phases

4. session.idle 触发
   └─> plan-todo-sync 同步 file → OpenCode todos
   └─> todo-continuation-enforcer 检查
       └─> 综合判断 checkboxes + phases + boulder.phase
       └─> 检测代码变更但无 checkbox 更新
           └─> 第 1-2 次: 注入强制提醒
           └─> 第 3 次: 拒绝自动继续
```

## Tech Stack

- **Runtime**: Bun (与项目一致)
- **Language**: TypeScript (严格模式)
- **Testing**: Bun test (BDD 风格: #given/#when/#then)
- **Git 操作**: 原生 git CLI (通过 Bash 工具)

## File Structure

```
src/
├── features/
│   ├── boulder-state/
│   │   ├── types.ts              # Modify: 添加 PhaseInfo 类型
│   │   └── storage.ts            # Modify: 增强 getPlanProgress()
│   │
│   ├── plan-todo-sync/           # New: File → OpenCode 同步
│   │   ├── index.ts
│   │   ├── sync.ts
│   │   └── sync.test.ts
│   │
│   ├── plan-reorganizer/         # New: 完成任务移到底部
│   │   ├── index.ts
│   │   ├── reorganize.ts
│   │   └── reorganize.test.ts
│   │
│   └── builtin-skills/
│       ├── executing-plans/
│       │   └── SKILL.md          # Modify: 注入 Manus 原则
│       ├── wave-parallel-execution/
│       │   └── SKILL.md          # Modify: 注入 Manus 原则
│       └── manus-principles/     # New: Manus 参考文档
│           ├── SKILL.md
│           └── reference.md
│
├── hooks/
│   ├── todo-continuation-enforcer.ts  # Modify: 集成同步 + 强制提醒
│   │
│   └── plan-update-reminder/     # New: PostToolUse 提醒
│       └── index.ts
│
├── config/
│   └── schema.ts                 # Modify: 添加钩子名称
│
└── index.ts                      # Modify: 注册新钩子
```

## Key Decisions

### 1. Plan Activation 需要 boulder.json

- **决定**: 只有 boulder.json 存在时才激活 Manus 钩子
- **原因**: 避免在无计划时误触发，与 /start-work 工作流一致
- **实现**: 所有新钩子首先检查 `readBoulderState(ctx.directory)`

### 2. File → OpenCode 单向同步

- **决定**: tasks.md 是真相来源，同步到 OpenCode todos
- **原因**: 文件持久化，解决 context compact 后 todo 丢失
- **实现**: session.idle 时读取 tasks.md，调用 TodoWrite API

### 3. 综合完成检测

- **决定**: checkboxes + phases + boulder.phase 综合判断
- **原因**: 避免单一条件误判
- **逻辑**:
  - `boulder.phase === "completed"` → 允许停止
  - 所有 checkboxes 都是 `[x]` → 允许停止
  - 所有 phases 都是 `complete` → 允许停止
  - 任一条件不满足 → 继续执行

### 4. 强制提醒 + 拒绝停止

- **决定**: 两者结合，渐进式强制
- **原因**: 平衡提醒和阻断，避免过于激进
- **逻辑**:
  - 检测代码变更但 tasks.md 未更新
  - 第 1-2 次: 注入强制提醒
  - 第 3 次: 拒绝自动继续，等待用户干预

### 5. 完成任务移到底部

- **决定**: Phase 中所有 checkbox 都是 [x] 时，移到 ## Completed Phases
- **原因**: 保持文档前部只有未完成任务，解决前 30 行截断问题
- **触发**: 每次 Edit/Write tasks.md 后

### 6. 不自动勾选

- **决定**: AI 必须手动更新 tasks.md
- **原因**: 自动勾选可能误判，需要 AI 明确确认完成
- **实现**: 只提醒，不自动修改

## Type Definitions

### PhaseInfo (新增)

```typescript
/** 阶段状态 */
type PhaseStatus = "complete" | "in_progress" | "pending"

/** 阶段信息 */
interface PhaseInfo {
  /** 阶段名称 (e.g., "Phase 1: Setup") */
  name: string
  /** 阶段状态 */
  status: PhaseStatus
  /** 阶段在文件中的行号 */
  line: number
}
```

### PlanProgress (增强)

```typescript
interface PlanProgress {
  // 现有字段
  total: number
  completed: number
  isComplete: boolean

  // 新增字段
  phases?: PhaseInfo[]
}
```

### CheckboxEnforcementState (新增)

```typescript
interface CheckboxEnforcementState {
  /** 上次检测到代码变更的时间 */
  lastCodeChangeAt?: number
  /** 上次 tasks.md 更新的时间 */
  lastTasksUpdateAt?: number
  /** 连续未更新的提醒次数 */
  reminderCount: number
}
```

## Edge Cases

### getPlanProgress

- **混合格式 (checkbox + phases)**: 两种都解析，返回合并结果
- **无效阶段状态**: 忽略，只计数有效状态
- **大小写**: 不敏感匹配 (`Complete`, `COMPLETE`, `complete`)
- **无阶段标记**: `phases` 返回 `undefined`，回退到纯 checkbox 检查

### plan-todo-sync

- **无 boulder.json**: 跳过同步
- **tasks.md 不存在**: 跳过同步
- **TodoWrite API 失败**: 记录日志，不阻塞

### plan-reorganizer

- **无完成的 Phase**: 不修改文件
- **已有 ## Completed Phases**: 追加到该部分
- **无 ## Completed Phases**: 创建该部分
- **Phase 内容跨越多行**: 正确识别边界

### todo-continuation-enforcer

- **无 boulder.json**: 使用现有逻辑（纯 OpenCode todos）
- **代码变更检测失败**: 跳过强制提醒
- **git 不可用**: 跳过代码变更检测

## Open Questions (Resolved)

- [x] Plan Activation 方式 - **需要 boulder.json**
- [x] Todo 同步方向 - **File → OpenCode 单向同步**
- [x] 完成检测逻辑 - **综合判断三个条件**
- [x] Checkbox 强制方式 - **强制提醒 + 拒绝停止（两者结合）**
- [x] 自动勾选 - **不自动勾选，AI 手动更新**
- [x] 前 30 行截断 - **完成任务移到底部**
- [x] Skill 嵌套 - **不嵌套，复制并修改**
