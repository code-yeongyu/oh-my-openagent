# Proposal: 将 mdsel 集成为 oh-my-opencode Built-in Skill

## 概述

将独立的 mdsel skill 完全集成到 oh-my-opencode 中，作为 built-in skill 提供。这需要扩展现有架构以支持 skill-embedded hooks。

## 背景

### 当前状态

- mdsel 是一个 Markdown 语义选择器 CLI 工具
- 已有独立 skill 实现在 `~/.claude/skills/mdsel/`
- 需要 PostToolUse hook 在读取 .md 文件后提醒使用 mdsel

### 问题

1. 独立 skill 需要用户手动安装
2. 现有 `BuiltinSkill` 类型不支持 hooks
3. Hook 加载逻辑不会扫描 built-in skills

## 解决方案

### 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Hook 集成方式 | 扩展 `BuiltinSkill` 类型 | 架构干净，未来其他 skills 也能用 |
| CLI 打包方式 | 预编译 bundle | 零运行时依赖，包体积可控 (~70KB) |

### 架构变更

```
src/features/builtin-skills/
├── mdsel/
│   ├── SKILL.md              # Skill 指令文档
│   ├── cli.mjs               # 预编译的 CLI bundle
│   └── hooks.ts              # PostToolUse hook 定义
├── types.ts                  # 扩展: hooks?: BuiltinSkillHooks
├── skills.ts                 # 新增: mdselSkill
└── index.ts                  # 导出 hook 注册逻辑
```

### 类型扩展

```typescript
// types.ts
interface BuiltinSkillHookConfig {
  matcher: string | RegExp
  handler: (context: PostToolUseContext) => HookResult | Promise<HookResult>
}

interface BuiltinSkillHooks {
  PostToolUse?: BuiltinSkillHookConfig[]
  PreToolUse?: BuiltinSkillHookConfig[]
}

interface BuiltinSkill {
  name: string
  description: string
  template: string
  mcpConfig?: SkillMcpConfig
  hooks?: BuiltinSkillHooks  // 新增
}
```

## 范围

### 包含

- 扩展 `BuiltinSkill` 类型支持 hooks
- 创建 `mdsel/` 目录结构
- 预编译 mdsel CLI 为单文件 bundle
- 实现 PostToolUse hook 逻辑
- 在主入口注册 built-in skill hooks
- 添加配置项 `disabled_skills: ["mdsel"]`

### 不包含

- MCP 集成（mdsel 不需要）
- 运行时 npm install（使用预编译 bundle）
- Windows 特殊处理（Node.js 跨平台）

## 风险

| 风险 | 缓解措施 |
|------|----------|
| 包体积增加 ~70KB | 可接受，相比功能价值很小 |
| CLI bundle 可能有兼容性问题 | 使用 bun build 确保 ESM 兼容 |
| Hook 注册时机可能有问题 | 在 plugin 初始化时统一注册 |

## 成功标准

1. `bun run build` 成功，包含 mdsel CLI bundle
2. 读取 .md 文件 (>200 words) 后显示 mdsel reminder
3. 可通过 `disabled_skills: ["mdsel"]` 禁用
4. 所有现有测试通过
