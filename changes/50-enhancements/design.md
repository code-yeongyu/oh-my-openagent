# Design: 50项功能增强

## Goal

增强 oh-my-opencode 的 9 个核心系统，使其达到 everything-claude-code 的最佳实践水平。

## Architecture

本次增强不引入新架构，只优化现有组件：

- **规则系统** → 增加角色感知、TDD真实验证、安全扫描
- **技能系统** → 自动注入、文档标准化
- **上下文系统** → 意图模式、主动压缩
- **代理系统** → 决策框架、结构化交接
- **并行系统** → 依赖感知、缓存友好
- **MCP系统** → 本地支持、工具数量约束
- **钩子系统** → 标准化匹配器
- **测试系统** → 模板生成
- **命令系统** → 风险矩阵

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Testing: bun test
- Build: bun build + tsc

## File Structure

```
src/
├── hooks/
│   ├── tdd-guard/index.ts              # Modify: 真实测试执行、模板生成
│   ├── rules-injector/index.ts         # Modify: 角色感知、安全审计
│   ├── secret-scanner/                 # Create: 敏感信息扫描钩子
│   │   ├── index.ts
│   │   ├── patterns.ts
│   │   └── index.test.ts
│   └── index.ts                        # Modify: HookMatcher 抽象
├── features/
│   ├── context-injector/collector.ts   # Modify: 意图模式、缓存排序
│   ├── builtin-skills/
│   │   ├── skills.ts                   # Modify: 自动注入逻辑
│   │   └── types.ts                    # Modify: 扩展接口
│   └── background-agent/manager.ts     # Modify: 依赖图、交接协议
├── agents/
│   ├── oracle.ts                       # Modify: 决策框架
│   └── prometheus-prompt.ts            # Modify: 风险矩阵
├── mcp/
│   └── index.ts                        # Modify: 本地支持、工具约束
└── config/
    └── schema.ts                       # Modify: 新配置项
```

## Key Decisions

1. **Decision**: 采用复制粘贴+适配策略
   - **Why**: everything-claude-code 的实现已验证
   - **Trade-off**: 需要理解两个代码库

2. **Decision**: 每项增强独立提交
   - **Why**: 便于回滚和审查
   - **Trade-off**: 提交数量多

3. **Decision**: TDD 真实执行添加超时
   - **Why**: 防止测试执行拖慢开发流程
   - **Trade-off**: 超时可能误判

## Edge Cases

- TDD 执行超时：设置 30 秒超时，超时视为通过（保守策略）
- 敏感信息误报：提供白名单配置
- 技能自动注入冲突：用户手动调用优先
- 依赖分析不确定：保守串行执行

## Open Questions

- [x] 选择哪些增强项？→ 用户选择全部 50 项
- [ ] TDD 真实执行的超时时间？建议 30 秒
- [ ] 敏感信息扫描的正则模式？参考 everything-claude-code
