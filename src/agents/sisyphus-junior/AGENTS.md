---
name: sisyphus-junior-agent
description: 开发者参考 — Sisyphus-Junior 按类别派生的执行 Agent，含模型变体和纪律。
---

# src/agents/sisyphus-junior/ -- 按类别派生的执行器

**生成时间:** 2026-05-18

## 概述

10 个文件。Sisyphus-Junior 是一个专注的任务执行器，由 `delegate-task` 在类别路由需要时派生。以子 Agent 模式运行，拥有自己的降级链。不再进一步委派；直接执行。

## 文件列表

| 文件 | 用途 |
|------|------|
| `agent.ts` | `createSisyphusJuniorAgentWithOverrides()` 工厂、模型变体路由、`SISYPHUS_JUNIOR_DEFAULTS` |
| `index.ts` | 桶导出 |
| `default.ts` | 基础/Claude 提示词：待办纪律、验证、终止规则 |
| `gemini.ts` | Gemini 优化提示词变体 |
| `gpt.ts` | 基础 GPT 提示词变体 |
| `gpt-5-3-codex.ts` | GPT-5.3 Codex 提示词变体 |
| `gpt-5-4.ts` | GPT-5.4 原生提示词变体 |
| `gpt-5-5.ts` | GPT-5.5 原生提示词变体 |
| `kimi-k2-6.ts` | Kimi K2.6 提示词变体 |
| `index.test.ts` | 单元测试 |

## 变体选择

父 `agent.ts` 根据模型名称选择提示词变体：
- 包含 "kimi-k2" -> `kimi-k2-6.ts`
- 包含 "gpt-5.5" -> `gpt-5-5.ts`
- 包含 "gpt-5.4" -> `gpt-5-4.ts`
- 包含 "gpt-5.3-codex" -> `gpt-5-3-codex.ts`
- 包含 "gpt" -> `gpt.ts`
- 包含 "gemini" -> `gemini.ts`
- 默认 -> `default.ts`（Claude、GLM 等）

## 关键行为

- 模式：`subagent`（使用自己的降级链，忽略 UI 选择）
- 默认模型：`claude-sonnet-4-6`
- 默认温度：`0.1`（`SISYPHUS_JUNIOR_DEFAULTS`）
- 降级链：kimi-k2.6 -> gpt-5.5 medium -> minimax-m2.7 -> big-pickle
- 禁止工具：`task`（所有模型）；GPT 模型也禁止 `apply_patch`
- 明确允许 `call_omo_agent`，以便子 Agent 可以派生 explore/librarian
- 最大令牌数：64000
- 对非 GPT/非 GLM 模型启用思考（budgetTokens: 32000）
- GPT 模型的推理努力为 "medium"
