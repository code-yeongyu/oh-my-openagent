# src/tools/skill/ -- 技能和命令加载工具

**生成时间:** 2026-05-18

## 概述

`skill` 工具。双重用途：(1) 按名称加载技能，将其 SKILL.md 内容注入到上下文；(2) 按名称调用斜杠命令（省略前导斜杠）。技能可以按需启动嵌入式 MCP 服务器。命令通过 autoSlashCommand 钩子路由。

## 文件目录

| 文件 | 用途 |
|------|---------|
| `tools.ts` | `createSkillTool` 工厂 — 解析名称，加载内容，返回格式化输出 |
| `skill-body.ts` | 提取 `<skill-instruction>` 块或完整 SKILL.md 模板 |
| `skill-matcher.ts` | 精确匹配、短名称回退、部分匹配建议 |
| `scope-priority.ts` | 4 级作用域优先级：project (4) > user (3) > opencode (2) > builtin/plugin (1) |
| `native-skills.ts` | 将 `PluginInput.skills` 条目合并到已发现的技能列表中 |
| `description-formatter.ts` | 构建 LLM 可见的 `<available_items>` 列表，附带作用域标签 |
| `mcp-capability-formatter.ts` | 列出技能嵌入的 MCP 工具/资源/提示，供 `skill_mcp` 调用 |
| `session-skill-cache.ts` | 通过 `seenSessionIDs` 对每会话重复技能加载去重 |
| `types.ts` | `SkillArgs`、`SkillInfo`、`SkillLoadOptions` |
| `constants.ts` | 工具名称和描述前缀 |
| `index.ts` | 桶导出 |

## 执行流程

```
skill(name="git-master")
  -> matchSkillByName()    # 精确匹配，然后是短名称
  -> ask(permission)       # 宿主技能权限门
  -> extractSkillBody()    # 加载 SKILL.md 内容
  -> formatMcpCapabilities()  # 如果技能有 mcpConfig
  -> return "## Skill: ..." + body + MCP info
```

## 作用域优先级

项目配置覆盖用户配置，用户配置覆盖 opencode 内置。`sortByScopePriority` 应用于 `<available_items>` 列表中的技能和斜杠命令。

## 测试 Mock

`zauc-mocks-skill-tools/` — 技能工具测试的 `mock.module()` 设置。通过 `zauc-` 前缀排序顺序技巧，在消费测试之前按字母顺序加载。

## 集成

- 发现：`opencode-skill-loader` 功能模块扫描 `.opencode/skills/`、`~/.config/opencode/skills/` 和内置路径
- MCP 孵化：`skill-mcp-manager` 功能模块按需启动每个会话的嵌入式 MCP 服务器
- 命令：`slashcommand/` 模块将发现的命令馈送到工具描述中
