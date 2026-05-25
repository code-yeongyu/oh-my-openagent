# src/hooks/auto-update-checker/ -- npm 更新检测

**生成时间:** 2026-05-18

## 概述

27 个文件。会话层钩子，在 `session.created` 时触发。检查 npm 注册表是否有更新的插件版本，与已安装版本比较，并通过启动提示显示更新信息。缓存结果以避免重复的注册表请求。按频道限流（`latest`、`next`、`beta`）。跳过 CLI 运行模式和子 Agent 会话。

## 文件目录

| 文件 | 用途 |
|------|---------|
| `index.ts` | 桶导出：钩子工厂、检查器、缓存失效、频道辅助函数 |
| `hook.ts` | `createAutoUpdateCheckerHook()` — 事件处理器，编排启动提示和后台检查 |
| `checker.ts` | `checker/` 子目录的桶导出 — 版本解析、本地开发检测、包入口查找 |
| `cache.ts` | `invalidatePackage()` — 从 bun.lock、node_modules 和 specifier 缓存中移除包 |
| `version-channel.ts` | `extractChannel()` — 将 dist-tags 和预发布版本解析为 npm 频道 |
| `types.ts` | `UpdateCheckResult`、`AutoUpdateCheckerOptions`、`NpmDistTags` |
| `constants.ts` | 注册表 URL、超时时间、缓存路径、接受的包名 |

## 子目录

- `checker/` — 11 个文件。核心版本检查逻辑：`check-for-update.ts`、`latest-version.ts`、`local-dev-version.ts`、`plugin-entry.ts`、`cached-version.ts`、`pinned-version-updater.ts`、`sync-package-json.ts` 及辅助函数。
- `hook/` — 9 个文件。启动用户体验：`background-update-check.ts`、`deferred-startup-check.ts`、`startup-toasts.ts`、`update-toasts.ts`、`spinner-toast.ts`、`config-errors-toast.ts`、`connected-providers-status.ts`、`model-capabilities-status.ts`、`model-cache-warning.ts`。

## 缓存

通过 OpenCode 缓存目录中的 `VERSION_FILE` 进行基于文件的去重（`getOpenCodeCacheDir()`）。防止过多的 npm 注册表调用。`invalidatePackage()` 通过从 Bun 的 lockfile、node_modules 和 specifier 缓存中清除包来强制进行全新检查。

## 版本频道

`extractChannel()` 映射：
- Dist-tags（`next`、`beta`）→ 直接映射为频道名
- 预发布版本（`1.0.0-beta.1`）→ 从预发布前缀确定频道（`alpha`、`beta`、`rc`、`canary`、`next`）
- 稳定版本 → `latest`

## 集成

在 `create-session-hooks.ts` 中注册为 `autoUpdateChecker`。属于会话层钩子组合的一部分。

## 相关

`src/hooks/` 中有三个 `zauc-mocks-*` 目录专门用于使用模拟依赖测试此钩子：
- `zauc-mocks-cache/` — 测试缓存失效路径
- `zauc-mocks-hook/` — 测试使用模拟子模块的钩子编排
- `zauc-mocks-bg/` — 测试后台检查调度

## 交叉引用

- 部分nt: [`src/hooks/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/AGENTS.md) -- Session Tier hook list
- [`src/cli/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/cli/AGENTS.md) -- CLI uses the same npm dist-tag helpers
