# Batch 5: 功能模块冲突解决 (5个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #17, #23, #25, #37, #44

---

## 任务 5.1: 解决 src/features/background-agent/manager.ts 冲突

**决策 #23**: 采用上游所有改进

### 5.1.1 上游改进 (全部采用)

| 改进 | 操作 |
|------|------|
| 常量导入 | 改为从 `constants.ts` 导入 |
| onShutdown 回调 | 添加优雅关闭支持 |
| completionTimers | 添加定时器管理 Map |
| Concurrency 槽位泄漏修复 | 采用上游的错误时释放槽位逻辑 |
| Question 权限拒绝 | 子代理默认拒绝 question |
| Variant 处理 | variant 必须顶层字段 |
| promptWithModelSuggestionRetry | 添加模型建议重试 |
| cancelTask 增强 | 添加新选项 |

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 主要采用上游版本，但检查本地是否有独有逻辑
git checkout --theirs src/features/background-agent/manager.ts

# 如果本地有 handover-protocol 引用，需手动合并
grep "handover-protocol" src/features/background-agent/manager.ts
```

**验证命令**:
```bash
grep "onShutdown" src/features/background-agent/manager.ts
grep "completionTimers" src/features/background-agent/manager.ts
grep "POLLING_INTERVAL_MS" src/features/background-agent/manager.ts

git add src/features/background-agent/manager.ts
```

**Must NOT**:
- ❌ 丢失并发槽位泄漏修复

---

## 任务 5.2: 解决 src/tools/delegate-task/*.ts 冲突

**决策 #17**: 采用上游模块化结构

### 5.2.1 上游模块化结构

```
src/tools/delegate-task/
├── executor.ts      (979 行)  ← 核心执行逻辑
├── constants.ts     (527 行)  ← 常量 + Category Prompts
├── tools.ts         (173 行)  ← 工具入口
├── categories.ts    (71 行)   ← Category 配置解析
├── helpers.ts       (100 行)  ← 辅助函数
├── prompt-builder.ts (32 行)  ← Prompt 构建
├── timing.ts        (39 行)   ← 时间配置
├── types.ts         (51 行)   ← 类型定义
├── tools.test.ts    (2783 行) ← 完整测试
└── index.ts         (4 行)    ← 导出
```

### 5.2.2 冲突文件处理

**tools.ts**: 采用上游模块化入口
```bash
git checkout --theirs src/tools/delegate-task/tools.ts
```

**constants.ts**: 合并两边
- 采用上游的 Category Prompts 扩展
- 保留本地 `defaultSkills` 字段
- 保留本地 `most-capable` 和 `general` categories

**tools.test.ts**: 采用上游 (更完整的测试覆盖)
```bash
git checkout --theirs src/tools/delegate-task/tools.test.ts
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查模块结构
ls src/tools/delegate-task/

# 检查 Category Prompts
grep "VISUAL_CATEGORY\|ULTRABRAIN_CATEGORY" src/tools/delegate-task/constants.ts

git add src/tools/delegate-task/
```

**Must NOT**:
- ❌ 破坏模块化结构
- ❌ 删除本地 `defaultSkills` 字段

---

## 任务 5.3: 解决 src/features/builtin-skills/skills.ts 冲突

**决策 #25, #44**: 保留本地缓存机制 + 采用上游模块化

### 5.3.1 本地独有内容 (保留)

```typescript
// 必须保留的本地功能
const builtinSkillTemplateCache = new Map<string, string>()
function readBuiltinSkillTemplate(skillName: string): string | null { ... }
const sourceSkillRoot = ...  // 开发路径支持
```

### 5.3.2 本地独有 Skills (15+个，必须保留)

确保以下 skills 在合并后仍然可用：
- `brainstorming`
- `creating-changes`
- `verification-before-completion`
- `using-git-worktrees`
- `dispatching-parallel-agents`
- `subagent-driven-development`
- `tdd`
- `test-driven-development`
- `systematic-debugging`
- `requesting-code-review`
- `receiving-code-review`
- `collaborating-with-codex`
- `collaborating-with-gemini`
- `finishing-a-development-branch`
- `archiving-changes`
- `writing-skills`
- `security-audit`

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查缓存机制保留
grep "builtinSkillTemplateCache" src/features/builtin-skills/skills.ts

# 检查本地 skills 存在
grep "brainstorming\|creating-changes\|tdd" src/features/builtin-skills/skills.ts

git add src/features/builtin-skills/skills.ts
```

**Must NOT**:
- ❌ 删除 `builtinSkillTemplateCache`
- ❌ 删除 `readBuiltinSkillTemplate()`
- ❌ 删除任何本地独有 skill

---

## 任务 5.4: 解决 src/tools/background-task/tools.ts 冲突

**决策 #37**: 保留本地 metadata + 采用上游 full_session

### 5.4.1 合并内容

**冲突区域** (行 550-566):
```typescript
// 保留本地
ctx.metadata = { ... }  // UI 需要

// 添加上游
const fullSession = formatFullSession(...)  // 新功能
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "ctx.metadata" src/tools/background-task/tools.ts
grep "formatFullSession\|full_session" src/tools/background-task/tools.ts

git add src/tools/background-task/tools.ts
```

**Must NOT**:
- ❌ 删除 `ctx.metadata` (UI 功能需要)

---

## 任务 5.5: 解决 src/features/builtin-commands/ 冲突

**相关文件**:
- `commands.ts`
- `types.ts`

### 5.5.1 types.ts 合并

**决策 #49**: 合并两边命令类型

```typescript
export type BuiltinCommandName =
  | "init-deep" | "ralph-loop" | "cancel-ralph" | "ulw-loop"
  | "refactor" | "start-work"
  // 本地独有 (8个)
  | "status" | "revert" | "evolve"
  | "instinct-import" | "instinct-export"
  | "instinct-status" | "build-fix" | "learn"
  // 上游新增
  | "stop-continuation"
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "stop-continuation" src/features/builtin-commands/types.ts
grep "instinct-import\|evolve" src/features/builtin-commands/types.ts

git add src/features/builtin-commands/
```

---

## Batch 5 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有功能模块文件已解决
git status src/features/background-agent/ src/tools/delegate-task/ src/features/builtin-skills/ src/tools/background-task/ src/features/builtin-commands/

# 验证无冲突标记
grep -r "<<<<<<" src/features/ src/tools/delegate-task/ | head -5
# 期望: 无输出
```

---

## 执行顺序

1. ✅ 任务 5.1: background-agent/manager.ts
2. ✅ 任务 5.2: delegate-task/*.ts
3. ✅ 任务 5.3: builtin-skills/skills.ts
4. ✅ 任务 5.4: background-task/tools.ts
5. ✅ 任务 5.5: builtin-commands/
