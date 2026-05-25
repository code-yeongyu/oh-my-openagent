# src/features/builtin-commands/ -- 内置斜杠命令

**生成时间:** 2026-05-18

## 概述

插件内置的命令注册表。每个命令是一个模板字面量，包含标题、描述和指令。通过 `commands.ts` 中的 `createBuiltinCommandDefinitions()` 工厂注册。由 `claude-code-command-loader` 加载。

## 文件目录

| 文件 | 用途 |
|------|------|
| `commands.ts` | `createBuiltinCommandDefinitions()` 工厂 + `loadBuiltinCommands()` 过滤器 |
| `index.ts` | 桶导出 |
| `types.ts` | `BuiltinCommandName` 联合类型 + `BuiltinCommandConfig` |
| `templates/` | 每个命令一个 `.ts` 文件 |

## 命令模板

| 命令 | 源文件 | 说明 |
|------|--------|------|
| `init-deep` | `templates/init-deep.ts` | 层级 AGENTS.md 生成器 |
| `ralph-loop` | `templates/ralph-loop.ts` | 自指开发循环 |
| `ulw-loop` | `templates/ralph-loop.ts` | 超工作循环变体 |
| `cancel-ralph` | `templates/ralph-loop.ts` | 循环取消 |
| `refactor` | `templates/refactor.ts` | LSP + AST-grep 重构 |
| `start-work` | `templates/start-work.ts` | Prometheus 计划执行器 |
| `stop-continuation` | `templates/stop-continuation.ts` | 终止所有继续机制 |
| `handoff` | `templates/handoff.ts` | 会话上下文摘要 |
| `remove-ai-slops` | `templates/remove-ai-slops.ts` | AI 代码异味清理 |
| `hyperplan` | `templates/hyperplan.ts` | 对抗性团队模式规划 |

## 结构

每个模板导出一个包含命令系统提示词的字符串常量。`commands.ts` 将其包装在 `<command-instruction>` XML 中，并在需要时注入 `$ARGUMENTS`、`$SESSION_ID` 和 `$TIMESTAMP`。某些命令在 `teamModeEnabled` 为 true 时会追加团队模式附录。

## 加载

配置加载的第 6 阶段（`command-config-handler.ts`）将内置命令与来自 `.opencode/commands/` 和 Claude Code 插件的用户安装命令合并。配置中的 `disabled_commands` 按名称过滤特定的内置命令。`src/hooks/` 中的 `autoSlashCommand` 钩子在用户输入时执行这些命令。

## 测试

`templates/` 中同目录的 `.test.ts` 文件覆盖 `ralph-loop` 和 `stop-continuation` 的逻辑测试。
