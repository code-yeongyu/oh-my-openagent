# src/features/opencode-skill-loader/ — 4 作用域技能发现

**生成时间:** 2026-05-15

## 概述

28 个文件（约 3.2k 行）。从 4 个作用域发现、解析、合并和解析 SKILL.md 文件，带优先级去重。

## 4 作用域优先级（从高到低）

```
1. 项目级别 (.opencode/skills/)
2. OpenCode 配置 (~/.config/opencode/skills/)
3. 用户级别 (~/.config/opencode/oh-my-opencode/skills/)
4. 全局 (内置技能)
```

同名技能，高作用域覆盖低作用域。

## 关键文件

| 文件 | 用途 |
|------|------|
| `loader.ts` | 主 `loadSkills()` — 编排发现 → 解析 → 合并 |
| `async-loader.ts` | 异步变体，用于非阻塞技能加载 |
| `blocking.ts` | 同步变体，用于初始加载 |
| `merger.ts` | 基于优先级的作用域间去重 |
| `skill-content.ts` | 从 SKILL.md 解析 YAML frontmatter |
| `skill-discovery.ts` | 在目录树中查找 SKILL.md 文件 |
| `skill-directory-loader.ts` | 从单个目录加载所有技能 |
| `config-source-discovery.ts` | 从配置中发现作用域目录 |
| `skill-template-resolver.ts` | 技能模板中的变量替换 |
| `skill-mcp-config.ts` | 从技能 YAML 中提取 MCP 配置 |
| `types.ts` | `LoadedSkill`、`SkillScope`、`SkillDiscoveryResult` |

## 技能格式 (SKILL.md)

```markdown
---
name: my-skill
description: 此技能的用途
tools: [Bash, Read, Write]
mcp:
  - name: my-mcp
    type: stdio
    command: npx
    args: [-y, my-mcp-server]
---

技能内容（Agent 的指令）...
```

## 合并子目录

处理当多个作用域中的技能具有重叠名称或 MCP 配置时的复杂合并逻辑。

## 模板解析

技能内容中的 `{{directory}}`、`{{agent}}` 等变量在加载时根据当前上下文解析。
