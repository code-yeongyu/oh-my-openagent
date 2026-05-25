# src/cli/doctor/ — 健康诊断（25 个检查文件）

**生成时间:** 2026-05-15

## 概述

`bunx oh-my-opencode doctor` — 跨 4 个类别（系统、配置、工具、模型）的并行诊断检查。在运行时错误发生之前捕获损坏的安装、配置拼写错误、缺失依赖和提供商配置错误。

## 命令标志

```bash
bunx oh-my-opencode doctor              # 完整诊断（所有 4 个类别）
bunx oh-my-opencode doctor --status     # 紧凑仪表板（仅状态）
bunx oh-my-opencode doctor --verbose    # 详细信息（模型解析跟踪）
bunx oh-my-opencode doctor --json       # 机器可读输出
```

## 检查类别

| 类别 | 文件 | 验证内容 |
|----------|------|-----------|
| **系统** | `checks/system.ts` | OpenCode 二进制文件找到 + 版本 ≥1.0.150、插件已在 opencode.json 中注册、加载的插件版本与已安装版本匹配 |
| **配置** | `checks/config.ts` | JSONC 有效性、Zod schema 通过、无未知键、模型覆盖语法正确 |
| **工具** | `checks/tools.ts` | AST-Grep CLI + NAPI、comment-checker 二进制文件、LSP 服务器可达、GitHub CLI 认证、内置 MCP 可达 |
| **模型** | `checks/model-resolution.ts` | models.json 缓存存在、每 Agent 降级解析、分类覆盖有效、提供商可用性 |

## 支持的检查文件（共 25 个）

```
checks/
├── index.ts                               # 注册
├── system.ts                              # 主要系统聚合器
├── system-binary.ts                       # OpenCode 二进制发现（PATH + 桌面应用）
├── system-plugin.ts                       # opencode.json 插件条目检测
├── system-loaded-version.ts               # 缓存 vs npm 最新版本
├── config.ts                              # 主要配置聚合器
├── tools.ts                               # 主要工具聚合器
├── dependencies.ts                        # AST-Grep CLI/NAPI + comment-checker 存在性
├── tools-gh.ts                            # gh cli 安装 + 认证状态
├── tools-lsp.ts                           # LSP 服务器枚举
├── tools-mcp.ts                           # 内置 + 用户 MCP 可达性
├── model-resolution.ts                    # 主要模型聚合器
├── model-resolution-cache.ts              # models.json 存在性 + 新鲜度
├── model-resolution-config.ts             # oh-my-opencode.jsonc 解析
├── model-resolution-effective-model.ts    # 每 Agent 降级链跟踪
├── model-resolution-variant.ts            # 模型变体（max、high、medium）处理
├── model-resolution-details.ts            # 详细输出格式化器
└── model-resolution-types.ts              # 共享类型
```

## EXECUTION FLOW

```
doctor command
  → runner.ts: parallel check execution with 30s per-check timeout
  → checks/index.ts registers all 4 category checks
  → each check returns: { status: "ok" | "warn" | "error", detail: string }
  → formatter.ts: render to stdout (text/status/json)
  → exit code: 0 (all ok) | 1 (errors) | 2 (warnings only)
```

## KEY FILES

| File | Purpose |
|------|---------|
| `index.ts` | CLI command entry, flag parsing |
| `runner.ts` | Parallel `Promise.allSettled()` orchestration, 30s timeout per check |
| `formatter.ts` | Pretty printing: colored status, hierarchical output |
| `types.ts` | `DoctorCheck`, `CheckResult`, `DoctorReport` types |

## HOW TO ADD A CHECK

1. Create `src/cli/doctor/checks/{name}.ts` exporting check function matching `DoctorCheck`
2. Register in `checks/index.ts`
3. Category-level aggregator (system/config/tools/model-resolution) invokes it
4. Return `{ status, detail }` — no throws, all errors caught by runner

## EXIT CODES

- `0`: All checks passed (or only info messages)
- `1`: One or more errors — plugin will likely not work
- `2`: Warnings only — plugin works with degraded features
