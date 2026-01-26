# Oh-My-OpenCode Hooks 真实环境测试计划

## 概述

- **目标**: 在真实 OpenCode 环境中验证所有 44 个 hooks 的功能
- **测试时间**: 2026-01-24
- **关键原则**: 不同 Agent 的 hooks 必须分开测试，不能混在一起

---

## Agent 分类说明

| Agent | 说明 | 可测试的 Hooks |
|-------|------|----------------|
| **Prometheus** | 规划器，当前会话 | 只能测试规划类、只读类 hooks |
| **Sisyphus** | 主编排器 | 可测试写入类、编排类、委派类 hooks |
| **build** | 默认构建 Agent | 基础工具类 hooks |
| **explore/librarian** | 子代理 | 后台任务类 hooks |

---

## 已完成测试 (8/44)

| # | Hook | Agent | 结果 | 备注 |
|---|------|-------|------|------|
| 1 | directory-agents-injector | 全局 | ✅ | 正确注入 AGENTS.md |
| 2 | agent-usage-reminder | 全局 | ✅ | 使用 glob/grep 时提醒 |
| 3 | prometheus-md-only | Prometheus | ✅ | 阻止写入 .ts 文件 |
| 4 | tool-output-truncator | 全局 | ✅ | 61匹配未截断(未达阈值) |
| 5 | todo-continuation-enforcer | Sisyphus | ✅ | 已修复并测试，30测试通过 |
| 6 | comment-checker | Sisyphus | ❌ | 二进制存在但未触发，需DEBUG |
| 7 | directory-readme-injector | 全局 | ❌ | 读取 src/index.ts 未注入 |

---

## Part 1: Prometheus Agent 可测试 Hooks (当前会话)

### 1.1 只读/注入类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 8 | rules-injector | 读取匹配 globs 的文件 | 创建 .claude/rules/*.md 后读取 | 待测试 |
| 9 | mdsel-reminder | 读取大型 .md 文件 | 读取 200+ 词的 markdown | 待测试 |
| 10 | compaction-context-injector | 会话压缩时 | 需触发压缩 | 待测试 |

### 1.2 Prometheus 专用 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 11 | plan-attention-refresher | 长时间规划 | 持续规划任务 | 待测试 |
| 12 | planning-flow-guide | 规划流程 | 执行规划任务 | 待测试 |

### 1.3 全局监控类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 13 | context-window-monitor | 上下文 70%+ | 长对话触发 | 待测试 |
| 14 | auto-update-checker | 启动时 | 观察启动日志 | 待测试 |
| 15 | session-notification | 会话空闲 | 等待空闲 | 待测试 |

---

## Part 2: Sisyphus Agent 专用 Hooks (需切换到 Sisyphus)

### 2.1 写入/编辑类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 16 | comment-checker | Write/Edit 后 | 写入带注释代码 | ❌ 需DEBUG |
| 17 | edit-error-recovery | Edit 失败后 | 编辑不存在内容 | ⚠️ 需验证 |
| 18 | tdd-guard | 编辑代码前 | 编辑无测试代码 | 待测试 |
| 19 | lsp-diagnostics-enforcer | 编辑后检查 | 编辑有错误代码 | 待测试 |

### 2.2 编排/委派类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 20 | sisyphus-orchestrator | Sisyphus 运行时 | 观察任务委派 | 待测试 |
| 21 | delegate-task-retry | 委派任务失败 | 触发任务失败重试 | 待测试 |
| 22 | subagent-verification | 子代理完成后 | 验证子代理结果 | 待测试 |
| 23 | task-resume-info | 任务恢复 | 恢复中断任务 | 待测试 |
| 24 | background-compaction | 后台任务压缩 | 长时间后台任务 | 待测试 |
| 25 | background-notification | 后台任务完成 | 启动后台任务 | 待测试 |

### 2.3 TODO/计划类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 26 | todo-continuation-enforcer | Stop 时检查 TODO | 有未完成 TODO 停止 | ✅ 已修复 |
| 27 | plan-reorganizer | 计划重组 | 修改计划文件 | 待测试 |
| 28 | plan-update-reminder | 任务完成后 | 完成任务 | 待测试 |

### 2.4 循环/自动化类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 29 | ralph-loop | /ralph-loop 命令 | 执行命令 | 待测试 |
| 30 | start-work | /start-work 命令 | 执行命令 | 待测试 |

---

## Part 3: 全局 Hooks (任何 Agent 可测试)

### 3.1 用户输入类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 31 | keyword-detector | ultrawork/search 等 | 输入关键词 | 待测试 |
| 32 | think-mode | "think deeply" 等 | 输入触发词 | 待测试 |
| 33 | auto-slash-command | /command 模式 | 输入斜杠命令 | 待测试 |
| 34 | skill-suggestion | 任务匹配 skill | 执行匹配任务 | 待测试 |
| 35 | agent-skill-reminder | skill 提示 | 观察 skill 提示 | 待测试 |

### 3.2 工具执行类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 36 | non-interactive-env | 环境变量检测 | 检查处理 | 待测试 |
| 37 | interactive-bash-session | tmux 会话 | 使用 interactive_bash | 待测试 |
| 38 | thinking-block-validator | thinking 块验证 | ultrathink 触发 | 待测试 |
| 39 | claude-code-hooks | settings.json 兼容 | 检查 hooks 执行 | 待测试 |
| 40 | empty-task-response-detector | Task 空响应 | 触发空响应 | 待测试 |

---

## Part 4: 特殊条件 Hooks (需要特定场景)

### 4.1 错误/恢复类 Hooks

| # | Hook | 触发条件 | 测试方法 | 状态 |
|---|------|----------|----------|------|
| 41 | session-recovery | 会话错误 | 触发会话错误 | 待测试 |
| 42 | anthropic-context-window-limit-recovery | token 超限 | 超出 token 限制 | 待测试 |
| 43 | debugging-injector | 连续失败 2+ 次 | 触发多次失败 | 待测试 |
| 44 | failure-counter | 失败计数 | 连续失败 | 待测试 |

### 4.2 Opt-in Hooks (需配置启用)

| # | Hook | 配置项 | 测试方法 | 状态 |
|---|------|--------|----------|------|
| 45 | codebase-assessment | hooks.codebase-assessment | 启用后执行 | 待测试 |
| 46 | phase-flow-enforcer | hooks.phase-flow-enforcer | 启用后执行 | 待测试 |

---

## 问题 Hooks 详细调查

### 🔴 comment-checker (高优先级)

**现象**: 写入 16+ 行注释的代码文件，未触发警告

**调查发现**:
- 二进制文件存在: `$LOCALAPPDATA\oh-my-opencode\bin\comment-checker.exe` ✅
- Hook 注册: `src/index.ts` 第 594, 673 行 ✅

**可能原因**:
1. `output.output +=` 追加内容但终端未渲染
2. CLI 返回 exitCode=0（判断无过多注释）
3. pendingCall 未正确匹配 callID

**验证步骤**:
```bash
set COMMENT_CHECKER_DEBUG=1
# 在 Sisyphus 中写入带注释文件
type %TEMP%\comment-checker-debug.log
```

### 🟡 directory-readme-injector (高优先级)

**现象**: 读取 src/index.ts 未注入 README

**可能原因**: 只在读取**子目录**中有 README.md 的文件时触发

**验证步骤**:
1. 在 src/ 目录创建 README.md
2. 读取 src/ 下的文件
3. 观察是否注入

### 🟢 edit-error-recovery (中优先级)

**现象**: 只显示标准错误 `oldString not found`，无额外恢复提示

**可能原因**: Hook 设计为静默处理或只在特定错误类型触发

---

## 测试执行计划

### Wave 1: Prometheus 会话测试 (当前)
- [ ] rules-injector
- [ ] mdsel-reminder
- [ ] context-window-monitor
- [ ] plan-attention-refresher
- [ ] planning-flow-guide

### Wave 2: 切换到 Sisyphus 测试
- [ ] comment-checker DEBUG 验证
- [ ] edit-error-recovery 验证
- [ ] tdd-guard
- [ ] sisyphus-orchestrator
- [ ] delegate-task-retry
- [ ] ralph-loop
- [ ] start-work

### Wave 3: 全局 Hooks 测试
- [ ] keyword-detector
- [ ] think-mode
- [ ] auto-slash-command
- [ ] skill-suggestion
- [ ] interactive-bash-session

### Wave 4: 特殊条件测试
- [ ] session-recovery
- [ ] debugging-injector
- [ ] anthropic-context-window-limit-recovery

---

## 完成标准

- [ ] 所有 44+ hooks 按 Agent 分类测试完成
- [ ] 问题 hooks 根因确认并修复
- [ ] 每个 hook 测试结果记录在此文档
