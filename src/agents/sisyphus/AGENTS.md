---
name: sisyphus-variants
description: 开发者参考 — Sisyphus 编排器的模型特定提示词变体，含选择逻辑和关键导出。
---

# src/agents/sisyphus/ -- 编排器变体

**生成时间:** 2026-05-15

## 概述

5 个提示词/导出文件。Sisyphus 主编排器的模型特定提示词变体。父 `sisyphus.ts` 根据当前活动模型路由到正确的变体。

## 文件列表

| 文件 | 用途 |
|------|------|
| `default.ts` | 基础/Claude 变体：任务管理、委派指南，542 行 |
| `gemini.ts` | Gemini 优化：更严格的工具使用规则，5 条绝不规则 |
| `gpt-5-4.ts` | GPT-5.4 原生：8 块架构，降低熵，449 行 |
| `gpt-5-5.ts` | GPT-5.5 原生：针对 GPT-5.5 调优的更新编排提示词 |
| `index.ts` | 桶导出 |

## 变体选择

父 `sisyphus.ts` 根据模型名称选择变体：
- 包含 "gemini" -> `gemini.ts`
- 包含 "gpt-5.5" -> `gpt-5-5.ts`
- 包含 "gpt-5.4" -> `gpt-5-4.ts`
- 默认 -> `default.ts`（Claude、Kimi、GLM 等）

## 关键导出

每个变体导出：
- `buildTaskManagementSection()` — 待办/任务管理提示词
- `buildSisyphusPrompt()` 或等效方法 — 完整提示词构建器
