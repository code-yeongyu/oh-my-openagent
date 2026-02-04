# 设计: wave-system-enhancements

## 目标

通过 Hook 拦截、Skill 格式规范和自动激活逻辑，使 Wave 并行执行系统能够自动、可靠地工作。

## 架构

系统由三个组件构成依赖链：

1. **creating-changes skill**（格式规范）→ 定义标准 tasks.md 格式
2. **tasks-md-creation-guard hook**（强制执行）→ 拦截不规范的创建行为
3. **start-work hook 增强**（自动激活）→ 根据任务数自动选择执行模式

```
用户请求创建 tasks.md
        ↓
[tasks-md-creation-guard hook]
        ↓
    文件已存在? ─是→ 允许更新
        ↓ 否
    skill 已使用? ─是→ 允许创建
        ↓ 否
    阻止并提示使用 creating-changes skill
```

## 技术栈

- 运行时: Bun + TypeScript
- 库: OpenCode 插件 SDK (`@opencode-ai/opencode`)
- 测试: 手动 QA（typecheck + build）

## 文件结构

```
src/
├── features/builtin-skills/creating-changes/
│   └── SKILL.md                    # 修改: 添加标准任务格式规范
├── hooks/
│   ├── tasks-md-creation-guard/
│   │   ├── index.ts                # 创建: Guard hook 主逻辑
│   │   └── constants.ts            # 创建: 常量定义
│   ├── start-work/
│   │   └── index.ts                # 修改: 添加自动激活逻辑
│   └── index.ts                    # 修改: 导出新 hook
├── config/
│   └── schema.ts                   # 修改: 添加 hook 到 HookNameSchema
└── index.ts                        # 修改: 注册新 hook
```

## 关键决策

1. **决策**: 使用 HTML 注释作为元数据格式
   - **原因**: 不影响 Markdown 渲染，易于解析，向后兼容
   - **权衡**: 需要正则匹配提取

2. **决策**: 仅拦截首次创建，不拦截更新
   - **原因**: 允许正常的计划迭代和修改
   - **权衡**: 无法强制已存在文件的格式

3. **决策**: 任务阈值设为 5
   - **原因**: 5 个以下任务顺序执行更简单，5 个以上并行有明显收益
   - **权衡**: 固定阈值可能不适合所有场景

4. **决策**: 支持 "use sequential" 关键词覆盖
   - **原因**: 保留用户控制权
   - **权衡**: 需要关键词检测逻辑

## 边界情况

- **已存在 tasks.md 的更新**: 直接允许，不拦截
- **子代理会话**: 共享主会话的 skill 使用状态
- **TodoWrite vs Write**: 仅拦截 Write/Edit/MultiEdit，不拦截 TodoWrite
- **非 changes 目录**: 不拦截，仅针对 `changes/*/tasks.md` 模式
- **任务数刚好为 5**: 使用顺序模式（阈值是 > 5）

## 开放问题

- [x] Hook 生命周期：使用 PreToolUse (`tool.execute.before`)
- [x] 错误渠道：返回 tool error result
- [x] 性能预算：< 2ms per hook execution
