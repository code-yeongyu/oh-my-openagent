# src/tools/look-at/ -- 图像和 PDF 分析工具

**生成时间:** 2026-05-18

## 概述

14 个文件。`look_at` 工具将图像、PDF 和图表分析委托给 `multimodal-looker` 子 Agent。条件门控：仅当 `multimodal-looker` 不在 `disabled_agents` 中时才注册该工具。默认子 Agent 模型：gpt-5.5 medium。这是一个摘要提取器，不是精确阅读器。

## 执行流程

1. **参数**（`look-at-arguments.ts`）— 标准化 `file_path`/`image_data` 别名，验证二选一要求，拒绝远程 URL
2. **准备**（`look-at-input-preparer.ts`）— 解析路径，从扩展名或 Base64 头检测 MIME，将不支持的图像转换为 JPEG
3. **孵化**（`look-at-session-runner.ts`）— 使用 `multimodal-looker` Agent 创建子会话，将文件作为消息部分附加，禁用 `task`/`call_omo_agent`/`look_at` 以防止递归
4. **轮询**（`session-poller.ts`）— 等待直到空闲（1 秒间隔，120 秒超时）
5. **提取**（`assistant-message-extractor.ts`）— 从会话消息中提取最新的助手文本
6. **返回** — 将摘要文本返回给调用者

## 文件目录

| 文件 | 职责 |
|------|----------------|
| `tools.ts` | `createLookAt()` 工厂 — 工具 schema + 入口点 |
| `look-at-arguments.ts` | Zod 参数 schema，标准化别名，验证输入 |
| `look-at-input-preparer.ts` | 从路径或 base64 构建 `LookAtFilePart`；在需要时触发转换 |
| `look-at-prompt.ts` | 多模态会话的系统提示 |
| `look-at-session-runner.ts` | 编排子会话创建、提示分发、消息获取 |
| `session-poller.ts` | 轮询会话状态直到空闲 |
| `assistant-message-extractor.ts` | 从原始会话消息中提取最新的助手文本 |
| `image-converter.ts` | 通过 sips 或 ImageMagick 将 HEIC/WebP/RAW/PSD 转换为 JPEG |
| `mime-type-inference.ts` | 从文件扩展名或 Base64 头检测 MIME |
| `missing-file-error.ts` | 当文件缺失时提供清晰的 `ENOENT` 错误消息 |
| `multimodal-agent-metadata.ts` | 从配置或动态管道解析 multimodal-looker 的实际模型 |
| `multimodal-fallback-chain.ts` | 构建支持视觉的降级链：kimi-k2.6、glm-4.6v、gpt-5-nano |
| `constants.ts` | `MULTIMODAL_LOOKER_AGENT`、`LOOK_AT_DESCRIPTION` |
| `types.ts` | `LookAtArgs` 接口 |

## 门控

条件性。仅当 `multimodal-looker` 不在 `disabled_agents` 中时才注册该工具。

## 使用场景

PDF、截图、图表 — 快速摘要提取。不适用于视觉精度、审美评估或精确准确性。那些情况请改用 Read 工具。

## 区别

这是委托给 `multimodal-looker` Agent 的**工具**。Agent 位于 `src/agents/builtin-agents/multimodal-looker.ts`；此工具是调用框架。

## 注意事项

- 临时转换的图像在 `finally` 块中清理
- 子 Agent 默认禁用 `read` 工具（`READ_ENABLED = false`）；文件作为附件传递
