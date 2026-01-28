# Oh-My-OpenCode 50项增强工作计划

## Context

### Original Request
用户希望基于 `docs/upgrade-analysis/ENHANCEMENT-LIST.md` 的分析，创建一个针对现有功能的50项增强计划，采用"复制粘贴并适配"的方法从 `everything-claude-code` 仓库引入最佳实践。

### Interview Summary
**Key Discussions**:
- 用户选择"仅50项增强"方向，优化现有功能，不新增架构
- 增强项来源于 everything-claude-code 与 oh-my-opencode 的对比分析
- 实施策略：从 everything-claude-code 的 `.qoder/repowiki/zh/` 复制相关模式并适配

**Research Findings**:
- 两个仓库都有 `.qoder/repowiki/zh/` 目录，包含详细的系统文档
- `docs/upgrade-analysis/` 包含3个核心分析文档
- 50项增强分布于9个核心系统

---

## Work Objectives

### Core Objective
对 oh-my-opencode 的9个核心系统进行50项增强，提升系统可靠性、安全性和开发效率。

### Concrete Deliverables
- 17项高优先级增强 (Phase 1)
- 28项中优先级增强 (Phase 2)
- 5项低优先级增强 (Phase 3)

### Definition of Done
- [ ] `bun run typecheck` → 0 errors
- [ ] `bun test` → all tests pass
- [ ] 每个增强项有对应的测试覆盖
- [ ] 文档更新反映新功能

### Must Have
- TDD工作流：先写测试，后写实现
- 每个增强项独立提交
- 向后兼容现有配置

### Must NOT Have (Guardrails)
- 不新增架构组件（本能模型、Observer等属于缺失功能，不在本计划范围）
- 不破坏现有API兼容性
- 不引入新的外部依赖（除非增强项明确要求）

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES
- **User wants tests**: TDD
- **Framework**: bun test

### TDD Workflow
每个 TODO 遵循 RED-GREEN-REFACTOR:
1. **RED**: 先写失败测试 → `bun test [file]` → FAIL
2. **GREEN**: 实现最小代码 → PASS
3. **REFACTOR**: 优化代码 → 保持 PASS

---

## Task Flow

```
Phase 1 (Week 1-2): 高优先级 17项
├── Wave 1: 规则系统 (R1, R3, R6, R7) - 4项
├── Wave 2: 技能系统 (S1, S3) + 上下文 (C1, C3) - 4项
├── Wave 3: 代理系统 (G1, G4) + 高级主题 (A3, A5) - 4项
├── Wave 4: MCP (M1, M3) + 钩子 (H1) - 3项
└── Wave 5: 测试 (T2) + 命令 (D1) - 2项

Phase 2 (Week 3-4): 中优先级 28项
├── Wave 6-10: 按系统分组执行

Phase 3 (按需): 低优先级 5项
└── Wave 11: M6, R9, T5, G6, S5
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| Wave 1 | R1, R3, R6, R7 | 同一文件可能冲突，需顺序执行 |
| Wave 2 | S1+S3, C1+C3 | 两个子组可并行 |
| Wave 3 | G1+G4, A3+A5 | 两个子组可并行 |

---

## TODOs

### Phase 1: 高优先级增强 (Week 1-2)

---

- [ ] 1. R1: 角色感知规则注入 (Role-Aware Injection)

  **What to do**:
  - 修改 `src/hooks/rules-injector/index.ts`
  - 根据当前 Agent 类型动态注入不同规则集
  - Oracle → 架构规则; Explore → 搜索规则; Sisyphus → 完整规则

  **Must NOT do**:
  - 不修改规则文件本身的格式
  - 不改变现有规则注入的基本逻辑

  **Parallelizable**: NO (与 R3, R6, R7 共享文件)

  **References**:
  - `src/hooks/rules-injector/index.ts` - 当前规则注入逻辑
  - `src/agents/index.ts` - Agent 类型定义
  - `everything-claude-code/.qoder/repowiki/zh/content/规则系统详解/代理使用规则.md` - 参考模式

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/hooks/rules-injector/index.test.ts`
  - [ ] 测试场景: Oracle agent 收到架构规则, Explore agent 收到轻量规则
  - [ ] `bun test src/hooks/rules-injector` → PASS

  **Commit**: YES
  - Message: `feat(rules-injector): add role-aware rule injection`
  - Files: `src/hooks/rules-injector/index.ts`, `src/hooks/rules-injector/index.test.ts`

---

- [ ] 2. R3: TDD 失败测试真实性验证

  **What to do**:
  - 修改 `src/hooks/tdd-guard/index.ts`
  - 将 `hasFailingTest` 从硬编码 `false` 改为真实执行测试命令
  - 使用 `bun test --filter` 或项目配置的测试命令验证 Red Stage

  **Must NOT do**:
  - 不在生产环境执行测试（仅在 TDD 模式下）
  - 测试执行超时不应阻塞主流程

  **Parallelizable**: NO (与 T2, T3 共享 tdd-guard)

  **References**:
  - `src/hooks/tdd-guard/index.ts:hasFailingTest` - 当前硬编码位置
  - `src/hooks/tdd-guard/types.ts` - TDD 状态类型
  - `everything-claude-code/.qoder/repowiki/zh/content/规则系统详解/测试规则.md` - 参考实现

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/hooks/tdd-guard/index.test.ts`
  - [ ] 测试场景: 有失败测试时返回 true, 无失败测试时返回 false
  - [ ] `bun test src/hooks/tdd-guard` → PASS
  - [ ] 手动验证: 创建失败测试 → TDD guard 检测到 Red 状态

  **Commit**: YES
  - Message: `feat(tdd-guard): implement real test execution for Red stage verification`
  - Files: `src/hooks/tdd-guard/index.ts`, `src/hooks/tdd-guard/index.test.ts`

---

- [ ] 3. R6: 高风险操作双重审计

  **What to do**:
  - 在 `src/hooks/rules-injector/` 中新增安全等级分类
  - 定义 Security Tiers: LOW (read), MEDIUM (write), HIGH (delete/exec)
  - 高风险操作强制输出安全分析摘要

  **Must NOT do**:
  - 不阻断用户明确授权的操作
  - 不影响现有权限配置

  **Parallelizable**: NO (与 R7 共享安全逻辑)

  **References**:
  - `src/hooks/rules-injector/index.ts` - 注入位置
  - `everything-claude-code/.qoder/repowiki/zh/content/规则系统详解/安全规则.md` - Security Tiers 定义

  **Acceptance Criteria**:
  - [ ] 测试: 高风险操作触发审计摘要
  - [ ] `bun test src/hooks/rules-injector` → PASS

  **Commit**: YES
  - Message: `feat(rules): add security tiers and dual audit for high-risk operations`

---

- [ ] 4. R7: 预防性敏感信息扫描

  **What to do**:
  - 在 `PreToolUse` 阶段新增敏感信息检测
  - 检测模式: API keys, passwords, tokens, secrets
  - 写入磁盘前阻断并警告

  **Must NOT do**:
  - 不扫描已存在的文件（仅新写入内容）
  - 不产生误报（精确匹配常见模式）

  **Parallelizable**: YES (与其他 Wave 2+ 并行)

  **References**:
  - `src/hooks/` - PreToolUse 钩子模式
  - 正则模式参考: `(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]+['\"]`

  **Acceptance Criteria**:
  - [ ] 测试: 检测到 `API_KEY=xxx` 时阻断
  - [ ] 测试: 正常代码不触发误报
  - [ ] `bun test` → PASS

  **Commit**: YES
  - Message: `feat(security): add preemptive secret scanning in PreToolUse`

---

- [ ] 5. S1: 标准化内置技能文档

  **What to do**:
  - 统一所有内置技能采用 `git-master` 模板格式
  - 每个技能必须包含: Boundaries, Anti-Patterns, When to Use/Not Use

  **Must NOT do**:
  - 不改变技能的实际功能逻辑

  **Parallelizable**: YES (与 S3 并行)

  **References**:
  - `src/features/builtin-skills/skills.ts` - 技能定义
  - `src/features/builtin-skills/git-master/SKILL.md` - 标准模板

  **Acceptance Criteria**:
  - [ ] 所有技能包含 Boundaries 部分
  - [ ] 所有技能包含 Anti-Patterns 部分
  - [ ] 文档审查通过

  **Commit**: YES
  - Message: `docs(skills): standardize all builtin skills with git-master template`

---

- [ ] 6. S3: 技能自动注入机制

  **What to do**:
  - 通过 Hook 检测任务类型
  - 自动将相关技能指令注入上下文
  - 减少对 AI 主动调用 `skill()` 的依赖

  **Must NOT do**:
  - 不移除手动调用 `skill()` 的能力
  - 注入内容不应过多（保持上下文精简）

  **Parallelizable**: YES (与 C1 并行)

  **References**:
  - `src/features/builtin-skills/types.ts` - 技能接口
  - `src/hooks/skill-suggestion/` - 现有技能建议逻辑

  **Acceptance Criteria**:
  - [ ] 测试: 检测到 git 操作时自动注入 git-master
  - [ ] 测试: 检测到浏览器任务时注入 playwright
  - [ ] `bun test` → PASS

  **Commit**: YES
  - Message: `feat(skills): implement automatic skill injection based on task detection`

---

- [ ] 7. C1: 引入全局"意图模式"切换

  **What to do**:
  - 实现三种意图模式: 开发(dev) / 审查(review) / 研究(research)
  - 根据任务类型动态调整系统指令

  **Must NOT do**:
  - 不强制用户选择模式（应自动检测）

  **Parallelizable**: YES (与 C3 同组)

  **References**:
  - `src/features/context-injector/collector.ts` - 上下文收集
  - `everything-claude-code/.qoder/repowiki/zh/content/上下文管理系统/开发上下文模式.md`

  **Acceptance Criteria**:
  - [ ] 测试: 检测到 "review" 关键词时切换审查模式
  - [ ] `bun test src/features/context-injector` → PASS

  **Commit**: YES
  - Message: `feat(context): implement intent mode switching (dev/review/research)`

---

- [ ] 8. C3: 里程碑触发的战略性压缩

  **What to do**:
  - 检测到阶段完成时主动提示压缩
  - 不等待窗口溢出才被动压缩

  **Must NOT do**:
  - 不在用户明确拒绝后强制压缩

  **Parallelizable**: YES (与 C1 同组)

  **References**:
  - `src/hooks/compaction-context-injector/index.ts` - 压缩逻辑
  - `src/hooks/preemptive-compaction/` - 预压缩钩子

  **Acceptance Criteria**:
  - [ ] 测试: 检测到 "done" / "complete" 时触发压缩建议
  - [ ] `bun test` → PASS

  **Commit**: YES
  - Message: `feat(context): add milestone-triggered strategic compaction`

---

- [ ] 9. G1: Oracle 决策框架

  **What to do**:
  - 在 Oracle 提示词中加入 Effort Estimate 要求
  - 强制 "One Clear Path" 输出格式

  **Must NOT do**:
  - 不改变 Oracle 的核心推理逻辑

  **Parallelizable**: YES (与 G4 同组)

  **References**:
  - `src/agents/oracle.ts` - Oracle 定义
  - `everything-claude-code/.qoder/repowiki/zh/content/代理系统详解/专业代理.md`

  **Acceptance Criteria**:
  - [ ] Oracle 输出包含 Effort Estimate
  - [ ] Oracle 输出有明确的 "Recommended Path" 部分

  **Commit**: YES
  - Message: `feat(oracle): add decision framework with effort estimate`

---

- [ ] 10. G4: 结构化交接协议

  **What to do**:
  - 强制生成 Summary/Discovery/Questions/Suggestions 格式
  - 替代依赖 session_id 的隐式交接

  **Must NOT do**:
  - 不移除 session_id 机制（保持向后兼容）

  **Parallelizable**: YES (与 G1 同组)

  **References**:
  - `src/features/background-agent/manager.ts` - Agent 通信
  - `everything-claude-code/.qoder/repowiki/zh/content/核心概念/代理协作机制/通信协议与接口.md`

  **Acceptance Criteria**:
  - [ ] Agent 返回结果包含四部分结构
  - [ ] 测试验证格式完整性

  **Commit**: YES
  - Message: `feat(agents): implement structured handover protocol`

---

- [ ] 11. A3: 依赖图感知波次执行

  **What to do**:
  - 分析任务依赖关系
  - 只有互不干扰的任务放入同一 Wave

  **Must NOT do**:
  - 不强制所有任务都必须并行

  **Parallelizable**: YES (与 A5 同组)

  **References**:
  - `src/features/background-agent/manager.ts` - 任务管理
  - `everything-claude-code/.qoder/repowiki/zh/content/高级主题/并行化策略.md`

  **Acceptance Criteria**:
  - [ ] 测试: 有依赖的任务不会并行执行
  - [ ] `bun test src/features/background-agent` → PASS

  **Commit**: YES
  - Message: `feat(background-agent): add dependency-aware wave execution`

---

- [ ] 12. A5: 缓存友好型上下文重组

  **What to do**:
  - 标准化注入顺序以最大化 Prompt Caching 命中率
  - 静态内容放前面，动态内容放后面

  **Must NOT do**:
  - 不改变注入内容本身

  **Parallelizable**: YES (与 A3 同组)

  **References**:
  - `src/features/context-injector/` - 注入顺序逻辑
  - Anthropic Prompt Caching 文档

  **Acceptance Criteria**:
  - [ ] 注入顺序: system → agents.md → rules → dynamic
  - [ ] 测试验证顺序一致性

  **Commit**: YES
  - Message: `feat(context): optimize injection order for prompt caching`

---

- [ ] 13. M1: 支持本地 Stdio (Command) 服务器

  **What to do**:
  - 增加 `LocalMcpConfig` 类型
  - 允许 `npx/uvx` 启动本地进程

  **Must NOT do**:
  - 不移除现有 Remote HTTP 支持

  **Parallelizable**: YES (与 M3 同组)

  **References**:
  - `src/mcp/index.ts` - MCP 配置
  - `src/config/schema.ts` - 配置 Schema

  **Acceptance Criteria**:
  - [ ] 测试: 本地 MCP 可通过 npx 启动
  - [ ] `bun test src/mcp` → PASS

  **Commit**: YES
  - Message: `feat(mcp): add local stdio server support`

---

- [ ] 14. M3: 工具数量硬约束

  **What to do**:
  - 当启用 MCP 工具总数 > 80 时发出警告
  - 建议单项目 < 10 个 MCP

  **Must NOT do**:
  - 不阻断用户（仅警告）

  **Parallelizable**: YES (与 M1 同组)

  **References**:
  - `src/mcp/index.ts` - MCP 加载逻辑
  - `src/config/schema.ts` - 阈值配置

  **Acceptance Criteria**:
  - [ ] 测试: 超过 80 工具时输出警告
  - [ ] 警告不阻断启动

  **Commit**: YES
  - Message: `feat(mcp): add tool count threshold warning`

---

- [ ] 15. H1: 引入标准化匹配器

  **What to do**:
  - 抽象 `HookMatcher` 接口
  - 支持正则和 Glob 配置

  **Must NOT do**:
  - 不破坏现有硬编码匹配逻辑（向后兼容）

  **Parallelizable**: YES

  **References**:
  - `src/hooks/index.ts` - 钩子系统入口
  - `everything-claude-code/.qoder/repowiki/zh/content/钩子系统详解/钩子架构与事件类型.md`

  **Acceptance Criteria**:
  - [ ] HookMatcher 接口定义完成
  - [ ] 测试: 正则匹配工作正常
  - [ ] 测试: Glob 匹配工作正常

  **Commit**: YES
  - Message: `feat(hooks): introduce standardized HookMatcher abstraction`

---

- [ ] 16. T2: 自动生成测试模板

  **What to do**:
  - TDD 拦截时自动生成针对目标修改的测试文件脚手架
  - 包含基本的 describe/it 结构

  **Must NOT do**:
  - 不覆盖已存在的测试文件

  **Parallelizable**: YES

  **References**:
  - `src/hooks/tdd-guard/index.ts` - TDD 拦截逻辑
  - 测试模板格式参考现有测试文件

  **Acceptance Criteria**:
  - [ ] 测试: 拦截时生成 `.test.ts` 脚手架
  - [ ] 脚手架包含基本结构

  **Commit**: YES
  - Message: `feat(tdd-guard): auto-generate test scaffolding on interception`

---

- [ ] 17. D1: /plan 引入风险矩阵

  **What to do**:
  - 在 Prometheus 输出中强制包含"风险与缓解"部分
  - 识别破坏性更改

  **Must NOT do**:
  - 不改变计划的核心结构

  **Parallelizable**: YES

  **References**:
  - `src/agents/prometheus-prompt.ts` - 计划代理提示词

  **Acceptance Criteria**:
  - [ ] 计划输出包含 Risk Matrix 部分
  - [ ] 破坏性更改有明确标记

  **Commit**: YES
  - Message: `feat(prometheus): add risk matrix to plan output`

---

### Phase 2: 中优先级增强 (Week 3-4)

> 以下为 28 项中优先级增强的概要。每项遵循相同的 TDD 工作流。

---

- [ ] 18. M2: 配置模板化与环境变量解耦
- [ ] 19. M4: 懒加载与 CLI 封装 (影子 MCP)
- [ ] 20. M5: 后置 Hook 联动 (MCP 修改后触发检查)
- [ ] 21. S2: Frontmatter 扩展支持声明式 Hooks
- [ ] 22. S4: 模式探测 (Mode Detection)
- [ ] 23. C2: 上下文相关性排序优化
- [ ] 24. C4: 摘要增加"反模式"记录
- [ ] 25. C5: 行为准则的周期性锚定
- [ ] 26. R2: 任务阶段感知 (Phase-Based) 规则注入
- [ ] 27. R4: 基于 AST 的测试覆盖精准匹配
- [ ] 28. R5: 测试质量门禁升级 (隔离性检查)
- [ ] 29. R8: PR 历史追溯注入
- [ ] 30. A1: 多阶段验证循环 (批判者模型)
- [ ] 31. A2: 动态阶段回溯机制
- [ ] 32. A4: 分层上下文压缩
- [ ] 33. A6: 动态 Verbosity 控制
- [ ] 34. T1: 统一验证运行器 (doctor --test)
- [ ] 35. T3: TDD 状态感知显示
- [ ] 36. T4: 会话质量评分
- [ ] 37. D2: /refactor 整合清理工具 (knip)
- [ ] 38. D3: 循环检测算法
- [ ] 39. D4: 场景化预设 (--mode 参数)
- [ ] 40. G2: Librarian 文档发现流程优化
- [ ] 41. G3: Explore 意图分析 (三维度排序)
- [ ] 42. G5: 预定义协作序列
- [ ] 43. H2: 上下文感知匹配
- [ ] 44. H3: Stop 阶段的最终审计
- [ ] 45. H4: 优雅降级 (钩子容错)

---

### Phase 3: 低优先级增强 (按需)

- [ ] 46. M6: 健康检查与降级策略
- [ ] 47. R9: 原子化提交强制约束
- [ ] 48. T5: 跨 Agent 验证链
- [ ] 49. G6: 风险分级 TDD 配置
- [ ] 50. S5: 引入外部引用 (References)
- [ ] 51. D5: /skill-create 命令化
- [ ] 52. D6: /refactor-clean 命令化

---

## Commit Strategy

| Phase | Pattern | Verification |
|-------|---------|--------------|
| Phase 1 | 每个增强项独立提交 | `bun test` |
| Phase 2 | 可按子系统批量提交 | `bun test && bun run typecheck` |
| Phase 3 | 按需提交 | `bun test` |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck  # Expected: 0 errors
bun test           # Expected: all tests pass
bun run build      # Expected: successful build
```

### Final Checklist
- [ ] 所有 17 项高优先级增强完成
- [ ] 每项增强有对应测试
- [ ] 文档更新完成
- [ ] 无回归错误
- [ ] `bun run build && bun test` 全部通过

---

## 涉及核心文件清单

| 文件路径 | 增强项数 | 主要增强 |
|:---------|:--------:|:---------|
| `src/hooks/tdd-guard/index.ts` | 5 | R3, T2, T3 |
| `src/hooks/rules-injector/index.ts` | 4 | R1, R2, R6, R7 |
| `src/features/context-injector/collector.ts` | 3 | C1, C2, A5 |
| `src/agents/oracle.ts` | 2 | G1 |
| `src/agents/prometheus-prompt.ts` | 2 | D1 |
| `src/mcp/index.ts` | 3 | M1, M3, M4 |
| `src/features/builtin-skills/skills.ts` | 2 | S1, S3 |
| `src/hooks/atlas/index.ts` | 2 | A1, A2 |
| `src/features/background-agent/manager.ts` | 2 | A3, G4 |

---

*本计划由 Prometheus 生成，基于 ENHANCEMENT-LIST.md 分析*
*执行: 运行 `/start-work` 开始实施*
