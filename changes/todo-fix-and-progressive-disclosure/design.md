# Design: TODO Bug Fix + Progressive-Disclosure Integration

## Overview

本次变更包含两个独立但相关的改进：

1. **TODO CONTINUATION Bug 修复**: 修复当没有 active boulder 时 todo-continuation-enforcer 仍然触发的问题
2. **Progressive-Disclosure-MD 内置集成**: 将渐进式披露 skill 集成为内置功能，强制大型 .md 文件使用 mdsel

---

## 变更 1: TODO CONTINUATION Bug 修复

### 问题描述

用户反馈 "明明没有激活任务但是它启动了"。

**根本原因**:
- `src/hooks/todo-continuation-enforcer.ts` 在 `boulderState` 为 null 时仍然调用 `readPlanProgress()`
- 当 OpenCode TODO API 为空时，直接回退到扫描 `tasks.md` 文件
- `hasIncomplete` 判断不检查 boulder 是否激活

### 用户决策

| 场景 | 期望行为 |
|------|----------|
| 无 task + 无 todo | 完全停止，不触发 |
| 有 todo + 不需要用户决策 | 继续提醒 |
| 有 active boulder | 正常工作 |

### 技术方案

**修复点 1**: L572 - 添加 boulder 激活检查
```typescript
// 修改前
const planProgress = readPlanProgress(ctx.directory)

// 修改后
const planProgress = boulderState?.active_plan 
  ? readPlanProgress(ctx.directory) 
  : null
```

**修复点 2**: L737 - 修改 hasIncomplete 逻辑
```typescript
// 修改前
const hasIncomplete = apiIncompleteCount > 0 || fileIncompleteCount > 0

// 修改后
const hasIncomplete = apiIncompleteCount > 0 || 
  (boulderState?.active_plan && fileIncompleteCount > 0)
```

**关键原则**:
- OpenCode TODO API 检查保持不变（这是原生功能）
- 只有在 boulder 激活时才扫描 tasks.md
- 不改变其他 hook 行为

---

## 变更 2: Progressive-Disclosure-MD 内置集成

### 目标

将 `progressive-disclosure-md` skill 集成为内置功能，在以下场景强制使用：
- 读取 >200 words 的 .md 文件时，强制使用 mdsel
- 写入 .md 文件时，强制使用 "Outline → Edit" 工作流
- 编辑 .md 文件时，建议先用 mdsel 定位

### 用户决策

| 决策点 | 用户选择 |
|--------|----------|
| 激活阈值 | >200 words |
| 集成强度 | 强制性 (PreToolUse 阻止) |

### 技术架构

```
src/features/builtin-skills/progressive-disclosure-md/
├── SKILL.md                    # Skill 定义 (从用户 skill 复制)
├── index.ts                    # 导出

src/hooks/mdsel-enforcer/
├── index.ts                    # Hook 实现
├── constants.ts                # 常量 (MIN_WORDS = 200)
├── types.ts                    # 类型定义
└── index.test.ts               # 测试
```

### Hook 行为设计

**PreToolUse (Read 工具)**:
```typescript
// 检测目标是 .md 文件且 >200 words
if (toolName === "read" && filePath.endsWith(".md")) {
  const wordCount = estimateWordCount(filePath)
  if (wordCount > MIN_WORDS) {
    // 阻止直接读取，返回强制使用 mdsel 的提示
    return {
      block: true,
      message: `文件 ${filePath} 超过 ${MIN_WORDS} 词。请使用 mdsel 选择性读取：
      
1. 先索引: node ~/.../cli.mjs "${filePath}"
2. 然后选择: node ~/.../cli.mjs h2.1 "${filePath}"`
    }
  }
}
```

**PreToolUse (Write 工具)**:
```typescript
// 检测写入 .md 文件
if (toolName === "write" && filePath.endsWith(".md")) {
  // 检查是否遵循 Outline → Edit 工作流
  // 阻止直接写入完整内容，要求先写大纲再 edit
  return {
    block: true,
    message: `写入 .md 文件必须遵循工作流：
    
Phase 1: 用 write 创建骨架大纲 (仅标题)
Phase 2: 用 edit 逐节填充内容
Phase 3: 用 edit 进行最终润色

请先创建大纲骨架。`
  }
}
```

### 配置项

```typescript
// src/config/schema.ts
skills: z.object({
  "progressive-disclosure": z.object({
    enabled: z.boolean().default(true),
    minWords: z.number().default(200),
    enforceOutlineWorkflow: z.boolean().default(true),
  }).optional(),
})
```

---

## 依赖关系

```
变更 1 (Bug Fix)          变更 2 (Skill Integration)
       |                           |
       v                           v
todo-continuation-enforcer    builtin-skills/
       |                           |
       v                           v
  boulder-state (只读)      mdsel-enforcer hook
                                   |
                                   v
                             config/schema.ts
```

**两个变更相互独立，可以并行开发。**

---

## 验证策略

### 变更 1 测试

```typescript
describe("todo-continuation-enforcer", () => {
  it("should NOT trigger when boulderState is null", async () => {
    // 模拟无 boulder 状态
    // 验证不调用 readPlanProgress
    // 验证不触发 continuation
  })
  
  it("should still trigger when OpenCode TODO has incomplete items", async () => {
    // 模拟有 todo 但无 boulder
    // 验证仍然触发（保持原生功能）
  })
})
```

### 变更 2 测试

```typescript
describe("mdsel-enforcer", () => {
  it("should block Read for .md files >200 words", async () => {
    // 模拟读取大型 .md
    // 验证返回 block: true
  })
  
  it("should allow Read for small .md files", async () => {
    // 模拟读取小型 .md
    // 验证正常通过
  })
  
  it("should block Write for .md without outline workflow", async () => {
    // 验证强制 outline 工作流
  })
})
```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 过度触发仍然发生 | 完全 gate 所有 plan-progress 和 file-scan 路径 |
| UX 摩擦 | 200 words 阈值已足够宽松 |
| 强制性太激进 | 提供 `enabled` 配置项允许禁用 |
| 破坏现有工作流 | 添加完整测试覆盖 |
