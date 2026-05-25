# src/cli/config-manager/ — CLI 安装工具

**生成时间:** 2026-05-15

## 概述

20 个文件。`install` 命令的无状态工具函数。处理 OpenCode 配置操作、提供商配置、JSONC 操作、二进制检测和 npm 注册表查询。无类 — 扁平的实用工具集合。

## 文件目录

| 文件 | 用途 |
|------|---------|
| `add-plugin-to-opencode-config.ts` | 在 `.opencode/opencode.json` 插件数组中注册 `oh-my-opencode` |
| `add-provider-config.ts` | 向 OpenCode 配置添加提供商 API 密钥（用户级）|
| `antigravity-provider-configuration.ts` | 处理 Antigravity 提供商设置（特殊情况）|
| `auth-plugins.ts` | 检测每个提供商的认证插件要求（oauth vs key）|
| `bun-install.ts` | 为插件设置运行 `bun install` / `npm install` |
| `config-context.ts` | `ConfigContext` — 跨安装步骤的共享配置状态 |
| `deep-merge-record.ts` | JSONC 配置对象的深度合并工具 |
| `detect-current-config.ts` | 读取现有 OpenCode 配置，检测已安装的插件 |
| `ensure-config-directory-exists.ts` | 如果缺失则创建 `.opencode/` 目录 |
| `format-error-with-suggestion.ts` | 格式化错误并附上可操作的建议 |
| `generate-omo-config.ts` | 从安装选项生成 `oh-my-opencode.jsonc` |
| `jsonc-provider-editor.ts` | 读取/写入 JSONC 文件，保留注释 |
| `npm-dist-tags.ts` | 从 npm 注册表获取最新版本（dist-tags）|
| `opencode-binary.ts` | 检测 OpenCode 二进制位置，验证已安装 |
| `opencode-config-format.ts` | OpenCode 配置格式常量和类型守卫 |
| `parse-opencode-config-file.ts` | 解析 opencode.json/opencode.jsonc，带回退 |
| `plugin-name-with-version.ts` | 解析 `oh-my-opencode@X.Y.Z` 用于安装 |
| `write-omo-config.ts` | 将生成的配置写入 `.opencode/oh-my-opencode.jsonc` |

## 使用模式

函数由 `src/cli/install.ts` / `src/cli/tui-installer.ts` 顺序调用：

```
1. ensure-config-directory-exists
2. detect-current-config（检查已设置的内容）
3. opencode-binary（验证 opencode 已安装）
4. npm-dist-tags（获取最新版本）
5. generate-omo-config（从用户选择构建配置）
6. write-omo-config
7. add-plugin-to-opencode-config
8. add-provider-config（为每个选择的提供商）
9. bun-install
```

## 注意事项

- 所有函数都是纯函数/无状态的（磁盘 I/O 除外）— 无共享模块状态
- `jsonc-provider-editor.ts` 使用保留注释的 JSONC 库 — 切勿在 JSONC 文件上使用 `JSON.parse`
- `opencode-binary.ts` 搜索 PATH + 常见安装位置（`.local/bin`、`~/.bun/bin` 等）
