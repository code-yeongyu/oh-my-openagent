# Upstream Sync Plan: v3.0.1 → v3.2.2

## Context

### Original Request
同步 fork 项目与上游原项目 `code-yeongyu/oh-my-opencode` 的最新进展，从 v3.0.1 更新到 v3.2.2。

### Interview Summary
**Key Discussions**:
- 本地 dev 分支落后上游 263 commits
- 本地有 69 个独特的二次开发 commits
- 876 文件变更，规模巨大
- 跨越 14 个版本 (v3.1.1 → v3.2.2)

**Research Findings**:
- 上游新增实验性 Task 系统（可能与本地 Todo 改动冲突）
- 双方都修改了 background-agent, delegate-task, prometheus
- 上游重构了 Atlas agent 为模块化目录结构

### Metis Review
**Identified Gaps** (addressed):
- 需要明确冲突优先级规则（上游 vs 本地）
- 需要回滚/备份策略
- 需要锁定范围，避免顺带重构

---

## Work Objectives

### Core Objective
将本地 fork 与上游 code-yeongyu/oh-my-opencode 同步，保留本地二次开发功能。

### Concrete Deliverables
- 成功合并 upstream/dev 到本地 dev
- 保留所有本地独特功能
- 通过所有测试
- 版本号自动继承上游 (不手动修改 package.json version 字段)

### Definition of Done
- [x] `git log` 显示包含上游 v3.2.2 release commit (91fd983)
- [x] `bun run typecheck` 通过
- [~] `bun test` 通过 (超时，需单独排查)
- [x] 本地独特功能可用:
  - Observer agent: `grep "createObserverAgent" src/agents/observer.ts` 返回匹配
  - Observer detector: `grep "createObserverDetectorHook" src/hooks/observer-detector/index.ts` 返回匹配
  - Observation recorder: `test -f src/hooks/observation-recorder/index.ts && echo OK`
  - Instinct learner: `test -f src/hooks/instinct-learner/index.ts && echo OK`
  - Instinct trigger: `test -f src/hooks/instinct-trigger/index.ts && echo OK`
  - Boulder state: `grep "readBoulderState" src/features/boulder-state/storage.ts` 返回匹配

### Must Have
- 完整的备份分支
- 冲突解决记录 → `changes/upstream-sync/conflicts.md`
- 本地功能保留

### Must NOT Have (Guardrails)
- ❌ 不删除本地功能（除非明确批准）
- ❌ 不进行"顺便"重构
- ❌ 不修改发布流程
- ❌ 不改动 master 分支

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **User wants tests**: YES (after merge)
- **Framework**: bun test

### Manual QA
合并后需验证本地独特功能仍然工作。

---

## Risk Assessment

### Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| 大量合并冲突 | High | High | 逐模块合并，每步验证 |
| 本地功能丢失 | Medium | High | 备份分支 + 功能清单 |
| 测试失败 | Medium | Medium | 分阶段验证 |
| 构建失败 | Medium | High | 每步 typecheck |

### Breaking Changes
- 上游 Task 系统可能与本地 Todo/Boulder 冲突
- Atlas agent 重构可能影响本地 agent 注册
- Config schema 变更可能需要迁移

### Rollback Strategy
- 合并前创建 `backup/pre-upstream-sync` 分支
- 任何步骤失败可 `git merge --abort` 或 `git reset --hard backup/pre-upstream-sync`

---

## Conflict Precedence Rules

| 模块 | 优先级 | 原因 | 实际路径 |
|------|--------|------|----------|
| Task 系统 | Upstream | 新 Task 系统，本地无对应 | `src/tools/task/` (上游新增) |
| Prometheus prompt | Upstream | 上游优化更成熟 | `src/agents/prometheus-prompt.ts` |
| Atlas agent | Upstream | 上游可能重构为目录 | `src/agents/atlas.ts` (本地是单文件) |
| Background agent | **Merge** | 双方都有重要改动 | `src/features/background-agent/manager.ts` 等 8 文件 |
| Observer agent | **Local** | 本地独特功能 | `src/agents/observer.ts`, `src/agents/observer.test.ts` |
| Observer detector hook | **Local** | 本地独特功能 | `src/hooks/observer-detector/index.ts` |
| Boulder state | **Merge** | Todo/Boulder 解耦需保留 | `src/features/boulder-state/storage.ts` 等 |
| Progressive disclosure | **Local** | 本地独特功能 | `src/features/builtin-skills/progressive-disclosure-md/SKILL.md` |

---

## Task Flow

```
Phase 0 (Preparation)
    ↓
Phase 1 (Merge)
    ↓
Phase 2 (Conflict Resolution) ← 核心工作
    ↓
Phase 3 (Verification)
    ↓
Phase 4 (Cleanup)
```

---


## TODOs (基于 decisions.md 的详细执行计划)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`

# Batch 1: 配置文件冲突解决 (4个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #50-#53

---

- [x] **Task 1.1**: 解决 .gitignore 冲突

**决策 #50**: 合并两边

**当前冲突内容**:
```gitignore
<<<<<<< HEAD
# Worktrees
.worktrees/
=======
*.bun-build
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 查看冲突内容
git diff .gitignore

# 2. 手动编辑 .gitignore，合并两边内容
# 找到冲突标记，替换为：
```

**合并后内容** (替换冲突标记):
```gitignore
# Worktrees
.worktrees/

# Bun build artifacts
*.bun-build
```

**验证命令**:
```bash
grep -E "worktrees|bun-build" .gitignore
# 期望: 两行都存在

git add .gitignore
```

**Must NOT**:
- ❌ 删除任何一边的内容
- ❌ 只选择其中一边

---

- [x] **Task 1.2**: 解决 package.json 冲突

**决策 #51**: 保留本地依赖 + 采用上游固定版本

**当前冲突内容** (devDependencies 部分):
```json
<<<<<<< HEAD
    "bun-types": "latest",
    "mdast-util-gfm": "^3.1.0",
    ... (8个mdast依赖)
=======
    "bun-types": "1.3.6",
    "typescript": "^5.7.3"
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 打开 package.json 编辑
# 2. 找到 devDependencies 冲突区域
# 3. 替换为合并内容
```

**合并后内容** (devDependencies 部分):
```json
"devDependencies": {
    "bun-types": "1.3.6",
    "mdast-util-gfm": "^3.1.0",
    "mdast-util-to-markdown": "^2.1.2",
    "mdast-util-to-string": "^4.0.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "typescript": "^5.7.3",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.1.0",
    "unist-util-visit-parents": "^6.0.2"
}
```

**关键点**:
- `bun-types`: 改为 `1.3.6` (上游固定版本)
- 保留所有 8 个 mdast/remark 依赖 (mdsel 功能需要)

**验证命令**:
```bash
# 检查 JSON 语法
cat package.json | jq . > /dev/null && echo "JSON valid"

# 检查关键依赖
grep "bun-types" package.json  # 应显示 1.3.6
grep "mdast-util-gfm" package.json  # 应存在

git add package.json
```

**Must NOT**:
- ❌ 删除 mdast 依赖 (mdsel 功能会失效)
- ❌ 保留 `"bun-types": "latest"` (不稳定)

---

- [x] **Task 1.3**: 解决 bun.lock 冲突

**决策 #52**: 删除后重新生成

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 必须先完成 package.json 解决 (任务 1.2)

# 2. 接受上游版本 (会被重新生成覆盖)
git checkout --theirs bun.lock

# 3. 重新安装依赖生成新 lock 文件
bun install

# 4. 添加到暂存区
git add bun.lock
```

**验证命令**:
```bash
# 检查 bun install 成功
echo $?  # 应为 0

# 检查 lock 文件生成
test -f bun.lock && echo "bun.lock exists"
```

**Must NOT**:
- ❌ 手动编辑 bun.lock
- ❌ 在 package.json 解决前执行

---

- [x] **Task 1.4**: 解决 tsconfig.json 冲突

**决策 #53**: 合并两边

**当前冲突内容**:
```json
<<<<<<< HEAD
  "exclude": ["node_modules", "dist", "src/features/builtin-skills/mdsel/cli-src"]
=======
  "exclude": ["node_modules", "dist", "**/*.test.ts", "script"]
>>>>>>> upstream/dev
```

**操作步骤**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 1. 打开 tsconfig.json 编辑
# 2. 找到 exclude 冲突区域
# 3. 替换为合并内容
```

**合并后内容**:
```json
"exclude": [
  "node_modules",
  "dist",
  "src/features/builtin-skills/mdsel/cli-src",
  "**/*.test.ts",
  "script"
]
```

**验证命令**:
```bash
# 检查 JSON 语法
cat tsconfig.json | jq . > /dev/null && echo "JSON valid"

# 检查所有 exclude 项
grep -A 10 '"exclude"' tsconfig.json

git add tsconfig.json
```

**Must NOT**:
- ❌ 删除 `mdsel/cli-src` (本地功能需要)
- ❌ 删除 `**/*.test.ts` 或 `script` (上游优化)

---

## Batch 1 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查这 4 个文件已解决
git status .gitignore package.json bun.lock tsconfig.json

# 期望输出: 全部显示 "modified" 或 "new file"，无 "both modified"

# 运行 bun install 确认依赖正常
bun install

# 类型检查 (可选，等所有冲突解决后再做)
# bun run typecheck
```

---

## 执行顺序

1. ✅ 任务 1.1: .gitignore
2. ✅ 任务 1.2: package.json (必须在 1.3 之前)
3. ✅ 任务 1.3: bun.lock (依赖 1.2)
4. ✅ 任务 1.4: tsconfig.json
# Batch 2: Schema/类型文件冲突解决 (3个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #14, #33, #34, #35

---

- [x] **Task 2.1**: 解决 src/config/schema.ts 冲突

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

- [x] **Task 2.2**: 解决 src/shared/model-requirements.ts 冲突

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

- [x] **Task 2.3**: 解决 src/plugin-config.ts 冲突

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
# Batch 3: Agents核心文件冲突解决 (4个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #26, #42, #43, #46

---

- [x] **Task 3.1**: 解决 src/agents/utils.ts 冲突

**决策 #42**: 采用上游模块化 + 保留本地 observer

### 3.1.1 导入合并

**冲突区域** (行 13-24):

```typescript
// 采用上游模块化导入
import { getPrometheusPromptSource } from "./prometheus"  // 上游模块化
import { createObserverAgent } from "./observer"  // 保留本地
import { createHephaestusAgent } from "./hephaestus"  // 上游新增
```

### 3.1.2 agentSources 合并

**确保包含**:
```typescript
export const agentSources = {
  // 上游 agents
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  hephaestus: createHephaestusAgent,  // 上游新增
  
  // 本地独有 agents (必须保留)
  observer: createObserverAgent,  // 本地独有
  implementer: createImplementerAgent,
  archiver: createArchiverAgent,
  "frontend-ui-ux-engineer": createFrontendEngineerAgent,
  "document-writer": createDocumentWriterAgent,
}
```

### 3.1.3 agentMetadata 合并

**合并两边的 metadata**:
```typescript
export const agentMetadata = {
  // 上游新增
  metis: METIS_PROMPT_METADATA,
  momus: MOMUS_PROMPT_METADATA,
  atlas: ATLAS_PROMPT_METADATA,
  // 本地保留
  prometheus: PROMETHEUS_PROMPT_METADATA,
}
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "createObserverAgent" src/agents/utils.ts  # 本地保留
grep "createHephaestusAgent" src/agents/utils.ts  # 上游新增
grep "PROMETHEUS_PROMPT_METADATA" src/agents/utils.ts  # 本地保留

git add src/agents/utils.ts
```

**Must NOT**:
- ❌ 删除 observer 相关导入和注册
- ❌ 删除 PROMETHEUS_PROMPT_METADATA

---

- [x] **Task 3.2**: 解决 src/agents/momus.ts 冲突

**决策 #43**: 保留本地严格审查 + 采用上游实用改进

### 3.2.1 保留本地内容

| 内容 | 理由 |
|------|------|
| `changes/` + `.sisyphus/` 双路径支持 | 本地路径兼容 |
| 7步详细提取算法 | 更严格的验证 |
| ADHD 作者上下文 | 历史数据有价值 |

### 3.2.2 采用上游改进

| 改进 | 操作 |
|------|------|
| APPROVAL BIAS | 添加 "When in doubt, APPROVE" 原则 |
| Max 3 issues | 添加 "每次拒绝最多3个问题" 规则 |

**合并策略**:
1. 保留本地 prompt 的主体结构
2. 在适当位置添加上游的 APPROVAL BIAS 和 Max 3 issues
3. 确保双路径支持 (`changes/` 和 `.sisyphus/`)

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "changes/" src/agents/momus.ts  # 本地路径保留
grep -i "approval" src/agents/momus.ts  # 上游改进
grep "3 issues\|three issues" src/agents/momus.ts  # 上游改进

git add src/agents/momus.ts
```

**Must NOT**:
- ❌ 删除 `changes/` 路径支持
- ❌ 删除 7步提取算法

---

- [x] **Task 3.3**: 解决 src/agents/sisyphus.ts 冲突

**决策 #26**: 保留本地大部分内容 + 采用上游结构改进

### 3.3.1 本地独有内容 (必须保留)

| 内容 | 行数 | 理由 |
|------|------|------|
| Skill Discipline | ~60行 | 严格的 Skill 使用纪律 |
| Red Flags 表格 | ~15行 | 防止跳过 Skills |
| Skill Priority | ~15行 | Process skills first |
| Risk-Tiered TDD Enforcement | ~15行 | Tier 0-3 TDD 分级 |
| Pre-Delegation Planning | ~80行 | 4-part declaration 格式 |
| ImplementerTaskContext 模板 | ~50行 | 标准化委托格式 |
| Execution Mode Auto-Selection | ~30行 | ≤5=Sequential, >5=Wave |
| Phase 3 Completion Flow | ~60行 | Archiver dispatch 流程 |

### 3.3.2 上游改进 (采用)

| 改进 | 操作 |
|------|------|
| 结构化 Prompt | 采用 CONTEXT+GOAL+QUESTION+REQUEST 格式 |
| buildTaskManagementSection | 采用 Task/Todo 双模式支持 |
| 动态 Prompt Builder | 采用更模块化的导入 |

**合并策略**:
1. 保留本地所有 Skill Discipline 和 TDD Enforcement
2. 采用上游的 `buildTaskManagementSection` 函数
3. 更新 `delegate_task` 调用语法为上游格式

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

grep "Skill Discipline\|SKILL DISCIPLINE" src/agents/sisyphus.ts
grep "Risk-Tiered\|Tier 0\|Tier 1" src/agents/sisyphus.ts
grep "buildTaskManagementSection" src/agents/sisyphus.ts

git add src/agents/sisyphus.ts
```

**Must NOT**:
- ❌ 删除 Skill Discipline 部分
- ❌ 删除 Risk-Tiered TDD Enforcement
- ❌ 删除 Pre-Delegation Planning 格式

---

- [x] **Task 3.4**: 解决 src/agents/atlas/default.ts 冲突

**决策 #46**: 采用上游模块化结构

### 3.4.1 模块化适配

上游将 `atlas.ts` 拆分为:
- `atlas/index.ts` - 主入口
- `atlas/default.ts` - Claude 优化 prompt
- `atlas/gpt.ts` - GPT 优化 prompt
- `atlas/utils.ts` - 工具函数

### 3.4.2 本地内容迁移

**需要确认上游模块包含**:
1. `getDefaultAtlasPrompt()` 或等效函数
2. `createAtlasAgent()` 或等效函数
3. `atlasPromptMetadata` 或等效定义

**如果上游缺失，需手动添加本地逻辑到上游模块**

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查模块结构
ls -la src/agents/atlas/

# 检查主要函数存在
grep "getAtlasPromptSource\|createAtlasAgent" src/agents/atlas/index.ts

git add src/agents/atlas/
```

**Must NOT**:
- ❌ 破坏模块化结构
- ❌ 删除 Atlas 核心功能

---

## Batch 3 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有 agents 文件已解决
git status src/agents/utils.ts src/agents/momus.ts src/agents/sisyphus.ts src/agents/atlas/

# 验证关键功能
grep "observer" src/agents/utils.ts
grep "hephaestus" src/agents/utils.ts
```

---

## 执行顺序

1. ✅ 任务 3.1: utils.ts (入口文件)
2. ✅ 任务 3.2: momus.ts
3. ✅ 任务 3.3: sisyphus.ts (最复杂)
4. ✅ 任务 3.4: atlas/default.ts
# Batch 4: Hooks入口文件冲突解决 (3个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #30, #36, #41

---

- [x] **Task 4.1**: 解决 src/hooks/index.ts 冲突

**决策 #36**: 保留本地30+导出 + 添加上游6个导出

### 4.1.1 本地独有导出 (必须保留)

```typescript
// TDD 系统
export { createTddGuardHook } from "./tdd-guard"

// 调试系统
export { createDebugInjectorHook } from "./debugging-injector"
export { createFailureCounterHook } from "./failure-counter"

// 规划系统
export { createPlanningFlowGuideHook } from "./planning-flow-guide"
export { createPhaseFlowEnforcerHook } from "./phase-flow-enforcer"
export { createPlanReorganizerHook } from "./plan-reorganizer"
export { createPlanUpdateReminderHook } from "./plan-update-reminder"
export { createPlanAttentionRefresherHook } from "./plan-attention-refresher"

// Observer 系统 (5个)
export { createObservationRecorderHook } from "./observation-recorder"
export { createObserverDetectorHook } from "./observer-detector"
export { createInstinctTriggerHook } from "./instinct-trigger"
export { createInstinctLearnerHook } from "./instinct-learner"
export { createPatternExtractionHook } from "./pattern-extraction"

// mdsel 系统
export { createMdselReminderHook } from "./mdsel-reminder"
export { createMdselEnforcerHook } from "./mdsel-enforcer"

// 其他本地独有
export { createSecretScannerHook } from "./secret-scanner"
export { createVerbosityControllerHook } from "./verbosity-controller"
export { createSkillAutoInjectorHook } from "./skill-auto-injector"
export { createBehaviorAnchorHook } from "./behavior-anchor"
export { createPhaseRulesInjectorHook } from "./phase-rules-injector"
export { createKnowledgeInjectionHook } from "./knowledge-injection"
export { createProjectContextInjectorHook } from "./project-context-injector"
export { createPrContextInjectorHook } from "./pr-context-injector"
export { createObservationWriteGuardHook } from "./observation-write-guard"
export { createNotepadWriteGuardHook } from "./notepad-write-guard"
export { createSubagentVerificationHook } from "./subagent-verification"
export { createCodebaseAssessmentHook } from "./codebase-assessment"
export { createLspDiagnosticsEnforcerHook } from "./lsp-diagnostics-enforcer"
export { createSkillSuggestionHook } from "./skill-suggestion"
export { createSisyphusOrchestratorHook } from "./sisyphus-orchestrator"
```

### 4.1.2 上游新增导出 (添加)

```typescript
// 上游新增 (6个)
export { createSubagentQuestionBlockerHook } from "./subagent-question-blocker"
export { createStopContinuationGuardHook } from "./stop-continuation-guard"
export { createCompactionContextInjector } from "./compaction-context-injector"
export { createUnstableAgentBabysitterHook } from "./unstable-agent-babysitter"
export { createPreemptiveCompactionHook } from "./preemptive-compaction"
export { createTasksTodowriteDisablerHook } from "./tasks-todowrite-disabler"
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查本地独有导出
grep "createObserverDetectorHook" src/hooks/index.ts
grep "createTddGuardHook" src/hooks/index.ts

# 检查上游新增导出
grep "createStopContinuationGuardHook" src/hooks/index.ts
grep "createUnstableAgentBabysitterHook" src/hooks/index.ts

git add src/hooks/index.ts
```

**Must NOT**:
- ❌ 删除任何本地独有的 hook 导出
- ❌ 删除 Observer 系统的 5 个导出

---

- [x] **Task 4.2**: 解决 src/index.ts (主入口) 冲突

**决策 #41**: 保留本地30个导入 + 添加上游6个导入

### 4.2.1 Hook 导入合并 (行 36-73)

**本地独有导入 (保留)**:
```typescript
import {
  createTddGuardHook,
  createDebugInjectorHook,
  createFailureCounterHook,
  createPlanningFlowGuideHook,
  createPhaseFlowEnforcerHook,
  createPlanReorganizerHook,
  createObservationRecorderHook,
  createObserverDetectorHook,
  createInstinctTriggerHook,
  createInstinctLearnerHook,
  createPatternExtractionHook,
  createSecretScannerHook,
  createVerbosityControllerHook,
  // ... 其他本地独有 hooks
} from "./hooks"
```

**上游新增导入 (添加)**:
```typescript
import {
  createSubagentQuestionBlockerHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createUnstableAgentBabysitterHook,
  createPreemptiveCompactionHook,
  createTasksTodowriteDisablerHook,
} from "./hooks"
```

### 4.2.2 Hook 注册合并

**确保所有 hooks 在 `createPlugin()` 中注册**:
- 本地 30 个 hooks 注册
- 上游 6 个 hooks 注册
- 注意：`tasks-todowrite-disabler` 添加但**不注册** (决策 #3)

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查导入
grep "createObserverDetectorHook" src/index.ts
grep "createStopContinuationGuardHook" src/index.ts

# 检查 tasks-todowrite-disabler 不被调用
grep -c "tasksToDowriteDisabler\|TodowriteDisabler" src/index.ts
# 期望: 0 或只有注释

git add src/index.ts
```

**Must NOT**:
- ❌ 删除本地 hooks 的导入和注册
- ❌ 注册 `tasks-todowrite-disabler` (保持 TodoWrite 可用)

---

- [x] **Task 4.3**: 解决 src/shared/index.ts 冲突

**决策 #30**: 保留本地9个导出 + 添加上游1个导出

### 4.3.1 本地独有导出 (保留)

```typescript
// 本地独有 (9个)
export * from "./skill-reminder-generator"
export * from "./blocked-task-detector"
export * from "./test-quality-gate"
export * from "./slop-detector"
export * from "./relevance-scorer"
export * from "./anti-pattern-tracker"
export * from "./isolation-checker"
export * from "./ast-coverage-checker"
export * from "./part-factory"
```

### 4.3.2 上游新增导出 (添加)

```typescript
// 上游新增
export * from "./model-suggestion-retry"
```

**验证命令**:
```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查本地独有
grep "skill-reminder-generator" src/shared/index.ts
grep "slop-detector" src/shared/index.ts

# 检查上游新增
grep "model-suggestion-retry" src/shared/index.ts

git add src/shared/index.ts
```

**Must NOT**:
- ❌ 删除任何本地独有的模块导出

---

## Batch 4 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有入口文件已解决
git status src/hooks/index.ts src/index.ts src/shared/index.ts

# 验证无冲突标记
grep -l "<<<<<<" src/hooks/index.ts src/index.ts src/shared/index.ts
# 期望: 无输出
```

---

## 执行顺序

1. ✅ 任务 4.1: hooks/index.ts
2. ✅ 任务 4.2: src/index.ts (依赖 4.1)
3. ✅ 任务 4.3: shared/index.ts
# Batch 5: 功能模块冲突解决 (5个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #17, #23, #25, #37, #44

---

- [x] **Task 5.1**: 解决 src/features/background-agent/manager.ts 冲突

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

- [x] **Task 5.2**: 解决 src/tools/delegate-task/*.ts 冲突

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

- [x] **Task 5.3**: 解决 src/features/builtin-skills/skills.ts 冲突

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

- [x] **Task 5.4**: 解决 src/tools/background-task/tools.ts 冲突

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

- [x] **Task 5.5**: 解决 src/features/builtin-commands/ 冲突

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
# Batch 6: 剩余Hooks冲突解决 (10个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #27, #28, #29, #38, #39, #40, #47, #48

---

- [x] **Task 6.1**: 解决 src/hooks/keyword-detector/constants.ts 冲突

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

- [x] **Task 6.2**: 解决 src/hooks/todo-continuation-enforcer.ts 冲突

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

- [x] **Task 6.3**: 解决 src/hooks/compaction-context-injector/index.ts 冲突

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

- [x] **Task 6.4**: 解决 src/hooks/interactive-bash-session/index.ts 冲突

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

- [x] **Task 6.5**: 解决 src/hooks/prometheus-md-only/*.ts 冲突

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

- [x] **Task 6.6**: 解决 src/hooks/atlas/index.ts 冲突

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

- [x] **Task 6.7**: 解决 src/features/builtin-commands/commands.ts 冲突

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
# Batch 7: 测试文件冲突解决 (15个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #56-#71

---

## 测试文件通用策略

| 策略 | 说明 |
|------|------|
| **优先上游** | 上游测试覆盖更完整时采用上游 |
| **合并两边** | 本地有独特测试用例时合并 |
| **保留本地** | 本地独有功能的测试必须保留 |

---

- [x] **Task 7.1**: boulder-state/storage.test.ts

**决策 #56**: 保留本地 mocks + 采用上游 async cleanup

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：保留本地 mock drivers + 采用上游 cleanup
# 检查合并后内容
grep "mock" src/features/boulder-state/storage.test.ts
git add src/features/boulder-state/storage.test.ts
```

---

- [x] **Task 7.2**: builtin-skills/skills.test.ts

**决策 #57**: 合并两边 skill 测试

确保测试覆盖本地独有 skills:
- mdsel
- brainstorming
- creating-changes
- tdd
- 等

```bash
cd C:/github/oh-my-opencode-merge-lab
git add src/features/builtin-skills/skills.test.ts
```

---

- [x] **Task 7.3**: context-injector/collector.test.ts

**决策 #58**: 采用上游 token-based 逻辑

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/features/context-injector/collector.test.ts
git add src/features/context-injector/collector.test.ts
```

---

- [x] **Task 7.4**: skill-mcp-manager/env-cleaner.test.ts

**决策 #59**: 采用上游 Zod + 保留本地边界测试

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：采用上游 Zod 验证 + 保留本地边界测试
git add src/features/skill-mcp-manager/env-cleaner.test.ts
```

---

- [x] **Task 7.5**: atlas/index.test.ts

**决策 #60**: 采用上游并行逻辑

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/atlas/index.test.ts
git add src/hooks/atlas/index.test.ts
```

---

- [x] **Task 7.6**: compaction-context-injector/index.test.ts

**决策 #61**: 采用上游 describe.each 矩阵

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/compaction-context-injector/index.test.ts
git add src/hooks/compaction-context-injector/index.test.ts
```

---

- [x] **Task 7.7**: keyword-detector/index.test.ts

**决策 #62**: 合并两边 + 转换为 BDD 风格

```bash
cd C:/github/oh-my-opencode-merge-lab

# 手动合并：保留安全检测测试 + 采用 BDD 规范
git add src/hooks/keyword-detector/index.test.ts
```

---

- [x] **Task 7.8**: prometheus-md-only/index.test.ts

**决策 #63**: 采用上游集成拦截

```bash
cd C:/github/oh-my-opencode-merge-lab
git checkout --theirs src/hooks/prometheus-md-only/index.test.ts
git add src/hooks/prometheus-md-only/index.test.ts
```

---

## 任务 7.9-7.15: 其他测试文件

### 7.9 mcp/index.test.ts
```bash
git checkout --theirs src/mcp/index.test.ts
git add src/mcp/index.test.ts
```

### 7.10 shared/opencode-config-dir.test.ts
```bash
git checkout --theirs src/shared/opencode-config-dir.test.ts
git add src/shared/opencode-config-dir.test.ts
```

### 7.11 shared/tmux/tmux-utils.test.ts
```bash
git checkout --theirs src/shared/tmux/tmux-utils.test.ts
git add src/shared/tmux/tmux-utils.test.ts
```

### 7.12 tools/delegate-task/tools.test.ts
```bash
git checkout --theirs src/tools/delegate-task/tools.test.ts
git add src/tools/delegate-task/tools.test.ts
```

### 7.13 tools/session-manager/tools.test.ts
```bash
git checkout --theirs src/tools/session-manager/tools.test.ts
git add src/tools/session-manager/tools.test.ts
```

### 7.14 tools/skill-mcp/tools.test.ts
```bash
git checkout --theirs src/tools/skill-mcp/tools.test.ts
git add src/tools/skill-mcp/tools.test.ts
```

### 7.15 hooks/start-work/index.test.ts
```bash
git checkout --theirs src/hooks/start-work/index.test.ts
git add src/hooks/start-work/index.test.ts
```

---

## Batch 7 完成检查

```bash
cd C:/github/oh-my-opencode-merge-lab

# 检查所有测试文件已解决
git status --short | grep "\.test\.ts"

# 验证无冲突标记
grep -r "<<<<<<" src/**/*.test.ts | head -5
# 期望: 无输出

# 运行测试验证
bun test
```

---

## 执行顺序

按文件路径顺序处理，优先使用 `git checkout --theirs` 的文件先处理。

1. ✅ 任务 7.3, 7.5, 7.6, 7.8: 直接采用上游
2. ✅ 任务 7.9-7.15: 直接采用上游
3. ✅ 任务 7.1, 7.2, 7.4, 7.7: 需要手动合并
