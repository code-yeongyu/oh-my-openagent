# Tasks: 修复未注册钩子 + 集成死代码 + 实现缺失功能 + Bug 修复

> **For Claude:** 经过真实环境触发验证，发现 6 个 shared utilities 是"死代码"（有实现但未被调用）。
> 
> 总任务数：**14 项** = 1 Bug修复 + 2 注册 + 6 集成 + 5 实现

---

## 🐛 已发现的 Bug

### TypeError: undefined is not an object (evaluating 'agent.name')

**错误位置**: `C:\github\opencode\packages\opencode\src\session\prompt.ts:838`

**根因分析**:
- OpenCode 的 `createUserMessage` 函数期望接收有效的 `agent` 对象
- 当 `agent` 为 `undefined` 时，访问 `agent.name` 抛出 TypeError
- 触发场景：
  1. `delegate_task(subagent_type="xxx")` 传入无效的 agent 名称
  2. Agent 被禁用但代码仍尝试调用它
  3. Agent 注册失败但调用方不知道

**现有防护** (事后捕获，非预防):
```typescript
// src/features/background-agent/manager.ts:324
// src/tools/call-omo-agent/tools.ts:205
if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
  // 错误处理
}
```

**修复方案**: Task 0.1 添加 Agent 存在性预检查

---

## 验证结果汇总

### ✅ 能真实触发 (2 项)

| 功能 | 路径 | 触发方式 |
|------|------|----------|
| verification | `src/features/builtin-skills/verification-before-completion/` | `skill("verification-before-completion")` |
| backtrack | `src/hooks/plan-reorganizer/` | Hook 自动触发 |

### ⚠️ 死代码 - 有实现但未集成 (6 项)

| 功能 | 路径 | 问题 |
|------|------|------|
| project-detector | `src/shared/project-detector.ts` | 仅测试文件调用 |
| phase-detector | `src/shared/phase-rollback.ts` | 仅测试文件调用 |
| phase-rules | `src/shared/phase-aware-rules.ts` | 仅测试文件调用 |
| slop-detector | `src/shared/slop-detector.ts` | 仅 index.ts 导出 |
| verbosity-controller | `src/shared/verbosity-controller.ts` | 仅测试文件调用 |
| knowledge-extractor | `src/shared/knowledge-extractor.ts` | 仅测试文件调用 |

### ❌ 完全缺失 (5 项)

| 功能 | 预期路径 |
|------|----------|
| relevance-scorer | `src/shared/relevance-scorer.ts` |
| anti-pattern-tracker | `src/shared/anti-pattern-tracker.ts` |
| ast-coverage-checker | `src/shared/ast-coverage-checker.ts` |
| isolation-checker | `src/shared/isolation-checker.ts` |
| pr-context-injector | `src/hooks/pr-context-injector/` |

---

## Phase 0: Bug 修复 (P0)

### Task 0.1: 添加 Agent 存在性预检查 <!-- Risk: Tier-2 -->

**Description:**
在调用 agent 前验证其存在，防止 `TypeError: undefined is not an object (evaluating 'agent.name')` 错误。

**Files:**
- Modify: `src/tools/delegate-task/tools.ts`
- Modify: `src/tools/call-omo-agent/tools.ts`
- Modify: `src/features/background-agent/manager.ts`

**Acceptance Criteria:**
- [ ] 在 `delegate_task` 调用前检查 agent 是否存在
- [ ] 不存在时抛出清晰的错误信息，列出可用 agents
- [ ] 添加单元测试验证预检查逻辑
- [ ] `bun run typecheck` 无错误

**Implementation Pattern:**
```typescript
// 在 delegate_task 调用前
const agentExists = client.agents.find(a => a.name === subagentType)
if (!agentExists) {
  const available = client.agents.map(a => a.name).join(", ")
  throw new Error(`Agent "${subagentType}" not found. Available: ${available}`)
}
```

**Root Cause:**
- OpenCode `prompt.ts:838` 执行 `agent.name` 时 agent 为 undefined
- 现有防护是事后捕获，此任务添加预防性检查

---

## Phase 1: 快速修复 - 注册已存在的钩子 (P0)

### Task 1.1: 注册 secret-scanner 钩子 <!-- Risk: Tier-1 -->

**Description:**
在 `src/index.ts` 中注册 `secret-scanner` 钩子。

**Files:**
- Modify: `src/index.ts`

**Acceptance Criteria:**
- [ ] 导入 `createSecretScannerHook`
- [ ] 添加 `isHookEnabled("secret-scanner")` 检查
- [ ] 钩子添加到 PreToolUse 事件
- [ ] `bun run typecheck` 无错误

**References:**
- `src/hooks/secret-scanner/index.ts` - 钩子实现
- `src/index.ts:318-330` - 现有钩子注册模式

---

### Task 1.2: 注册 skill-auto-injector 钩子 <!-- Risk: Tier-1 -->

**Description:**
在 `src/index.ts` 中注册 `skill-auto-injector` 钩子。

**Files:**
- Modify: `src/index.ts`

**Acceptance Criteria:**
- [ ] 导入 `createSkillAutoInjectorHook`
- [ ] 添加 `isHookEnabled("skill-auto-injector")` 检查
- [ ] 钩子添加到适当的生命周期事件
- [ ] `bun run typecheck` 无错误

**References:**
- `src/hooks/skill-auto-injector/index.ts` - 钩子实现

---

## Phase 2: 集成死代码 - 创建 Hook 包装器 (P0)

> 这些 shared utilities 已有完整实现和测试，只需创建 Hook 来调用它们。

### Task 2.1: 创建 behavior-anchor Hook <!-- Risk: Tier-2 -->

**Description:**
创建 Hook 调用 `SlopDetector`，检测 AI Slop 并注入行为准则。

**Files:**
- Create: `src/hooks/behavior-anchor/index.ts`
- Create: `src/hooks/behavior-anchor/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createBehaviorAnchorHook()` 工厂函数
- [ ] 导入并使用 `SlopDetector` from `src/shared/slop-detector.ts`
- [ ] PostToolUse 时检测输出内容
- [ ] 检测到 slop 时注入 guidelines
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

**Implementation Pattern:**
```typescript
import { SlopDetector } from "../shared/slop-detector"

export function createBehaviorAnchorHook(): Hook {
  const detector = new SlopDetector(config)
  // 在 PostToolUse 检测并注入
}
```

---

### Task 2.2: 创建 verbosity-controller Hook <!-- Risk: Tier-2 -->

**Description:**
创建 Hook 调用 `VerbosityController`，根据 Token 使用量切换输出模式。

**Files:**
- Create: `src/hooks/verbosity-controller/index.ts`
- Create: `src/hooks/verbosity-controller/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createVerbosityControllerHook()` 工厂函数
- [ ] 导入并使用 `VerbosityController` from `src/shared/verbosity-controller.ts`
- [ ] 读取当前 session 的 token 使用量
- [ ] 根据使用量切换 mode 并注入 instructions
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

**Implementation Pattern:**
```typescript
import { VerbosityController } from "../shared/verbosity-controller"

export function createVerbosityControllerHook(): Hook {
  const controller = new VerbosityController()
  // 在 PreToolUse 或 UserPromptSubmit 检测 token 并注入
}
```

---

### Task 2.3: 创建 phase-rules-injector Hook <!-- Risk: Tier-2 -->

**Description:**
创建 Hook 调用 `getRulesForPhase()` + `detectPhaseFromContext()`，根据任务阶段注入规则。

**Files:**
- Create: `src/hooks/phase-rules-injector/index.ts`
- Create: `src/hooks/phase-rules-injector/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createPhaseRulesInjectorHook()` 工厂函数
- [ ] 导入 `detectPhaseFromContext`, `getRulesForPhase` from `src/shared/phase-aware-rules.ts`
- [ ] UserPromptSubmit 时检测阶段
- [ ] 注入对应阶段的规则
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

---

### Task 2.4: 创建 knowledge-injection Hook <!-- Risk: Tier-2 -->

**Description:**
创建 Hook 调用 `KnowledgeExtractor`，提取和注入已解决的 Bug 模式。

**Files:**
- Create: `src/hooks/knowledge-injection/index.ts`
- Create: `src/hooks/knowledge-injection/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createKnowledgeInjectionHook()` 工厂函数
- [ ] 导入 `KnowledgeExtractor` from `src/shared/knowledge-extractor.ts`
- [ ] onSummarize/Compaction 时提取 knowledge
- [ ] 新会话开始时注入相关 knowledge
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

---

### Task 2.5: 创建 project-context-injector Hook <!-- Risk: Tier-2 -->

**Description:**
创建 Hook 调用 `ProjectDetector`，检测并注入项目上下文。

**Files:**
- Create: `src/hooks/project-context-injector/index.ts`
- Create: `src/hooks/project-context-injector/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createProjectContextInjectorHook()` 工厂函数
- [ ] 导入 `ProjectDetector` from `src/shared/project-detector.ts`
- [ ] 会话开始时检测项目类型
- [ ] 注入包管理器/框架信息到上下文
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

---

### Task 2.6: 集成 phase-rollback 到 plan-reorganizer <!-- Risk: Tier-2 -->

**Description:**
将 `createPhaseRollback()` 集成到现有的 `plan-reorganizer` Hook。

**Files:**
- Modify: `src/hooks/plan-reorganizer/index.ts`

**Acceptance Criteria:**
- [ ] 导入 `createPhaseRollback` from `src/shared/phase-rollback.ts`
- [ ] 验证失败时调用 `suggestRollbackPhase()`
- [ ] 记录 rollback history
- [ ] `bun run typecheck` 无错误

---

## Phase 3: 实现缺失功能 (P1)

### Task 3.1: 实现 relevance-scorer <!-- Risk: Tier-2 -->

**Description:**
根据意图模式动态调整资源权重。

**Files:**
- Create: `src/shared/relevance-scorer.ts`
- Create: `src/shared/relevance-scorer.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `RelevanceScorer` 类或 `scoreRelevance()` 函数
- [ ] review 模式提升测试文件权重
- [ ] research 模式提升文档权重
- [ ] implement 模式提升源代码权重
- [ ] 测试覆盖主要场景

**Implementation Pattern:**
参考 `src/shared/slop-detector.ts` 的类结构模式。

---

### Task 3.2: 实现 anti-pattern-tracker <!-- Risk: Tier-2 -->

**Description:**
记录失败方案避免重复尝试。

**Files:**
- Create: `src/shared/anti-pattern-tracker.ts`
- Create: `src/shared/anti-pattern-tracker.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `AntiPatternTracker` 类
- [ ] `trackFailure(pattern, reason)` 方法
- [ ] `getFailedPatterns()` 方法
- [ ] `isKnownFailure(pattern)` 方法
- [ ] 可选：持久化到文件
- [ ] 测试覆盖主要场景

**Implementation Pattern:**
参考 `src/shared/knowledge-extractor.ts` 的持久化模式。

---

### Task 3.3: 实现 ast-coverage-checker <!-- Risk: Tier-3 -->

**Description:**
验证测试是否引用目标函数。

**Files:**
- Create: `src/shared/ast-coverage-checker.ts`
- Create: `src/shared/ast-coverage-checker.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `checkAstCoverage(sourceFile, testFile)` 函数
- [ ] 使用 AST 解析提取源文件的导出函数
- [ ] 检测测试文件是否引用这些函数
- [ ] 返回覆盖率报告 `{ covered: string[], uncovered: string[] }`
- [ ] 测试覆盖主要场景

**Implementation Pattern:**
可使用 `@ast-grep/napi` (已是项目依赖)。

---

### Task 3.4: 实现 isolation-checker <!-- Risk: Tier-2 -->

**Description:**
检测测试中的直接数据库/网络操作。

**Files:**
- Create: `src/shared/isolation-checker.ts`
- Create: `src/shared/isolation-checker.test.ts`

**Acceptance Criteria:**
- [ ] 导出 `checkIsolation(testFileContent)` 函数
- [ ] 检测 `fetch`, `axios`, `http.request` 直接调用
- [ ] 检测 `pg`, `mysql`, `mongodb` 直接连接
- [ ] 返回 `{ isolated: boolean, violations: string[] }`
- [ ] 测试覆盖主要场景

**Implementation Pattern:**
使用正则或 AST 模式匹配检测网络/数据库调用。

---

### Task 3.5: 实现 pr-context-injector Hook <!-- Risk: Tier-2 -->

**Description:**
自动注入完整 PR diff 摘要。

**Files:**
- Create: `src/hooks/pr-context-injector/index.ts`
- Create: `src/hooks/pr-context-injector/index.test.ts`
- Modify: `src/index.ts` - 注册钩子

**Acceptance Criteria:**
- [ ] 创建 `createPrContextInjectorHook()` 工厂函数
- [ ] 检测当前是否在 PR 分支 (`git branch --show-current`)
- [ ] 获取 PR diff (`git diff main...HEAD --stat`)
- [ ] 注入 diff 摘要到上下文
- [ ] 在 index.ts 注册钩子
- [ ] `bun run typecheck` 无错误

**References:**
- `src/hooks/context-injector/index.ts` - 现有注入器模式

---

## Summary

| Phase | Tasks | 预计时间 |
|-------|-------|----------|
| Phase 0: Bug 修复 | 1 | 30 分钟 |
| Phase 1: 钩子注册 | 2 | 30 分钟 |
| Phase 2: Hook 集成 | 6 | 3 小时 |
| Phase 3: 功能实现 | 5 | 2.5 小时 |
| **总计** | **14** | **~6.5 小时** |

---

## Execution Order

```
Phase 0 (优先):
└── Task 0.1: Agent 存在性预检查

Phase 1 (并行):
├── Task 1.1: secret-scanner 注册
└── Task 1.2: skill-auto-injector 注册

Phase 2 (并行):
├── Task 2.1: behavior-anchor Hook
├── Task 2.2: verbosity-controller Hook
├── Task 2.3: phase-rules-injector Hook
├── Task 2.4: knowledge-injection Hook
├── Task 2.5: project-context-injector Hook
└── Task 2.6: phase-rollback 集成

Phase 3 (部分并行):
├── Task 3.1: relevance-scorer
├── Task 3.2: anti-pattern-tracker
├── Task 3.3: ast-coverage-checker (依赖 @ast-grep/napi)
├── Task 3.4: isolation-checker
└── Task 3.5: pr-context-injector Hook
```

---

## Change Log

- **2026-02-02 v2**: 经真实环境触发验证，发现 6 项是死代码
  - 原 7 任务 → 13 任务
  - 添加 Phase 2: Hook 集成 (6 项)
  - 保留 Phase 1: 钩子注册 (2 项)
  - 保留 Phase 3: 功能实现 (5 项)
  
- **2026-02-02 v1**: 初始计划 15 任务 → 验证后精简为 7 任务
  - 删除 8 项已完整实现的功能任务 (错误判断)
