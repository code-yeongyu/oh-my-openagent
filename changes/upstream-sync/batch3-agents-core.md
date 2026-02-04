# Batch 3: Agents核心文件冲突解决 (4个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #26, #42, #43, #46

---

## 任务 3.1: 解决 src/agents/utils.ts 冲突

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

## 任务 3.2: 解决 src/agents/momus.ts 冲突

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

## 任务 3.3: 解决 src/agents/sisyphus.ts 冲突

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

## 任务 3.4: 解决 src/agents/atlas/default.ts 冲突

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
