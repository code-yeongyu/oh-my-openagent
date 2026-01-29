# 50项功能增强 - 设计文档

## 一句话说明

**从 everything-claude-code 复制最佳实践，增强 oh-my-opencode 现有的9个系统。**

---

## 为什么要做这个？

| 问题 | 解决方案 |
|------|----------|
| TDD守卫只是"假装"检查测试 | 真正运行测试命令验证 |
| 敏感信息可能被写入代码 | 写入前自动扫描拦截 |
| 技能需要手动调用 | 自动检测任务类型并注入 |
| Agent 交接信息丢失 | 强制结构化交接格式 |
| 并行任务可能冲突 | 分析依赖后再并行 |

---

## 做什么？不做什么？

### ✅ 做
- 增强现有功能的可靠性
- 从 everything-claude-code 复制已验证的模式
- 每个改动都有测试

### ❌ 不做
- 不新增架构（本能模型、Observer等是另一个计划）
- 不破坏现有API
- 不引入新依赖

---

## 涉及哪些文件？

```
主要修改 (按修改量排序):
├── src/hooks/tdd-guard/index.ts          ← 5项增强
├── src/hooks/rules-injector/index.ts     ← 4项增强  
├── src/features/context-injector/        ← 3项增强
├── src/mcp/index.ts                      ← 3项增强
├── src/agents/oracle.ts                  ← 2项增强
├── src/agents/prometheus-prompt.ts       ← 2项增强
└── src/features/background-agent/        ← 2项增强
```

---

## 分几期做？

| 期数 | 时间 | 数量 | 重点 |
|------|------|------|------|
| **Phase 1** | 1-2周 | 17项 | 安全+TDD+自动化 |
| **Phase 2** | 3-4周 | 28项 | 优化+体验 |
| **Phase 3** | 按需 | 5项 | 锦上添花 |

---

## 怎么验证成功？

```bash
bun run typecheck  # 0 错误
bun test           # 全部通过
bun run build      # 构建成功
```
