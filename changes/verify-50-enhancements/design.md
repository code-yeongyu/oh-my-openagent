# Design: verify-50-enhancements

## Goal

通过真实 OpenCode 会话验证 50-enhancements 计划中所有 43 项增强功能的运行时行为。

## Architecture

验证流程采用场景驱动的方法：

- 每个验证任务对应一个可触发特定功能的用户操作序列
- 验证结果通过观察 OpenCode 输出、日志和行为变化来判断
- 使用 `.sisyphus/` 目录存储验证状态和结果

## Tech Stack

- Runtime: OpenCode + oh-my-opencode 插件
- Testing: 手动验证 + 日志分析
- Tools: Bash (命令执行), Read (日志检查), Playwright (UI 验证 if needed)

## File Structure

```
changes/verify-50-enhancements/
├── proposal.md           # 本文件
├── design.md             # 技术设计
├── tasks.md              # 验证任务清单
├── findings.md           # 验证发现记录
├── progress.md           # 执行进度追踪
└── evidence/             # 验证证据目录
    ├── phase-1/          # Phase 1 验证截图/日志
    ├── phase-2/          # ...
    └── ...
```

## Key Decisions

1. **Decision**: 使用手动触发而非自动化脚本
   - **Why**: 需要观察 Agent 交互行为，自动化难以捕获
   - **Trade-off**: 执行时间较长，但验证更全面

2. **Decision**: 按 Phase 分组验证
   - **Why**: 与 tasks.md 结构对应，便于追踪进度
   - **Trade-off**: 部分跨 Phase 功能需要额外关注

3. **Decision**: 日志验证优先于 UI 验证
   - **Why**: 大部分功能通过日志输出可验证
   - **Trade-off**: UI 相关功能需要额外的 Playwright 验证

## Edge Cases

- 网络不可用时的 MCP 健康检查验证
- 大型提交时的原子化提交警告
- 长会话时的压缩触发行为

## Open Questions

- [x] 是否需要准备独立的测试项目？(使用当前项目即可)
- [x] 如何验证 background agent 功能？(通过 delegate_task 触发)
