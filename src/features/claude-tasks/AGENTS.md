# src/features/claude-tasks/ — 任务模式 + 存储

**生成时间:** 2026-05-15

## 概述

4 个非测试文件（约 622 行）。基于文件的任务持久化，支持原子写入、锁定和 OpenCode 待办 API 同步。

## 任务模式

```typescript
interface Task {
  id: string              // T-{uuid} 自动生成
  subject: string         // 简短标题
  description?: string    // 详细描述
  status: "pending" | "in_progress" | "completed" | "deleted"
  activeForm?: string     // 当前表单/模板
  blocks?: string[]       // 此任务阻塞的任务
  blockedBy?: string[]    // 阻塞此任务的任务
  owner?: string          // Agent/会话
  metadata?: Record<string, unknown>
  repoURL?: string        // 关联的仓库
  parentID?: string       // 父任务 ID
  threadID?: string       // 会话 ID（自动记录）
}
```

## 文件列表

| 文件 | 用途 |
|------|------|
| `types.ts` | 任务接口 + 状态类型 |
| `storage.ts` | `readJsonSafe()`、`writeJsonAtomic()`、`acquireLock()`、`generateTaskId()` |
| `session-storage.ts` | 按会话的任务存储，threadID 自动记录 |
| `index.ts` | 桶导出 |

## 存储

- 位置：`.omo/tasks/` 目录
- 格式：JSON 文件，每个任务一个文件
- 原子写入：临时文件 → 重命名
- 锁定：基于文件的锁定用于并发访问
- 同步：每次更新后将变更推送到 OpenCode 待办 API
