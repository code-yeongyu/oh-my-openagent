# src/features/tmux-subagent/ — Tmux 窗格管理

**生成时间:** 2026-05-15

## 概述

32 个文件。状态优先的 tmux 集成，管理后台 Agent 会话的窗格。处理分割决策、网格规划、轮询和生命周期事件。

## 核心架构

```
TmuxSessionManager (manager.ts)
  ├─→ DecisionEngine: 是否应该创建/关闭窗格？
  ├─→ ActionExecutor: 执行创建/关闭/替换操作
  ├─→ PollingManager: 监控窗格健康状态
  └─→ EventHandlers: 响应会话创建/删除
```

所有 tmux 命令执行都集中通过 `src/shared/tmux/runner.ts`（`runTmuxCommand`）。不要在此模块中添加直接的 `Bun.spawn([tmux,...])` 调用。它们会偏离重试/超时/终端错误纪律。

## 关键文件

| 文件 | 用途 |
|------|------|
| `manager.ts` | `TmuxSessionManager` — 主类，会话跟踪，事件路由 |
| `decision-engine.ts` | 评估窗口状态 → 生成带操作的 `SpawnDecision` |
| `action-executor.ts` | 执行 `PaneAction[]`（关闭、创建、替换） |
| `grid-planning.ts` | 根据窗口尺寸计算窗格布局 |
| `spawn-action-decider.ts` | 决定创建 vs 替换 vs 跳过 |
| `spawn-target-finder.ts` | 找到最佳分割或替换的窗格 |
| `polling-manager.ts` | 对跟踪的会话进行健康轮询 |
| `types.ts` | `TrackedSession`、`WindowState`、`PaneAction`、`SpawnDecision` |

## 窗格生命周期

```
session.created → spawn-action-decider → grid-planning → action-executor → 跟踪会话
session.deleted → 清理跟踪的会话 → 如果窗格为空则关闭
```

## 布局约束

- `MIN_PANE_WIDTH`：52 字符
- `MIN_PANE_HEIGHT`：11 行
- 主窗格保留（从不分割到最小值以下）
- Agent 窗格从剩余空间分割

## 事件处理器

| 文件 | 事件 |
|------|------|
| `session-created-handler.ts` | 新后台会话 → 创建窗格 |
| `session-deleted-handler.ts` | 会话结束 → 关闭窗格 |
| `session-created-event.ts` | 事件类型定义 |
