# Design: 修复 findings 覆盖 + 分批写入计划 + 关键词模式同步 + Agent 错误

## Goal

解决 oh-my-opencode 中的四个关键问题：
1. findings.md/progress.md 被覆盖而非追加
2. 大型 tasks.md 写入时流式响应中断
3. keyword-detector 的 mode 提示词与 skill 不同步
4. agent.name undefined 错误导致后台任务失败

## Architecture

### 组件 1: notepad-write-guard Hook

```
PreToolUse 阶段
     ↓
检测 Write 工具调用
     ↓
检查目标文件是否是 findings.md 或 progress.md
     ↓
如果文件已存在 → 阻止 Write，返回使用 Edit 的指引
如果文件不存在 → 允许 Write（首次创建）
```

**文件结构**:
```
src/hooks/notepad-write-guard/
├── index.ts       # Hook 实现
├── constants.ts   # 常量定义
└── index.test.ts  # 测试
```

### 组件 2: 分批写入 tasks.md

```
creating-changes skill
     ↓
1. Write tasks.md 骨架（标题、Phase 列表）
     ↓
2. For each Task:
   a. skill("progressive-disclosure-md") 提取相关上下文
   b. Edit 追加 Task + Context 块
     ↓
3. 每个 Task 末尾添加更新提醒
```

**标准 Task 格式**:
```markdown
### Task X.Y: [Title]
- [ ] 步骤...

> **Context** (from proposal.md/design.md):
> - Problem: [相关问题描述]
> - Design Decision: [相关设计决策]

**Files**: ...
**Acceptance Criteria**: ...

---
**完成后 (MANDATORY)**:
1. Edit 追加到 findings.md
2. Edit 追加到 progress.md
3. todowrite 更新 todo 状态
4. tasks.md 中 `- [ ]` → `- [x]`
```

### 组件 3: 关键词模式动态化

**当前问题**: keyword-detector 中硬编码了完整的 mode 内容

**解决方案**: 简化为调用 skill 的指引

```typescript
// Before (硬编码)
message: `[brainstorm-mode]
DESIGN MODE ACTIVATED. Before implementing...
**MANDATORY**: Invoke skill("brainstorming") NOW.
This skill will guide you through:
1. Understanding the idea...
2. Exploring 2-3 approaches...
...（大量内容）`

// After (动态化)
message: `[brainstorm-mode]
DESIGN MODE ACTIVATED. Invoke skill("brainstorming") for detailed instructions.`
```

### 组件 4: Observer Agent 注册修复

**根因**: observer agent 未在 `agentSources` 中注册

```
observer-detector hook
     ↓
调用 delegate_task(subagent_type: "observer")
     ↓
OpenCode 查找 agent 配置
     ↓
❌ agentSources["observer"] = undefined
     ↓
访问 agent.name 时报错
```

**修复**:
```typescript
// src/agents/utils.ts
import { createObserverAgent, OBSERVER_PROMPT_METADATA } from "./observer"

const agentSources: Partial<Record<BuiltinAgentName, AgentSource>> = {
  sisyphus: createSisyphusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  implementer: createImplementerAgent,
  archiver: createArchiverAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  metis: createMetisAgent,
  momus: createMomusAgent,
  prometheus: createPrometheusAgent,
  atlas: createAtlasAgent,
  observer: createObserverAgent,  // ← 添加这行
}

const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  // ... 现有 metadata ...
  observer: OBSERVER_PROMPT_METADATA,  // ← 添加这行
}
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Testing**: Bun test (BDD style)
- **Build**: bun build + tsc

## File Structure

| 操作 | 文件 |
|------|------|
| 新建 | `src/hooks/notepad-write-guard/index.ts` |
| 新建 | `src/hooks/notepad-write-guard/constants.ts` |
| 新建 | `src/hooks/notepad-write-guard/index.test.ts` |
| 修改 | `src/hooks/sisyphus-junior-notepad/constants.ts` |
| 修改 | `src/hooks/keyword-detector/constants.ts` |
| 修改 | `src/features/builtin-skills/creating-changes/SKILL.md` |
| 修改 | `src/agents/prometheus-prompt.ts` |
| 修改 | `src/agents/atlas.ts` |
| 修改 | `src/agents/sisyphus.ts` |
| 修改 | `src/agents/sisyphus-junior.ts` |
| 修改 | `src/features/background-agent/manager.ts` |
| 修改 | `src/hooks/index.ts` |
| 修改 | `src/index.ts` |

## Key Decisions

| 决策 | 理由 |
|------|------|
| 使用 Hook 而非仅提示词 | 提示词只是建议，Hook 可以强制执行 |
| 允许首次创建时使用 Write | 文件不存在时必须用 Write 创建 |
| 简化 mode 提示词 | 避免重复维护，让 skill 成为单一真相源 |
| 分批 Edit 追加 | 避免大型文件写入导致流式错误 |
| 使用 skill("progressive-disclosure-md") | 标准化的上下文提取方式 |

## Edge Cases

| 场景 | 处理方式 |
|------|----------|
| findings.md 不存在 | 允许 Write 创建 |
| 并发写入 findings.md | Edit 追加模式避免覆盖 |
| 超大 Task 上下文 | 限制摘要长度，只包含相关内容 |
| Agent 未注册 | 返回友好错误消息 |

## Open Questions

1. ~~是否需要对 tasks.md 也创建类似的 write-guard？~~ → 不需要，tasks.md 需要编辑
2. ~~上下文嵌入的最大长度是多少？~~ → 建议 200-300 字符
