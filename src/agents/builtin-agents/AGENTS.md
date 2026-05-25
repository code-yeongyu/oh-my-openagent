---
name: builtin-agents-factory-layer
description: 条件工厂包装层，对 11 个 Agent 定义应用覆盖配置、模型解析、技能过滤和提供商门控。
---

# src/agents/builtin-agents/ -- 条件工厂层

**生成时间:** 2026-05-18

## 概述

位于 `src/agents/` 中 11 个原始 `createXXXAgent` 工厂之下的条件工厂层。每个 `maybeCreateXXXConfig` 包装器决定一个 Agent 是否注册，通过 4 步管道解析其模型，应用用户覆盖配置，过滤技能，并返回最终的 `AgentConfig` — 如果 Agent 被禁用或要求不满足则返回 `undefined`。输出供 `createPluginInterface` 使用。

## 文件目录

| 文件 | 用途 |
|------|------|
| `agent-overrides.ts` | 应用用户覆盖配置：类别扩展、model/temp/prompt/permissions 的 `deepMerge`、`file://` 提示词解析 |
| `model-resolution.ts` | 4 步管道包装器：`resolveModelPipeline`（覆盖 → 类别 → 提供商降级 → 系统默认）+ `getFirstFallbackModel` |
| `resolve-file-uri.ts` | 将 `file://` 路径转换为绝对路径，限定在项目根目录内，读取内容用于追加提示词 |
| `resolve-file-uri.test.ts` | URI 解码、路径扩展、项目根边界、缺失文件处理的测试 |
| `environment-context.ts` | 除非设置了 `disableOmoEnv`，否则向 Agent 提示词追加 `createEnvContext()` 块 |
| `available-skills.ts` | `buildAvailableSkills` — 合并内置技能与发现的用户技能，过滤已禁用的 |
| `available-skills.test.ts` | 内置 + 发现技能合并及禁用过滤的测试 |
| `sisyphus-agent.ts` | `maybeCreateSisyphusConfig` — 检查禁用列表、模型要求，应用覆盖配置 + frontier 工具 schema 守卫 + GPT 补丁守卫 |
| `sisyphus-agent.test.ts` | 禁用 Agent 过滤、模型解析、覆盖应用、首次运行降级行为的测试 |
| `hephaestus-agent.ts` | `maybeCreateHephaestusConfig` — 提供商门控（`requiresProvider`）、类别覆盖支持、变体默认 medium |
| `atlas-agent.ts` | `maybeCreateAtlasConfig` — 遵循 UI 选择的模型、变体解析 |
| `general-agents.ts` | `collectPendingBuiltinAgents` — 处理所有非特例 Agent（跳过 sisyphus/hephaestus/atlas/sisyphus-junior），批量模型解析和覆盖应用 |

## 管道适配

`plugin-handlers/config-handler.ts` 的第 3 阶段调用这些工厂。生成的 `AgentConfig` 数组供给 `createPluginInterface`。对已禁用的 Agent 或未满足的模型要求返回 `undefined`。
