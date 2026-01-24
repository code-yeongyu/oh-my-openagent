# 将 mdsel 集成为 oh-my-opencode Built-in Skill

## Context

### Original Request
将独立的 mdsel skill（目前在 `~/.claude/skills/mdsel/`）完全集成到 oh-my-opencode 中，作为 built-in skill 提供。

### Interview Summary
**Key Discussions**:
- Hook 集成方式: 扩展 `BuiltinSkill` 类型，添加 hooks 字段
- CLI 打包方式: 预编译 bundle（零运行时依赖，~70KB）

**Research Findings**:
- 现有 `BuiltinSkill` 类型在 `src/features/builtin-skills/types.ts`
- Hook 创建使用 `createXXXHook` 工厂模式
- 现有 built-in skills 如 playwright 使用 `mcpConfig` 集成外部工具
- mdsel reminder hook 已有完整的 CJS 实现可参考

---

## Work Objectives

### Core Objective
扩展 oh-my-opencode 架构以支持 built-in skill 嵌入式 hooks，并将 mdsel 作为首个使用该特性的 skill 集成。

### Concrete Deliverables
- `src/features/builtin-skills/mdsel/SKILL.md` - Skill 指令文档
- `src/features/builtin-skills/mdsel/cli.mjs` - 预编译的 CLI bundle
- `src/features/builtin-skills/types.ts` - 扩展支持 hooks 字段
- `src/features/builtin-skills/skills.ts` - 新增 mdselSkill 定义
- `src/hooks/mdsel-reminder/index.ts` - PostToolUse hook 实现

### Definition of Done
- [ ] `bun run build` 成功，无类型错误
- [ ] `bun test` 全部通过
- [ ] 读取 .md 文件 (>200 words) 后显示 mdsel reminder
- [ ] 可通过 `disabled_skills: ["mdsel"]` 禁用
- [ ] README.md 更新说明新增的 mdsel skill

### Must Have
- PostToolUse hook 在 Read 工具读取 .md 文件后触发
- 预编译的 CLI bundle 嵌入 dist/ 输出
- 遵循现有代码风格和模式

### Must NOT Have (Guardrails)
- 不添加运行时 npm install 逻辑
- 不修改现有 hook 的行为
- 不引入新的外部依赖（CLI bundle 自包含）
- 不破坏现有 disabled_skills 配置逻辑

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (bun test)
- **User wants tests**: YES (TDD)
- **Framework**: bun test

### TDD Workflow
Each TODO follows RED-GREEN-REFACTOR:
1. **RED**: Write failing test first
2. **GREEN**: Implement minimum code to pass
3. **REFACTOR**: Clean up while keeping green

---

## Task Flow

```
Task 1 (Types) → Task 2 (Hook) → Task 3 (Skill) → Task 4 (CLI Bundle)
                                        ↓
                               Task 5 (Registration)
                                        ↓
                               Task 6 (Integration Test)
                                        ↓
                               Task 7 (Docs)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 1 | Foundation - must complete first |
| B | 2, 4 | Independent: hook impl & CLI bundle |
| C | 3 | Depends on 1 (types) |
| D | 5, 6, 7 | Depends on 2, 3, 4 |

---

## TODOs

- [x] 1. 扩展 BuiltinSkill 类型支持 hooks

  **What to do**:
  - 在 `src/features/builtin-skills/types.ts` 添加 `hooks` 可选字段
  - 定义 `BuiltinSkillHookConfig` 接口
  - 支持 `PostToolUse` 和 `PreToolUse` 事件类型

  **Must NOT do**:
  - 不修改 `mcpConfig` 相关逻辑
  - 不改变现有接口的必填字段

  **Parallelizable**: NO (foundation for other tasks)

  **References**:
  - `src/features/builtin-skills/types.ts:1-17` - 现有 BuiltinSkill 接口定义
  - `src/hooks/index.ts` - Hook 导出模式参考
  - `src/shared/hook-types.ts` - 如存在，参考 hook 类型定义

  **Acceptance Criteria**:
  - [ ] Test file: `src/features/builtin-skills/types.test.ts`
  - [ ] Test: BuiltinSkill 接口接受 hooks 字段
  - [ ] `bun test src/features/builtin-skills/types.test.ts` → PASS
  - [ ] `bun run typecheck` → 无错误

  **Commit**: YES
  - Message: `feat(builtin-skills): extend BuiltinSkill type to support embedded hooks`
  - Files: `src/features/builtin-skills/types.ts`, `src/features/builtin-skills/types.test.ts`

---

- [x] 2. 创建 mdsel-reminder hook 模块

  **What to do**:
  - 创建 `src/hooks/mdsel-reminder/index.ts`
  - 实现 `createMdselReminderHook` 工厂函数
  - 移植 `~/.claude/skills/mdsel/scripts/mdsel-reminder.cjs` 逻辑到 TypeScript
  - 使用 PostToolUse 事件，matcher 匹配 `Read` 工具

  **Must NOT do**:
  - 不依赖外部 CLI 执行
  - 不阻塞主线程（同步读取 OK，但要快）

  **Parallelizable**: YES (with 4)

  **References**:
  - `~/.claude/skills/mdsel/scripts/mdsel-reminder.cjs:1-59` - 完整 reminder 逻辑
  - `src/hooks/comment-checker/index.ts` - PostToolUse hook 模式参考
  - `src/hooks/agent-usage-reminder/index.ts` - 类似的 reminder hook 参考

  **Acceptance Criteria**:
  - [ ] Test file: `src/hooks/mdsel-reminder/index.test.ts`
  - [ ] Test: .md 文件 >200 words 触发 reminder
  - [ ] Test: .md 文件 <200 words 不触发
  - [ ] Test: 非 .md 文件不触发
  - [ ] `bun test src/hooks/mdsel-reminder` → PASS

  **Commit**: YES
  - Message: `feat(hooks): add mdsel-reminder PostToolUse hook`
  - Files: `src/hooks/mdsel-reminder/index.ts`, `src/hooks/mdsel-reminder/index.test.ts`

---

- [x] 3. 创建 mdsel skill 定义

  **What to do**:
  - 创建 `src/features/builtin-skills/mdsel/SKILL.md`
  - 在 `src/features/builtin-skills/skills.ts` 添加 `mdselSkill` 定义
  - 使用 `readBuiltinSkillTemplate` 加载 SKILL.md
  - 设置 description 触发词: markdown, .md, README, documentation

  **Must NOT do**:
  - 不包含 MCP 配置（mdsel 不需要）
  - 不硬编码 SKILL.md 内容（使用模板加载）

  **Parallelizable**: NO (depends on 1)

  **References**:
  - `~/.claude/skills/mdsel/SKILL.md:1-158` - 完整 skill 内容模板
  - `src/features/builtin-skills/skills.ts:32-45` - playwrightSkill 定义参考
  - `src/features/builtin-skills/skills.ts:123-128` - creatingChangesSkill 使用 readBuiltinSkillTemplate

  **Acceptance Criteria**:
  - [ ] `src/features/builtin-skills/mdsel/SKILL.md` 存在
  - [ ] `bun run typecheck` → 无错误
  - [ ] mdselSkill 出现在 `createBuiltinSkills` 返回数组中

  **Commit**: YES
  - Message: `feat(builtin-skills): add mdsel skill definition`
  - Files: `src/features/builtin-skills/mdsel/SKILL.md`, `src/features/builtin-skills/skills.ts`

---

- [x] 4. 预编译 mdsel CLI bundle

  **What to do**:
  - 从 `~/.claude/skills/mdsel/cli/` 复制源码到 `src/features/builtin-skills/mdsel/cli-src/`
  - 创建 `script/build-mdsel-cli.ts` 构建脚本
  - 使用 `bun build` 生成单文件 `cli.mjs`
  - 将 bundle 输出到 `src/features/builtin-skills/mdsel/cli.mjs`
  - 更新 `package.json` scripts 添加 `build:mdsel-cli`

  **Must NOT do**:
  - 不在运行时执行 npm install
  - 不保留 node_modules（使用 bundled 依赖）

  **Parallelizable**: YES (with 2)

  **References**:
  - `~/.claude/skills/mdsel/cli/src/` - CLI 源码 (6 modules)
  - `~/.claude/skills/mdsel/cli/tsup.config.ts` - 现有构建配置参考
  - `script/build-schema.ts` - 项目构建脚本模式参考

  **Acceptance Criteria**:
  - [ ] `bun run build:mdsel-cli` 成功
  - [ ] 生成 `src/features/builtin-skills/mdsel/cli.mjs`
  - [ ] Bundle size < 100KB
  - [ ] `node src/features/builtin-skills/mdsel/cli.mjs --help` 正常输出

  **Commit**: YES
  - Message: `build(mdsel): add CLI source and bundle script`
  - Files: `src/features/builtin-skills/mdsel/cli-src/*`, `script/build-mdsel-cli.ts`, `package.json`

---

- [x] 5. 注册 mdsel hook 到主入口

  **What to do**:
  - 在 `src/hooks/index.ts` 导出 `createMdselReminderHook`
  - 在 `src/index.ts` 导入并注册 hook
  - 添加到 `disabled_hooks` 配置支持 (名称: `mdsel-reminder`)
  - 确保 hook 只在 mdsel skill 启用时生效

  **Must NOT do**:
  - 不改变其他 hooks 的注册顺序
  - 不硬编码启用/禁用逻辑

  **Parallelizable**: NO (depends on 2, 3)

  **References**:
  - `src/index.ts:1-100` - Plugin 主入口，hook 注册模式
  - `src/hooks/index.ts` - Hook 导出聚合
  - `src/config/schema.ts` - disabled_hooks 配置

  **Acceptance Criteria**:
  - [ ] `bun run typecheck` → 无错误
  - [ ] `bun run build` 成功
  - [ ] Hook 出现在可禁用列表中

  **Commit**: YES
  - Message: `feat(hooks): register mdsel-reminder hook in main entry`
  - Files: `src/hooks/index.ts`, `src/index.ts`

---

- [x] 6. 集成测试

  **What to do**:
  - 创建 `src/features/builtin-skills/mdsel/mdsel.integration.test.ts`
  - 测试完整流程: Read .md → hook 触发 → reminder 输出
  - 测试 disabled_skills: ["mdsel"] 禁用功能
  - 测试 CLI bundle 可执行

  **Must NOT do**:
  - 不 mock 文件系统（使用真实临时文件）
  - 不跳过任何边界条件

  **Parallelizable**: NO (depends on 2, 3, 4, 5)

  **References**:
  - `src/features/builtin-skills/skills.test.ts` - 现有 skills 测试模式
  - `src/hooks/comment-checker/index.test.ts` - Hook 测试模式参考

  **Acceptance Criteria**:
  - [ ] `bun test src/features/builtin-skills/mdsel` → PASS
  - [ ] 测试覆盖: 启用、禁用、阈值边界
  - [ ] 测试覆盖: CLI bundle 基本功能

  **Commit**: YES
  - Message: `test(mdsel): add integration tests for mdsel skill`
  - Files: `src/features/builtin-skills/mdsel/mdsel.integration.test.ts`

---

- [x] 7. 更新文档

  **What to do**:
  - 更新 `README.md` Built-in Skills 章节
  - 添加 mdsel skill 说明和使用示例
  - 更新 `disabled_skills` 列表包含 `mdsel`
  - 更新 `disabled_hooks` 列表包含 `mdsel-reminder`

  **Must NOT do**:
  - 不重复 SKILL.md 中的详细语法文档
  - 不添加不必要的章节

  **Parallelizable**: YES (can run after 5, 6)

  **References**:
  - `README.md` - Built-in Skills 章节位置
  - `src/features/builtin-skills/mdsel/SKILL.md` - 详细文档来源

  **Acceptance Criteria**:
  - [ ] README.md 包含 mdsel skill 说明
  - [ ] disabled_skills 列表更新
  - [ ] disabled_hooks 列表更新

  **Commit**: YES
  - Message: `docs: add mdsel to built-in skills documentation`
  - Files: `README.md`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `feat(builtin-skills): extend BuiltinSkill type to support embedded hooks` | types.ts, types.test.ts | bun test |
| 2 | `feat(hooks): add mdsel-reminder PostToolUse hook` | mdsel-reminder/*.ts | bun test |
| 3 | `feat(builtin-skills): add mdsel skill definition` | mdsel/SKILL.md, skills.ts | bun typecheck |
| 4 | `build(mdsel): add CLI source and bundle script` | cli-src/*, build-mdsel-cli.ts | bun run build:mdsel-cli |
| 5 | `feat(hooks): register mdsel-reminder hook in main entry` | hooks/index.ts, index.ts | bun build |
| 6 | `test(mdsel): add integration tests for mdsel skill` | mdsel.integration.test.ts | bun test |
| 7 | `docs: add mdsel to built-in skills documentation` | README.md | - |

---

## Success Criteria

### Verification Commands
```bash
bun run typecheck          # Expected: 0 errors
bun run build              # Expected: success
bun test                   # Expected: all pass
bun run build:mdsel-cli    # Expected: cli.mjs generated

# Manual verification
node dist/features/builtin-skills/mdsel/cli.mjs README.md  # Expected: index output
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] README updated
- [ ] No regressions in existing functionality
