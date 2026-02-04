# Batch 2: Schema/类型文件冲突解决 (3个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #14, #33, #34, #35

---

## 任务 2.1: 解决 src/config/schema.ts 冲突

**决策 #14, #33**: 合并两边 - 保留本地30个Hooks + 添加上游3个 + 保留本地Agents + 添加hephaestus

### 2.1.1 AgentNameSchema 合并

**操作**: 找到 `AgentNameSchema` 定义，合并为：

```typescript
export const AgentNameSchema = z.enum([
  // 上游 agents
  "oracle",
  "librarian", 
  "explore",
  "multimodal-looker",
  "hephaestus",  // 上游新增
  // 本地独有 agents (必须保留)
  "implementer",
  "archiver",
  "frontend-ui-ux-engineer",
  "document-writer",
  "observer",  // 本地独有 - Observer系统核心
])
```

### 2.1.2 HookNameSchema 合并

**操作**: 找到 `HookNameSchema` 定义，确保包含 33 个 hooks：

```typescript
export const HookNameSchema = z.enum([
  // 通用 hooks (两边共有)
  "todo-continuation-enforcer",
  "context-window-monitor",
  "comment-checker",
  // ... 其他共有 hooks
  
  // 上游新增 (3个)
  "unstable-agent-babysitter",
  "stop-continuation-guard", 
  "tasks-todowrite-disabler",  // 添加但不注册 (决策#3)
  
  // 本地独有 (30个，全部保留)
  "sisyphus-orchestrator",
  "tdd-guard",
  "debugging-injector",
  "failure-counter",
  "skill-suggestion",
  "planning-flow-guide",
  "lsp-diagnostics-enforcer",
  "subagent-verification",
  "codebase-assessment",
  "phase-flow-enforcer",
  "plan-reorganizer",
  "plan-update-reminder",
  "plan-attention-refresher",
  "mdsel-reminder",
  "mdsel-enforcer",
  "observation-recorder",
  "observer-detector",
  "instinct-trigger",
  "instinct-learner",
  "pattern-extraction",
  "observation-write-guard",
  "secret-scanner",
  "skill-auto-injector",
  "behavior-anchor",
  "verbosity-controller",
  "phase-rules-injector",
  "knowledge-injection",
  "project-context-injector",
  "pr-context-injector",
])
```

### 2.1.3 其他合并点

| 差异项 | 操作 |
|--------|------|
| Category `deep` | **采用上游** - 添加到 CategoryNameSchema |
| `defaultSkills` 字段 | **保留本地** - CategoryConfig 中保留此字段 |
| `is_unstable_agent` 注释 | **采用上游** - 改为 "gemini/minimax models" |
| Experimental 配置 | **采用上游** - 添加 `preemptive_compaction`, `task_system` |
| Browser Provider | **采用上游** - 添加 `dev-browser` |
| `BabysittingConfigSchema` | **采用上游** - 新增此 Schema |
| `McpTemplateConfigSchema` | **保留本地** - 本地版本更完整 |

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查 Agent 定义
grep -c "observer\|implementer\|hephaestus" src/config/schema.ts
# 期望: 3 (三个都存在)

# 检查 Hook 数量
grep -A 50 "HookNameSchema" src/config/schema.ts | grep -c '"'
# 期望: >= 33

git add src/config/schema.ts
```

**Must NOT**:
- ❌ 删除任何本地独有的 Agent 或 Hook
- ❌ 删除 `defaultSkills` 字段

---

## 任务 2.2: 解决 src/shared/model-requirements.ts 冲突

**决策 #34**: 采用上游新增 + 保留本地 observer

### 2.2.1 类型定义更新

**添加上游新增字段**:
```typescript
interface AgentRequirement {
  // 现有字段...
  requiresModel?: string        // 上游新增
  requiresAnyModel?: boolean    // 上游新增
}
```

### 2.2.2 Agent 配置合并

| Agent | 操作 |
|-------|------|
| `hephaestus` | **添加上游配置** - 需要 `gpt-5.2-codex` |
| `sisyphus` | **采用上游** - 添加 `kimi-k2.5-free` + `requiresAnyModel: true` |
| `explore` | **采用上游** - `grok-code-fast-1` 替代 `gpt-5-mini` |
| `multimodal-looker` | **采用上游** - 添加 `kimi-k2.5-free` |
| `librarian` | **采用上游** - `glm-4.7-free` 替代 `big-pickle` |
| `observer` | **保留本地** - 本地独有 Agent |

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查 hephaestus 配置存在
grep "hephaestus" src/shared/model-requirements.ts

# 检查 observer 配置保留
grep "observer" src/shared/model-requirements.ts

# 检查新字段
grep "requiresAnyModel" src/shared/model-requirements.ts

git add src/shared/model-requirements.ts
```

**Must NOT**:
- ❌ 删除 observer 配置

---

## 任务 2.3: 解决 src/plugin-config.ts 冲突

**决策 #35**: 采用上游 - 移除调试日志

**操作**: 找到冲突区域，删除 `console.error` 调试输出

**冲突内容** (约行 144-150):
```typescript
<<<<<<< HEAD
    console.error("DEBUG: config loaded", config)
    // 或其他调试代码
=======
>>>>>>> upstream/dev
```

**解决方式**: 接受上游（删除调试日志）
```bash
cd C:/github/oh-my-opencode-merge-lab

# 接受上游版本
git checkout --theirs src/plugin-config.ts
git add src/plugin-config.ts
```

**验证命令**:
```bash
# 确认无调试日志
grep -c "console.error.*DEBUG" src/plugin-config.ts
# 期望: 0
```

**Must NOT**:
- ❌ 保留调试日志

---

## Batch 2 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查这 3 个文件已解决
git status src/config/schema.ts src/shared/model-requirements.ts src/plugin-config.ts

# 类型检查这些文件
bun run typecheck 2>&1 | grep -E "schema|model-requirements|plugin-config"
# 期望: 无错误
```

---

## 执行顺序

1. ✅ 任务 2.1: schema.ts (最复杂，先处理)
2. ✅ 任务 2.2: model-requirements.ts
3. ✅ 任务 2.3: plugin-config.ts (最简单)
