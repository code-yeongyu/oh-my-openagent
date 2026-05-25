# src/hooks/rules-injector/ — 条件性规则注入

**生成时间:** 2026-05-15

## 概述

19 个文件（约 1604 行）。`rulesInjectorHook` — 工具守卫层钩子，当读取、写入或编辑目录中的文件时自动将 AGENTS.md（以及类似规则文件）注入上下文。基于邻近度：距离目标路径最近的规则文件胜出。

## 工作原理

```
tool.execute.after（read/write/edit/multiedit）
  → 从工具输出中提取文件路径
  → 查找该路径附近的规则文件（finder.ts）
  → 此会话已注入过吗？（cache.ts）
  → 将规则内容注入工具输出（injector.ts）
```

## 跟踪的工具

`["read", "write", "edit", "multiedit"]` — 仅当文件操作工具触发时。

## 关键文件

| 文件 | 用途 |
|------|---------|
| `hook.ts` | `createRulesInjectorHook()` — 连接缓存 + 注入器，处理工具事件 |
| `injector.ts` | `createRuleInjectionProcessor()` — 编排查找 → 缓存 → 注入 |
| `finder.ts` | `findRuleFiles()` + `calculateDistance()` — 定位目标路径附近的 AGENTS.md |
| `rule-file-finder.ts` | 遍历目录树查找 AGENTS.md / .rules 文件 |
| `rule-file-scanner.ts` | 扫描目录中的规则文件 |
| `matcher.ts` | 将文件路径与规则文件范围匹配 |
| `rule-distance.ts` | 计算文件与规则文件之间的路径距离 |
| `project-root-finder.ts` | 查找项目根目录（在 .git、package.json 处停止）|
| `output-path.ts` | 从工具输出文本中提取文件路径 |
| `cache.ts` | `createSessionCacheStore()` — 每会话注入去重 |
| `storage.ts` | 跨工具调用持久化已注入的路径 |
| `parser.ts` | 解析规则文件内容 |
| `constants.ts` | 规则文件名：`AGENTS.md`、`.rules`、`CLAUDE.md` |
| `types.ts` | `RuleFile`、`InjectionResult`、`RuleFileScope` |

## 规则文件发现

优先级（距目标文件最近 → 最远）：
1. 与目标文件同一目录
2. 向上至项目根目录的父目录
3. 项目根目录本身

同距离平局：全部注入。每会话去重防止重复注入。

## 截断

使用 `DynamicTruncator` — 基于模型上下文窗口调整注入大小（1M 上下文模型获得完整内容，较小模型获得截断摘要）。
