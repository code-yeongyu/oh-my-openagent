# script/ -- 构建/发布自动化

**生成时间:** 2026-05-18

## 概述

构建和发布自动化脚本。通过根目录 `package.json` 的 `bun run <script>` 运行。共 13 个文件（10 个源码 + 3 个测试）。目录名采用单数形式（不是 "scripts/"）。

## 脚本列表

| 文件 | 用途 |
|------|------|
| `build-binaries.ts` | 通过 `bun compile` 构建 11 个平台二进制文件（darwin/linux/windows，AVX2 + baseline） |
| `build-schema.ts` | 将 Zod schema 转换为 `assets/oh-my-opencode.schema.json` 的 JSON Schema |
| `build-schema-document.ts` | 辅助函数：为 build-schema.ts 提供 `createOhMyOpenCodeJsonSchema()` |
| `build-model-capabilities.ts` | 从 models.dev 刷新 `src/generated/model-capabilities.generated.json` |
| `patch-node-require-shim.ts` | 修补 `dist/index.js` 以实现 Node/Electron require 兼容性 |
| `publish.ts` | 本地多包发布替代方案（平台包 + npm） |
| `generate-changelog.ts` | 从 git log 生成发布说明，过滤机器人提交 |
| `run-ci-tests.ts` | 测试隔离：将 `mock.module()` 用户与共享测试分离 |

## 测试文件

| 文件 | 覆盖范围 |
|------|---------|
| `build-binaries.test.ts` | 平台目标验证 |
| `build-schema.test.ts` | JSON Schema 生成 |
| `publish-workflow.test.ts` | 发布逻辑 |
| `run-ci-tests.test.ts` | 隔离运行器 |

## 通过 PACKAGE.JSON 运行

- `bun run build:binaries` → build-binaries.ts
- `bun run build:schema` → build-schema.ts
- `bun run build:model-capabilities` → build-model-capabilities.ts

## TSCONFIG

`tsconfig.json` 是脚本专用的（与 `src/` 分开）。只包含 `publish-workflow.test.ts`。

## 注意

`run-ci-tests.ts` 在 `ci.yml` 中被引用，但 CI 现在使用普通的 `bun test`（无分片或分离隔离运行器）。隔离逻辑保留供本地使用。
