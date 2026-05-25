# team-mode — 并行多 Agent 协调

**生成时间:** 2026-05-15

## 概述

生成协调的 Agent 团队，具有共享邮箱、任务列表、可选的 tmux 布局和优雅的生命周期。参考 Claude Code Agent Teams 设计。**默认关闭。** 在 `oh-my-opencode.jsonc` 中设置 `team_mode.enabled` 启用；启用后重启 OpenCode。

用户文档：[`docs/guide/team-mode.md`](file:///Users/yeongyu/local-workspaces/omo/docs/guide/team-mode.md)。

## 配置

完整 Schema：[`src/config/schema/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/config/schema/team-mode.ts)。

```jsonc
{
  "team_mode": {
    "enabled": false,                       // 开关
    "tmux_visualization": false,            // 可选的 tmux 窗格布局
    "max_parallel_members": 4,              // 1..8
    "max_members": 8,                       // 1..8 硬上限
    "max_messages_per_run": 10000,          // 1..∞
    "max_wall_clock_minutes": 120,          // 1..∞
    "max_member_turns": 500,                // 1..∞
    "base_dir": null,                       // 可选覆盖 ~/.omo/teams 或 <project>/.omo/teams
    "message_payload_max_bytes": 32768,     // 1024..∞ — 每条消息的有效载荷上限
    "recipient_unread_max_bytes": 262144,   // 1024..∞ — 每个接收者的收件箱上限
    "mailbox_poll_interval_ms": 3000        // 500..∞ — 接收者轮询频率
  }
}
```

## 12 个 TEAM_* 工具

通过 [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) 的 `teamModeToolsRecord` 注册，仅在启用时生效。

| 工具 | 源文件 | 用途 |
|------|-------------|---------|
| `team_create` | `tools/lifecycle.ts` | 从命名或内联 TeamSpec 生成团队 + 成员会话 |
| `team_delete` | `tools/lifecycle.ts` | 拆除状态、邮箱、任务列表、工作树、可选的 tmux |
| `team_shutdown_request` | `tools/lifecycle.ts` | 成员或组长请求自身关闭 |
| `team_approve_shutdown` | `tools/lifecycle.ts` | 组长确认关闭 |
| `team_reject_shutdown` | `tools/lifecycle.ts` | 组长拒绝关闭并附理由 |
| `team_send_message` | `tools/messaging.ts` | 发送给指定成员或 `*` 广播 |
| `team_task_create` | `tools/tasks.ts` | 在共享列表上创建任务 |
| `team_task_list` | `tools/tasks.ts` | 列出任务（按状态/负责人筛选）|
| `team_task_update` | `tools/tasks.ts` | 认领 / 完成 / 删除（原子文件锁）|
| `team_task_get` | `tools/tasks.ts` | 获取单个任务 |
| `team_status` | `tools/query.ts` | 完整团队运行状态（成员、任务、邮箱）|
| `team_list` | `tools/query.ts` | 列出已声明 + 活跃的团队 |

## 可用的 Agent

[`AGENT_ELIGIBILITY_REGISTRY`](file:///Users/yeongyu/local-workspaces/omo/src/features/team-mode/types.ts) 位于 `types.ts` — 三个判定层级，各有其拒绝消息：

| 判定 | Agent | 说明 |
|---------|--------|-------|
| `eligible` | sisyphus, atlas, sisyphus-junior | 仅此三个 |
| `conditional` | hephaestus | 默认缺少 `teammate: "allow"` 权限。可以应用 D-36 补丁（在 `tool-config-handler.ts` 中添加 `teammate: "allow"`）或改用 `subagent_type: "sisyphus"` |
| `hard-reject` | oracle, librarian, explore, multimodal-looker, metis, momus, prometheus | 只读或仅计划模式 — 无法写入邮箱；改用 `task`（delegate-task）替代 |

Hard-reject Agent 在 TeamSpec 解析时会抛出特定消息（"Agent 'X' is read-only…"）。错误消息会引导成员将 delegate-task 作为正确的逃生口。

## 成员种类

```jsonc
{
  "members": [
    { "kind": "subagent_type", "name": "scout", "subagent_type": "sisyphus" },
    { "kind": "category", "name": "writer", "category": "writing", "prompt": "Write release notes" }
  ]
}
```

- `kind: "subagent_type"` — 直接 Agent。`prompt` 可选。
- `kind: "category"` — 通过 `sisyphus-junior` 路由，使用所选分类模型。`prompt` 必需。

## 模块布局

```
team-mode/
├── index.ts                    # 桶导出
├── types.ts                    # Zod schemas: TeamSpec, Member, Message, Task, RuntimeState; AGENT_ELIGIBILITY_REGISTRY
├── deps.ts                     # checkTeamModeDependencies（git、tmux 可用性）
├── member-parser.ts            # 对照资格注册表校验成员
├── member-guidance.ts          # 每种成员类型的自动注入指导
├── member-session-resolution.ts
├── member-session-routing.ts
├── resolve-caller-team-lead.ts # 判断会话是否作为组长运行
├── team-session-registry.ts    # 孵化竞态安全的 sessionID → 团队/成员查找
├── team-registry/              # 从 ~/.omo/teams/{name}/config.json 加载团队规格
│   ├── loader.ts
│   ├── paths.ts                # ensureBaseDirs, resolveBaseDir
│   └── validator.ts
├── team-state-store/           # 持久的运行时 state.json，带原子锁
├── team-runtime/               # 创建/状态/关闭生命周期
├── team-mailbox/               # 异步消息传递（发送/轮询/确认/收件箱）
├── team-tasklist/              # CRUD + 认领 + 依赖关系
├── team-worktree/              # 每个成员一个 git 工作树；删除时清理
├── team-layout-tmux/           # 可选的窗格布局 — close-team-member-pane, sweep-stale-team-sessions
└── tools/                      # 12 个 team_* 工具的实现 + 测试
```

## 存储布局

```
~/.omo/teams/{name}/                       # 用户作用域
<project>/.omo/teams/{name}/               # 项目作用域（冲突时优先）
  ├── config.json                          # TeamSpec
  ├── state.json                           # 运行时：成员、sessionID、生命周期
  ├── mailbox/                             # 每个接收者一个 .jsonl 文件
  ├── tasklist.jsonl                       # 共享任务列表
  └── worktrees/{member-name}/             # 每个成员的 git 工作树
```

## 生命周期

```
1. team_create
   → 加载 TeamSpec → 验证资格 → 孵化成员会话
   → 初始化邮箱 + 任务列表 + 工作树 → 可选的 tmux 布局
2. 组长通过 team_send_message + team_task_create 分派任务
3. 成员认领任务（team_task_update status="claimed"）→ 执行 → 报告（team_send_message）
4. team_shutdown_request → team_approve_shutdown / team_reject_shutdown
5. team_delete → 清理状态、邮箱、任务列表、工作树、窗格
```

## 关键不变量

1. **孵化竞态安全解析：** 每次团队孵化在 sessionID 已知时同步调用 `registerTeamSession(sessionId, entry)`；每个解析 sessionID 的钩子在 `loadRuntimeState` 之前先调用 `lookupTeamSession` 以避免孵化竞态窗口。
2. **延迟确认：** 消息即发即忘；接收者通过独立调用确认。
3. **锁定任务：** 任务认领使用原子文件锁；并发认领安全解析。
4. **原子写入：** 状态变更写入临时文件后重命名。
5. **仅限可用 Agent：** 在解析时拒绝，绝不在运行时。
6. **无嵌套团队：** 成员不能调用 `team_create`。

## 集成点

| 位置 | 作用 |
|-------|------|
| [`src/index.ts`](file:///Users/yeongyu/local-workspaces/omo/src/index.ts)（入口）| 如果 `team_mode.enabled`，执行 `checkTeamModeDependencies()` + `ensureBaseDirs()` |
| [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) `teamModeToolsRecord` | 注册 12 个 `team_*` 工具 |
| [`create-transform-hooks.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/hooks/create-transform-hooks.ts) | 条件性构建 `teamModeStatusInjector`（`team-mode-status-injector` 钩子）和 `teamMailboxInjector`（`team-mailbox-injector` 钩子）— 均为 Transform 层级 |
| [`create-tool-guard-hooks.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/hooks/create-tool-guard-hooks.ts) | 条件性构建 `teamToolGating`（`team-tool-gating` 钩子）— Tool Guard 层级 |
| [`src/plugin/event.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/event.ts) | 注册来自 `src/hooks/team-session-events/` 的 4 个团队会话事件处理器：`team-idle-wake-hint`、`team-lead-orphan-handler`、`team-member-error-handler`、`team-member-status-handler` |
| [`src/cli/doctor/checks/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/cli/doctor/checks/team-mode.ts) | 团队模式先决条件的诊断检查 |
| [`src/features/builtin-skills/skills/team-mode.ts`](file:///Users/yeongyu/local-workspaces/omo/src/features/builtin-skills/skills/team-mode.ts) | 记录 12 个工具的内置技能 — 在 `team_mode.enabled` 时门控 |

## 查询指南

| 任务 | 位置 |
|------|----------|
| 添加新团队工具 | `tools/` + 在 [`src/plugin/tool-registry.ts`](file:///Users/yeongyu/local-workspaces/omo/src/plugin/tool-registry.ts) `teamModeToolsRecord` 中注册 |
| 修改成员资格 | `types.ts` `AGENT_ELIGIBILITY_REGISTRY` |
| 修改存储格式 | `types.ts` Zod schemas |
| 添加工作树行为 | `team-worktree/manager.ts` |
| 修改 tmux 布局 | `team-layout-tmux/layout.ts` |
| 任务生命周期变更 | `team-tasklist/` |
| 邮箱协议变更 | `team-mailbox/` |
| 恢复孤儿运行 | `team-state-store/resume.ts` |

## 反模式

- 绝不绕过 `team-session-registry` — 直接调用 `loadRuntimeState` 查找会触发孵化竞态窗口。
- 绝不在没有 `team-state-store/locks.ts` 的原子锁的情况下写入团队状态文件。
- 绝不在用户明确要求团队模式工作时用 `task`（delegate-task）替代 `team_*` 工具 — 两者不等价。
- 绝不允许成员调用 `team_create`（嵌套团队被 `team-tool-gating` 钩子禁止）。
