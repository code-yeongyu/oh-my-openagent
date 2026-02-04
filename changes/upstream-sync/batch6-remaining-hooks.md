# Batch 6: 剩余Hooks冲突解决 (10个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #27, #28, #29, #38, #39, #40, #47, #48

---

## 任务 6.1: 解决 src/hooks/keyword-detector/constants.ts 冲突

**决策 #38**: 采用上游模块化 + 保留本地检测器

### 6.1.1 本地独有内容 (保留)

```typescript
// 必须保留
const PROMETHEUS_PLANNING_CONTEXT = `...`  // ~50行规划上下文
function isPlannerAgent() { ... }
// brainstorm-mode 检测器
// consult-metis-mode 检测器
// 扩展 analyze 正则 (中/日/韩/越语)
```

### 6.1.2 上游改进 (采用)

```typescript
// 采用上游
type KeywordDetector = { ... }  // 类型定义
// 模块化导出结构 (./ultrawork, ./search, ./analyze)
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "PROMETHEUS_PLANNING_CONTEXT" src/hooks/keyword-detector/constants.ts
grep "isPlannerAgent" src/hooks/keyword-detector/constants.ts
grep "brainstorm-mode\|consult-metis" src/hooks/keyword-detector/constants.ts

git add src/hooks/keyword-detector/
```

**Must NOT**:
- ❌ 删除 `PROMETHEUS_PLANNING_CONTEXT`
- ❌ 删除本地独有检测器

---

## 任务 6.2: 解决 src/hooks/todo-continuation-enforcer.ts 冲突

**决策 #39**: 采用上游改进

### 6.2.1 上游改进 (采用)

| 改进 | 操作 |
|------|------|
| Prompt 格式 | 采用上游详细格式 + 任务列表 |
| `isContinuationStopped` | 添加停止检查支持 |

**操作**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 主要采用上游版本
git checkout --theirs src/hooks/todo-continuation-enforcer.ts
git add src/hooks/todo-continuation-enforcer.ts
```

**验证命令**:
```bash
grep "isContinuationStopped" src/hooks/todo-continuation-enforcer.ts
```

---

## 任务 6.3: 解决 src/hooks/compaction-context-injector/index.ts 冲突

**决策 #40**: 合并两边 Section 定义

### 6.3.1 合并 Section 7 和 8

**本地 Section 7** (保留):
```
Todo List Preservation (CRITICAL)
- DO NOT modify the todo list during compaction
- Preserve ALL existing todo items
```

**上游 Section 7** → 改为 Section 8:
```
Agent Verification State (Critical for Reviewers)
- Current Agent, Verification Progress
- Previous Rejections, Acceptance Status
```

**合并后**:
- Section 7: Todo List Preservation (本地)
- Section 8: Agent Verification State (上游)

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep -A 3 "Section 7" src/hooks/compaction-context-injector/index.ts
grep -A 3 "Section 8" src/hooks/compaction-context-injector/index.ts

git add src/hooks/compaction-context-injector/
```

---

## 任务 6.4: 解决 src/hooks/interactive-bash-session/index.ts 冲突

**决策 #47**: 保留本地 Windows 平台检查

### 6.4.1 必须保留的内容

```typescript
// 本地独有 - Windows 平台兼容性
if (process.platform === "win32") {
  return {
    "tool.execute.after": async () => {},
    event: async () => {},
  }
}
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "win32" src/hooks/interactive-bash-session/index.ts

git add src/hooks/interactive-bash-session/index.ts
```

**Must NOT**:
- ❌ 删除 Windows 平台检查

---

## 任务 6.5: 解决 src/hooks/prometheus-md-only/*.ts 冲突

**决策 #29**: 保留本地复数常量 + 采用上游提醒

### 6.5.1 constants.ts 合并

**保留本地**:
```typescript
export const PROMETHEUS_AGENTS = [...]  // 复数形式，支持多个
export const ALLOWED_PATH_PREFIXES = ["changes/", ".sisyphus/"]  // 多路径
```

**采用上游**:
```typescript
export const PROMETHEUS_WORKFLOW_REMINDER = `...`  // 新增提醒
```

### 6.5.2 index.ts 合并

确保使用 `ALLOWED_PATH_PREFIXES.some()` 进行路径验证

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "PROMETHEUS_AGENTS" src/hooks/prometheus-md-only/constants.ts
grep "ALLOWED_PATH_PREFIXES" src/hooks/prometheus-md-only/constants.ts
grep "PROMETHEUS_WORKFLOW_REMINDER" src/hooks/prometheus-md-only/constants.ts

git add src/hooks/prometheus-md-only/
```

**Must NOT**:
- ❌ 改为单数形式常量
- ❌ 删除 `changes/` 路径支持

---

## 任务 6.6: 解决 src/hooks/atlas/index.ts 冲突

**决策 #27**: 保留本地独有内容 + 采用上游 undefined guard

### 6.6.1 本地独有内容 (保留)

| 内容 | 行数 | 理由 |
|------|------|------|
| EXECUTION_MODE_AUTO_DECISION | 24行 | 自动选择 Sequential/Wave |
| ARCHIVER_DISPATCH_PROMPT | 70行 | Phase 3 完成流程 |
| VERIFICATION_REMINDER | 55行 | 强制 LSP_DIAGNOSTICS 验证 |
| buildOrchestratorReminder | 30行 | Boulder 状态追踪 |
| Skill phase tracking | 20行 | brainstorming→planning |
| Phase enforcement | 25行 | 阻止执行阶段调用规划 agents |
| Blocked response retry logic | 50行 | incrementRetry, isMaxRetries |

### 6.6.2 上游改进 (采用)

```typescript
// 在 tool.execute.after 开头添加
if (output === undefined) {
  return  // Guard against undefined (issue #1035)
}
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "EXECUTION_MODE_AUTO_DECISION" src/hooks/atlas/index.ts
grep "ARCHIVER_DISPATCH" src/hooks/atlas/index.ts
grep "output === undefined" src/hooks/atlas/index.ts

git add src/hooks/atlas/
```

**Must NOT**:
- ❌ 删除任何本地独有内容

---

## 任务 6.7: 解决 src/features/builtin-commands/commands.ts 冲突

**决策 #28**: 保留本地8个命令 + 添加上游1个

### 6.7.1 本地独有命令 (保留)

```typescript
const BUILTIN_COMMANDS = {
  // ... 共有命令
  
  // 本地独有 (8个)
  "status": STATUS_TEMPLATE,
  "revert": REVERT_TEMPLATE,
  "evolve": EVOLVE_TEMPLATE,
  "instinct-import": INSTINCT_IMPORT_TEMPLATE,
  "instinct-export": INSTINCT_EXPORT_TEMPLATE,
  "instinct-status": INSTINCT_STATUS_TEMPLATE,
  "build-fix": BUILD_FIX_TEMPLATE,
  "learn": LEARN_TEMPLATE,
}
```

### 6.7.2 上游新增命令 (添加)

```typescript
// 添加上游新增
"stop-continuation": STOP_CONTINUATION_TEMPLATE,
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "status\|revert\|evolve" src/features/builtin-commands/commands.ts
grep "stop-continuation" src/features/builtin-commands/commands.ts

git add src/features/builtin-commands/
```

**Must NOT**:
- ❌ 删除任何本地独有命令

---

## 任务 6.8-6.10: 其他 Hooks 冲突

### 6.8 hooks/start-work/index.test.ts
- 采用上游测试覆盖

### 6.9 hooks/rules-injector/finder.test.ts
- 采用上游测试覆盖

### 6.10 其他测试文件
- 见 Batch 7

**操作**:
```bash
cd C:/github/oh-my-opencode-merge-lab

git checkout --theirs src/hooks/start-work/index.test.ts
git checkout --theirs src/hooks/rules-injector/finder.test.ts
git add src/hooks/start-work/ src/hooks/rules-injector/
```

---

## Batch 6 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有 hooks 文件已解决
git status src/hooks/

# 验证无冲突标记
grep -r "<<<<<<" src/hooks/ | head -5
# 期望: 无输出
```

---

## 执行顺序

1. ✅ 任务 6.1: keyword-detector/constants.ts
2. ✅ 任务 6.2: todo-continuation-enforcer.ts
3. ✅ 任务 6.3: compaction-context-injector/index.ts
4. ✅ 任务 6.4: interactive-bash-session/index.ts
5. ✅ 任务 6.5: prometheus-md-only/*.ts
6. ✅ 任务 6.6: atlas/index.ts (最复杂)
7. ✅ 任务 6.7: builtin-commands/commands.ts
8. ✅ 任务 6.8-6.10: 测试文件
