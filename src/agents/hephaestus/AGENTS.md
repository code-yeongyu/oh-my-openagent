---
name: hephaestus-agent
description: 开发者参考 — Hephaestus 自主深度工作 Agent，含模型变体、关键行为和委派模式。
---

# src/agents/hephaestus/ -- 自主深度工作者

**生成时间:** 2026-05-15

## 概述

6 个文件。Hephaestus Agent — 由 GPT-5.5 驱动的自主深度工作者。目标导向：给它目标，而不是逐步指令。"真正的工匠"。

## 文件列表

| 文件 | 用途 |
|------|------|
| `agent.ts` | `createHephaestusAgent()` 工厂、模型变体路由 |
| `gpt.ts` | 基础 GPT 提示词：纪律规则、委派、验证 |
| `gpt-5-5.ts` | 针对当前 Hephaestus 路由调优的 GPT-5.5 原生提示词 |
| `gpt-5-4.ts` | GPT-5.4 原生提示词，含 XML 标签块，降低熵 |
| `gpt-5-3-codex.ts` | GPT-5.3 Codex 变体，含任务纪律章节 |
| `index.ts` | 桶导出 |

## 关键行为

- 模式：`primary`（遵循 UI 模型选择）
- 需要 OpenAI 兼容提供商（无降级链）
- 从不信任子 Agent 的自我报告 —— 总是验证
- 从不使用 `background_cancel(all=true)`
- 将探索委派给后台 Agent，从不串行
- 对 explore/librarian 使用 `run_in_background=true`

## 模型变体

| 模型 | 提示词来源 | 优化 |
|------|----------|------|
| gpt-5.5 | `gpt-5-5.ts` | GPT-5.5 调优的提示词架构 |
| gpt-5.4 | `gpt-5-4.ts` | XML 标签块，8 个章节 |
| gpt-5.3-codex | `gpt-5-3-codex.ts` | 任务纪律，549 行提示词 |
| 其他 GPT | `gpt.ts` | 基础提示词，507 行 |
