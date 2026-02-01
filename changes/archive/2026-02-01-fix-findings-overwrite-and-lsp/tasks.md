# 修复计划: findings.md 覆盖 + 分批写入计划 + 关键词模式同步 + Agent 错误

## 问题概述

1. **findings.md 被覆盖** - 提示词矛盾导致 AI 使用 Write 而非 Edit
2. **tasks.md 写入失败** - 一次性写入大型 tasks.md 导致 `AI_TypeValidationError: Stream error`
3. **brainstorm-mode 与 skill 不同步** - keyword-detector 中硬编码的提示词与实际 skill 不一致
4. **agent.name undefined 错误** - 后台任务/observer 调用时出现 `TypeError: undefined is not an object (evaluating 'agent.name')`
5. **LSP 服务器未安装** - 环境配置问题，非代码 bug

## 核心设计决策

- **分批写入**: Prometheus/creating-changes 分 Task 逐个写入，而非一次性生成完整 tasks.md
- **上下文嵌入**: 每个 Task 包含从 proposal.md/design.md 提取的相关上下文摘要
- **强制 Edit**: 对 findings.md/progress.md 只允许 Edit 追加，禁止 Write 覆盖
- **渐进式披露**: 使用 progressive-disclosure-md 从 proposal/design 中提取相关内容
- **动态 Skill 引用**: keyword-detector 的 mode 提示词简化为调用 skill 的指引，不再硬编码完整内容

---

## Phase 1: 修复 findings.md/progress.md 覆盖问题

### Task 1.1: 修正提示词矛盾
- [x] 修改 `src/hooks/sisyphus-junior-notepad/constants.ts`
- [x] 将 "never use Edit tool" 改为 "ALWAYS use Edit tool to APPEND"
- [x] 明确禁止对 findings.md/progress.md 使用 Write 工具
- [x] 添加每个 Task 完成后必须更新 findings.md 的提醒

**Files**: `src/hooks/sisyphus-junior-notepad/constants.ts`

**Acceptance Criteria**:
- 提示词明确指示使用 Edit 追加
- 提示词明确禁止使用 Write 覆盖
- 包含 "每个 Task 完成后更新 findings.md" 的强制提醒

### Task 1.2: 同步更新相关 agent/hook 提示词
- [x] 更新 `src/agents/atlas.ts` 中的 notepad 指令
- [x] 更新 `src/agents/sisyphus.ts` 中的相关指令
- [x] 更新 `src/agents/sisyphus-junior.ts` 中的相关指令
- [x] 更新 `src/hooks/subagent-verification/constants.ts`
- [x] 更新 `src/hooks/plan-update-reminder/index.ts`

**Files**:
- `src/agents/atlas.ts`
- `src/agents/sisyphus.ts`
- `src/agents/sisyphus-junior.ts`
- `src/hooks/subagent-verification/constants.ts`
- `src/hooks/plan-update-reminder/index.ts`

**Acceptance Criteria**:
- 所有相关 agent/hook 都使用一致的 "Edit 追加" 指令
- 禁止 Write 覆盖的规则在所有位置同步

### Task 1.3: 创建 notepad-write-guard Hook
- [x] 创建 `src/hooks/notepad-write-guard/index.ts`
- [x] 创建 `src/hooks/notepad-write-guard/constants.ts`
- [x] 在 PreToolUse 阶段拦截对 findings.md 和 progress.md 的 Write 操作
- [x] 返回阻止消息，指导使用 Edit 工具追加

**Files**:
- `src/hooks/notepad-write-guard/index.ts` (新建)
- `src/hooks/notepad-write-guard/constants.ts` (新建)

**Acceptance Criteria**:
- Hook 检测到对 `**/findings.md` 或 `**/progress.md` 的 Write 调用
- 返回阻止消息并建议使用 Edit
- 允许首次创建文件（文件不存在时）

### Task 1.4: 注册 Hook
- [x] 在 `src/hooks/index.ts` 导出新 Hook
- [x] 在 `src/index.ts` 注册到 tool.execute.before
- [x] 添加到 `HookNameSchema` 配置

**Files**:
- `src/hooks/index.ts`
- `src/index.ts`
- `src/config/schema.ts`

### Task 1.5: 编写测试
- [x] 创建 `src/hooks/notepad-write-guard/index.test.ts`
- [x] 测试 Write 操作被拦截（文件已存在时）
- [x] 测试 Write 操作允许（文件不存在时，首次创建）
- [x] 测试 Edit 操作正常通过

**Files**: `src/hooks/notepad-write-guard/index.test.ts` (新建)

---

## Phase 2: 分批写入 tasks.md 机制

### Task 2.1: 修改 creating-changes skill
- [x] 调用 `skill("skill-studio")` 然后路由到 `skill-create-and-change`
- [x] 修改 `src/features/builtin-skills/creating-changes/SKILL.md`
- [x] 将 "Step 4: Write tasks.md" 改为分批写入模式
- [x] 添加调用 `skill("progressive-disclosure-md")` 从 proposal/design 提取上下文的指令
- [x] 每个 Task 写入时嵌入相关的设计上下文摘要
- [x] 每个 Task 末尾添加更新 findings/progress/todo 的强制提醒

**Files**: `src/features/builtin-skills/creating-changes/SKILL.md`

**修改内容**:
```markdown
### Step 4: Write tasks.md (分批模式)

1. 创建 tasks.md 骨架（标题、Phase 列表）
2. 调用 skill("progressive-disclosure-md") 从 proposal.md/design.md 提取相关上下文
3. 逐个 Task 用 Edit 追加，每个 Task 包含：
   - Task 描述和步骤
   - > Context: 从 proposal/design 提取的相关上下文摘要
   - Files, Acceptance Criteria, Risk Tier
4. 每个 Task 末尾添加强制提醒：
   - 使用 Edit 更新 findings.md 和 progress.md
   - 使用 todowrite 更新 todo 状态
```

**Acceptance Criteria**:
- Skill 明确指示分批写入而非一次性生成
- 包含 `skill("progressive-disclosure-md")` 调用指令（不是 CLI）
- 每个 Task 包含嵌入的设计上下文
- 每个 Task 包含更新 findings/progress/todo 的提醒

### Task 2.2: 修改 Prometheus agent 提示词
- [x] 修改 `src/agents/prometheus-prompt.ts`
- [x] 将计划生成逻辑改为分批写入模式
- [x] 添加从 proposal/design 提取上下文的指令
- [x] 添加每个 Task 后更新 findings 的强制提醒

**Files**: `src/agents/prometheus-prompt.ts`

**Acceptance Criteria**:
- Prometheus 分 Phase/Task 逐个写入 tasks.md
- 每个 Task 包含嵌入的设计上下文
- 避免一次性生成大型 tasks.md 导致流式错误

### Task 2.3: 更新相关 agent 提示词
- [x] 更新 `src/agents/atlas.ts` 中的计划执行指令
- [x] 更新 `src/agents/sisyphus.ts` 中的计划生成指令
- [x] 确保所有 agent 遵循分批写入模式

**Files**:
- `src/agents/atlas.ts`
- `src/agents/sisyphus.ts`

### Task 2.4: 定义 Task 上下文嵌入格式
- [x] 在每个 Task 下添加 `> Context:` 块的标准格式
- [x] 上下文来源：proposal.md (Problem/Solution) + design.md (Architecture/Decisions)
- [x] 保持简洁，只包含与该 Task 相关的内容
- [x] 添加完成后更新 findings/progress/todo 的强制提醒

**标准格式**:
```markdown
### Task X.Y: [Title]
- [x] 步骤...

> **Context** (from proposal.md/design.md):
> - Problem: [相关问题描述]
> - Design Decision: [相关设计决策]
> - Reference: [相关文件或接口]

**Files**: ...
**Acceptance Criteria**: ...

---
**完成后 (MANDATORY)**:
1. 使用 `Edit` 工具将发现追加到 `findings.md`
2. 使用 `Edit` 工具将进度追加到 `progress.md`
3. 使用 `todowrite` 更新 todo 状态为 completed
4. 在 `tasks.md` 中将 `- [ ]` 改为 `- [x]`
```

---

## Phase 3: 关键词模式动态化 + Agent 错误修复

### Task 3.1: brainstorm-mode 动态化
- [x] 修改 `src/hooks/keyword-detector/constants.ts`
- [x] 将 brainstorm-mode 的硬编码内容简化为调用 skill 的指引
- [x] 避免重复 skill 内容，让用户通过 `skill("brainstorming")` 获取最新指令

**Files**: `src/hooks/keyword-detector/constants.ts`

**修改前**:
```typescript
message: `[brainstorm-mode]
DESIGN MODE ACTIVATED. Before implementing, use the brainstorming skill.
**MANDATORY**: Invoke skill("brainstorming") NOW.
This skill will guide you through:
1. Understanding the idea...
2. Exploring 2-3 approaches...
...（硬编码的完整内容）`
```

**修改后**:
```typescript
message: `[brainstorm-mode]
DESIGN MODE ACTIVATED. Invoke skill("brainstorming") for detailed instructions.`
```

**Acceptance Criteria**:
- 提示词简洁，只包含调用 skill 的指引
- 不再硬编码 skill 的完整内容
- 用户通过 skill() 获取最新指令

### Task 3.2: 同步更新其他 mode 提示词
- [x] 检查 analyze-mode, search-mode, consult-metis-mode 等
- [x] 确保所有 mode 提示词都简洁，指向对应的 skill

**Files**: `src/hooks/keyword-detector/constants.ts`

### Task 3.3: 修复 observer agent 未注册问题
- [x] 在 `src/agents/utils.ts` 的 `agentSources` 中添加 observer
- [x] 导入 `createObserverAgent` 从 `./observer`
- [x] 在 `agentMetadata` 中添加 `OBSERVER_PROMPT_METADATA`（可选）

**Files**: `src/agents/utils.ts`

**根因分析**:
- `observer` agent 在 `src/agents/observer.ts` 中定义了 `createObserverAgent` 函数
- 但**没有在 `agentSources` 中注册**
- `observer-detector` hook 调用 `subagent_type: "observer"` 时，找不到对应的 agent
- OpenCode 主程序尝试访问 `agent.name` 时，`agent` 是 `undefined`

**修复代码**:
```typescript
// src/agents/utils.ts
import { createObserverAgent, OBSERVER_PROMPT_METADATA } from "./observer"

const agentSources: Partial<Record<BuiltinAgentName, AgentSource>> = {
  // ... 现有 agents ...
  observer: createObserverAgent,  // ← 添加
}

const agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>> = {
  // ... 现有 metadata ...
  observer: OBSERVER_PROMPT_METADATA,  // ← 添加（可选）
}
```

**Acceptance Criteria**:
- `observer` 在 `agentSources` 中注册
- `observer-detector` hook 调用 observer 时不再报错
- 后台任务正常完成

### Task 3.4: 增强 agent 调用的错误处理
- [x] 在 `src/features/background-agent/manager.ts` 中添加更详细的错误日志
- [x] 在调用 agent 前验证 agent 配置的完整性
- [x] 添加 agent name 的 null check

**Files**:
- `src/features/background-agent/manager.ts`
- `src/tools/call-omo-agent/tools.ts`

---

## Phase 4: LSP 环境问题文档化

### Task 4.1: 更新 CLI doctor 检查
- [x] 确认 `src/cli/doctor/` 中的 LSP 检查逻辑正确
- [x] 添加更友好的安装提示

**Files**:
- `src/cli/doctor/constants.ts`
- `src/tools/lsp/constants.ts`

### Task 4.2: 更新 LSP 安装提示
- [x] 在 `LSP_INSTALL_HINTS` 中添加 Windows 特定提示
- [x] 添加 bun/pnpm 安装选项
- [x] 添加常见问题排查指南

**Files**: `src/tools/lsp/constants.ts`

---

## Phase 5: 验证

### Task 4.1: 运行测试
- [x] `bun test` 全部通过
- [x] `bun run typecheck` 无错误

### Task 4.2: 手动验证 notepad-write-guard
- [x] 模拟对 findings.md 的 Write 操作被拦截
- [x] 模拟对 progress.md 的 Write 操作被拦截
- [x] 确认 Edit 操作正常工作
- [x] 确认首次创建文件时 Write 被允许

### Task 4.3: 手动验证分批写入
- [x] 使用 creating-changes skill 创建新计划
- [x] 确认 tasks.md 是分批写入的
- [x] 确认每个 Task 包含嵌入的设计上下文
- [x] 确认无 `AI_TypeValidationError` 错误

---

## 技术细节

### notepad-write-guard Hook 伪代码

```typescript
export function createNotepadWriteGuardHook(ctx: PluginInput) {
  return {
    name: "notepad-write-guard",
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "write") return
      
      const filePath = output.args?.filePath as string
      if (!filePath) return
      
      // 检查是否是 notepad 文件
      const isNotepad = filePath.endsWith("findings.md") || filePath.endsWith("progress.md")
      if (!isNotepad) return
      
      // 允许首次创建（文件不存在）
      if (!existsSync(filePath)) return
      
      // 阻止 Write 覆盖操作
      return {
        blocked: true,
        message: `⛔ BLOCKED: Cannot use Write on ${basename(filePath)}!
        
Use Edit tool to APPEND content instead:
1. Read current content
2. Use Edit to add new content at the end

This prevents overwriting existing findings/progress.`
      }
    }
  }
}
```

### 提示词修正

**Before** (sisyphus-junior-notepad/constants.ts):
```
IMPORTANT: Always APPEND to notepad files - never overwrite or use Edit tool.
```

**After**:
```
IMPORTANT: Always use Edit tool to APPEND content to findings.md and progress.md.
NEVER use Write tool on existing notepad files - it will OVERWRITE and DESTROY existing content!

After completing each Task:
1. Use Edit to append findings to findings.md
2. Use Edit to append progress to progress.md
```

### 分批写入 tasks.md 流程

```
Prometheus/creating-changes:
  1. Write tasks.md 骨架 (标题、元信息)
  2. For each Phase:
     a. Edit 追加 Phase 标题
     b. For each Task:
        i.  使用 progressive-disclosure-md 从 proposal/design 提取相关上下文
        ii. Edit 追加 Task 内容 + 嵌入的 Context 块
  3. 完成后报告任务数量
```

### 涉及的 Skills

| Skill | 用途 |
|-------|------|
| `skill-studio` | 入口路由，根据意图分发到子 skill |
| `skill-create-and-change` | 修改 creating-changes skill（由 skill-studio 路由） |
| `progressive-disclosure-md` | 从 proposal/design 提取上下文（通过 `skill()` 调用） |
| `creating-changes` | 被修改的目标 skill |

### Skill 调用方式

```typescript
// 1. 修改 skill 时，先调用 skill-studio
skill("skill-studio")
// 然后根据指引调用 skill-create-and-change

// 2. 提取上下文时，调用 progressive-disclosure-md
skill("progressive-disclosure-md")
// 然后使用 CLI: node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs h2.1 proposal.md
```

### 涉及的 Agents

| Agent | 修改内容 |
|-------|----------|
| `prometheus-prompt.ts` | 分批写入计划生成逻辑 |
| `atlas.ts` | notepad 指令同步 |
| `sisyphus.ts` | 计划生成指令同步 |
| `sisyphus-junior.ts` | notepad 指令同步 |
