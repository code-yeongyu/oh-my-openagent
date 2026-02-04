# Batch 4: Hooks入口文件冲突解决 (3个文件)

**工作目录**: `C:/github/oh-my-opencode-merge-lab`
**决策来源**: decisions.md #30, #36, #41

---

## 任务 4.1: 解决 src/hooks/index.ts 冲突

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

## 任务 4.2: 解决 src/index.ts (主入口) 冲突

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

## 任务 4.3: 解决 src/shared/index.ts 冲突

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
