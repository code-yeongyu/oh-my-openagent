# src/hooks/comment-checker/ — AI 垃圾评论拦截器

**生成时间:** 2026-05-15

## 概述

工具守卫层钩子。在 `write`/`edit` 工具之后运行，检测代码中的 AI 生成评论模式并在其落地前拦截。由 `@code-yeongyu/comment-checker` 二进制文件提供支持（受信任的依赖）。

## 拦截的内容

AI 垃圾评论异味：
- 重复代码的字面含义（`// increment counter`）
- 填充短语（`// obviously`、`// clearly`、`// simply`）
- 无目的的装饰分隔符
- 对名称一目了然的函数添加 JSDoc
- 无上下文的 `// TODO:`
- 与周围代码矛盾的注释

请参见 `@code-yeongyu/comment-checker` 获取权威的拦截列表。

## 执行流程

```
tool.execute.after（write | edit | hashline edit）
  → 从工具输出中提取变更行
  → 使用变更的文件路径孵化和注释检查器二进制文件
  → 解析发现结果（行范围 + 违规类别）
  → 如有发现 → 注入工具级别错误 → Agent 必须修复
```

## 关键文件

| 文件 | 用途 |
|------|---------|
| `hook.ts` | `createCommentCheckerHook()` — 主工厂，tool.execute.after 处理器 |
| `comment-checker-runner.ts` | 孵化二进制文件，解析 JSON 输出 |
| `changed-line-extractor.ts` | 从工具结果中提取哪些行发生了变更 |
| `findings-formatter.ts` | 将违规格式化为可操作的错误消息 |
| `binary-resolver.ts` | 定位 `comment-checker` 二进制文件（node_modules + PATH）|

## 配置

```jsonc
// oh-my-opencode.jsonc
{
  "comment_checker": {
    "enabled": true,      // 默认：true
    "severity": "error"   // error 阻断，warning 仅通知
  }
}
```

通过 `"disabled_hooks": ["comment-checker"]` 禁用。

## 合法评论的绕过方式

前缀添加 `// @allow` 或在文件顶部标注 `// comment-checker-disable-file`。请谨慎使用——否则就失去了意义。

## 相关

- 诊断检查：`src/cli/doctor/checks/tools.ts` 验证 `comment-checker` 二进制文件的可用性
- 安装后：`postinstall.mjs` 在缺失时下载二进制文件
