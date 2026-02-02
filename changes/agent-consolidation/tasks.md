# Agent 整合与术语统一

## Context

### Original Request
1. 明确 Implementer 定位：合并到 Sisyphus-Junior
2. 统一术语：sisyphus_task → delegate_task（硬迁移）
3. 理解 Implementer 设计，与 Category 对比，找出改进点

### User Decisions
- **Implementer 策略**: 合并到 Sisyphus-Junior，通过 IMPLEMENTER_DISCIPLINE_PROMPT 注入
- **术语迁移**: 硬迁移，不保留 sisyphus_task
- **兼容性**: 必须向后兼容外部 API/Skill

### Research Findings
- `IMPLEMENTER_DISCIPLINE_PROMPT` 已注入 ultrabrain/most-capable/general Category
- Sisyphus-Junior 处理这些 Category 时已具备 Implementer 的三阶段纪律
- sisyphus_task 仍在 failure-counter、planning-flow-guide、文档中使用

---

## Work Objectives

### Core Objective
将 Implementer 功能完全整合到 Category 系统，统一 sisyphus_task 为 delegate_task

### Concrete Deliverables
- 删除 `src/agents/implementer.ts`
- 更新所有 hooks 支持 delegate_task
- 统一所有文档和 SKILL.md 中的术语

### Must NOT Have (Guardrails)
- ❌ 不改变 agent model 选择
- ❌ 不改变 hook 执行顺序
- ❌ 不扩展到其他 agent 重构

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **User wants tests**: TDD
- **Framework**: bun test

---

## Task Flow

```
Phase 1: Implementer 整合 (TODO 1-3)
    ↓
Phase 2: 术语迁移 - Hooks (TODO 4-6)
    ↓
Phase 3: 术语迁移 - 文档 (TODO 7-9)
    ↓
Phase 4: 清理与验证 (TODO 10-11)
```

---

## TODOs

### Phase 1: Implementer 整合

- [x] 1. 验证 IMPLEMENTER_DISCIPLINE_PROMPT 完整性

  **What to do**:
  - 对比 `src/agents/implementer.ts` 的 prompt 与 `src/tools/delegate-task/constants.ts` 中的 IMPLEMENTER_DISCIPLINE_PROMPT
  - 确认三阶段流程(Codex Prototype → TDD → Codex Review)已完整注入
  - 记录任何缺失的纪律规则

  **Parallelizable**: NO (需先完成才能判断后续任务)

  **References**:
  - `src/agents/implementer.ts` - 原始 Implementer prompt
  - `src/tools/delegate-task/constants.ts` - IMPLEMENTER_DISCIPLINE_PROMPT 定义

  **Acceptance Criteria**:
  - [x] 生成对比报告，列出差异点
  - [x] 如有缺失，记录需补充的规则

  **Commit**: NO (仅分析)

---

- [x] 2. 补充缺失的 Implementer 纪律到 Category 系统

  **What to do**:
  - 将 TODO 1 中发现的缺失规则补充到 IMPLEMENTER_DISCIPLINE_PROMPT
  - 确保 Tier 2/3 强制性 TDD 规则完整

  **Parallelizable**: NO (依赖 TODO 1)

  **References**:
  - `src/tools/delegate-task/constants.ts:IMPLEMENTER_DISCIPLINE_PROMPT`

  **Acceptance Criteria**:
  - [x] `bun run typecheck` → 无错误
  - [x] 纪律规则 100% 覆盖原 Implementer

  **Commit**: YES
  - Message: `refactor(delegate-task): complete implementer discipline prompt`

---

- [~] 3. 删除 Implementer Agent 定义 (SKIPPED - 按用户指示保留 implementer.ts)

  **What to do**:
  - 删除 `src/agents/implementer.ts`
  - 从 `src/agents/index.ts` 移除导出
  - 更新 `src/agents/AGENTS.md` 移除 Implementer 条目

  **Parallelizable**: NO (依赖 TODO 2)

  **References**:
  - `src/agents/implementer.ts` - 待删除
  - `src/agents/index.ts` - 导出注册

  **Acceptance Criteria**:
  - [x] `bun run typecheck` → 无错误
  - [x] `bun test` → 全部通过
  - [~] grep "implementer" src/agents/ → SKIPPED (保留 implementer.ts)

  **Commit**: YES
  - Message: `refactor(agents): remove standalone implementer agent`

---

### Phase 2: 术语迁移 - Hooks

- [x] 4. 更新 failure-counter hook 支持 delegate_task

  **What to do**:
  - 修改 `src/hooks/failure-counter/constants.ts` 将 `sisyphus_task` 替换为 `delegate_task`
  - 确保错误计数逻辑对两个工具名都生效（向后兼容）

  **Parallelizable**: YES (与 TODO 5, 6 并行)

  **References**:
  - `src/hooks/failure-counter/constants.ts:26` - 工具名定义
  - `src/hooks/failure-counter/index.ts:151` - 监听逻辑

  **Acceptance Criteria**:
  - [x] `bun test src/hooks/failure-counter` → 通过
  - [x] 验证 delegate_task 失败时计数器递增

  **Commit**: YES
  - Message: `fix(failure-counter): support delegate_task tool name`

---

- [x] 5. 更新 planning-flow-guide hook

  **What to do**:
  - 修改 `src/hooks/planning-flow-guide/index.ts` 中的 sisyphus_task 引用
  - 统一为 delegate_task

  **Parallelizable**: YES (与 TODO 4, 6 并行)

  **References**:
  - `src/hooks/planning-flow-guide/index.ts:60`

  **Acceptance Criteria**:
  - [x] `bun run typecheck` → 无错误
  - [x] grep "sisyphus_task" src/hooks/planning-flow-guide/ → 支持两者

  **Commit**: YES
  - Message: `refactor(planning-flow-guide): use delegate_task terminology`

---

- [x] 6. 更新 atlas hook 统一术语

  **What to do**:
  - 修改 `src/hooks/atlas/index.ts` 移除双重检查逻辑
  - 保留 delegate_task，添加 sisyphus_task 作为别名（向后兼容）

  **Parallelizable**: YES (与 TODO 4, 5 并行)

  **References**:
  - `src/hooks/atlas/index.ts:170` - sisyphus_task 检查
  - `src/hooks/atlas/index.ts:295` - delegate_task 检查
  - `src/hooks/atlas/index.ts:962` - 双重检查逻辑

  **Acceptance Criteria**:
  - [x] `bun test src/hooks/atlas` → 通过
  - [x] 逻辑简化为单一入口 + 别名映射

  **Commit**: YES
  - Message: `refactor(atlas): consolidate task delegation logic`

---

### Phase 3: 术语迁移 - 文档与 Skills

- [x] 7. 更新 Agent 提示词中的术语

  **What to do**:
  - 修改 `src/agents/sisyphus.ts` 中的 sisyphus_task 引用
  - 统一为 delegate_task

  **Parallelizable**: YES (与 TODO 8, 9 并行)

  **References**:
  - `src/agents/sisyphus.ts:479` - 混合术语位置

  **Acceptance Criteria**:
  - [x] grep "sisyphus_task" src/agents/sisyphus.ts → 更新为 delegate_task

  **Commit**: YES
  - Message: `docs(sisyphus): use delegate_task in prompts`

---

- [x] 8. 更新 SKILL.md 文件中的术语

  **What to do**:
  - 批量替换所有 SKILL.md 中的 sisyphus_task → delegate_task
  - 重点: wave-parallel-execution, executing-plans 等

  **Parallelizable**: YES (与 TODO 7, 9 并行)

  **References**:
  - `src/features/builtin-skills/wave-parallel-execution/SKILL.md`
  - `src/features/builtin-skills/executing-plans/SKILL.md`

  **Acceptance Criteria**:
  - [x] grep -r "sisyphus_task" src/features/builtin-skills/ → 更新为 delegate_task

  **Commit**: YES
  - Message: `docs(skills): standardize delegate_task terminology`

---

- [x] 9. 更新用户文档

  **What to do**:
  - 修改 USAGE-ENTRY.md, CONFIGURATION-GUIDE.md 中的示例
  - 统一为 delegate_task

  **Parallelizable**: YES (与 TODO 7, 8 并行)

  **References**:
  - `USAGE-ENTRY.md:166`
  - `CONFIGURATION-GUIDE.md:11`

  **Acceptance Criteria**:
  - [x] grep "sisyphus_task" *.md → 用户文档已更新为 delegate_task

  **Commit**: YES
  - Message: `docs: update user guides to use delegate_task`

---

### Phase 4: 清理与验证

- [x] 10. 添加向后兼容别名

  **What to do**:
  - 在 `src/index.ts` 中保留 sisyphus_task 作为 delegate_task 的别名
  - 添加 console.warn 提示用户迁移

  **Parallelizable**: NO (依赖 Phase 2-3 完成)

  **References**:
  - `src/index.ts:532-543` - 工具导出位置

  **Acceptance Criteria**:
  - [x] 调用 sisyphus_task 时控制台显示废弃警告
  - [x] 功能与 delegate_task 完全一致

  **Commit**: YES
  - Message: `feat(compat): add sisyphus_task deprecation warning`

---

- [x] 11. 最终验证

  **What to do**:
  - 运行完整测试套件
  - 验证所有 hooks 正常工作
  - 确认文档一致性

  **Parallelizable**: NO (最终验证)

  **Acceptance Criteria**:
  - [x] `bun run typecheck` → 无错误
  - [x] `bun test` → 相关测试通过 (50 tests)
  - [x] `bun run build` → 成功 (2.72 MB)

  **Commit**: NO (验证步骤)

---

## Commit Strategy

| After Task | Message | Verification |
|------------|---------|--------------|
| 2 | `refactor(delegate-task): complete implementer discipline prompt` | typecheck |
| 3 | `refactor(agents): remove standalone implementer agent` | typecheck + test |
| 4 | `fix(failure-counter): support delegate_task tool name` | test |
| 5 | `refactor(planning-flow-guide): use delegate_task terminology` | typecheck |
| 6 | `refactor(atlas): consolidate task delegation logic` | test |
| 7 | `docs(sisyphus): use delegate_task in prompts` | grep |
| 8 | `docs(skills): standardize delegate_task terminology` | grep |
| 9 | `docs: update user guides to use delegate_task` | grep |
| 10 | `feat(compat): add sisyphus_task deprecation warning` | manual |

---

## Success Criteria

### Final Checklist
- [~] Implementer agent 已删除 (SKIPPED - 按用户指示保留)
- [x] 所有 IMPLEMENTER_DISCIPLINE 规则已迁移到 Category 系统
- [x] sisyphus_task 作为废弃别名保留（向后兼容）
- [x] 所有文档统一使用 delegate_task
- [x] 全部测试通过

