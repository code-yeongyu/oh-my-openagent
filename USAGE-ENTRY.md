# Superpowers-Fusion 使用入口快速参考

## 🎯 三种主要触发方式

### 1. 自然对话（最简单）

直接说出你的意图，agent 会自动触发相应技能：

```
"我想添加 [功能描述]"
→ 自动触发: brainstorming

"设计方案吧"
→ 自动触发: creating-changes

"执行计划"
→ 自动触发: executing-plans 或 subagent-driven-development

"做收尾"
→ 自动触发: finishing-a-development-branch

"归档这个变更"
→ 自动触发: archiving-changes
```

---

### 2. 关键词触发（自动化）

系统自动检测关键词并建议技能：

| 用户说 | 自动建议的技能 |
|--------|--------------|
| "build", "create", "add", "implement" | 🎨 brainstorming |
| "design", "plan", "architecture" | 📝 creating-changes |
| "test", "bug", "fix", "debug" | 🧪 test-driven-development / systematic-debugging |
| "review", "verify", "check" | 🔍 requesting-code-review / verification-before-completion |
| "commit", "rebase", "git" | 🌿 git-master |
| "UI", "frontend", "visual" | 🎭 frontend-ui-ux |
| "browser", "web", "scrape" | 🎭 playwright |

---

### 3. 显式调用 Skill（精确控制）

使用斜杠命令直接触发特定技能：

| 命令 | 用途 |
|--------|------|
| `/brainstorming` | 构思需求和设计方案 |
| `/creating-changes` | 编写技术设计和任务分解 |
| `/executing-plans` | 执行实施计划（独立 session） |
| `/subagent-driven-development` | 执行计划（当前 session） |
| `/finishing-a-development-branch` | 完成分支（merge/PR/keep/discard） |
| `/archiving-changes` | 归档已完成的变更 |
| `/wave-parallel-execution` | Wave 并行执行模式 |
| `/test-driven-development` | TDD 测试驱动开发 |
| `/systematic-debugging` | 系统化调试 |
| `/requesting-code-review` | 请求代码审查 |
| `/verification-before-completion` | 完成前验证 |
| `/git-master` | Git 专家操作 |
| `/playwright` | 浏览器自动化 |
| `/frontend-ui-ux` | 前端 UI/UX 开发 |

---

## 🚀 典型工作流示例

### 完整功能开发（推荐）

```
1. "我想添加 [功能]"
   ↓ brainstorming skill 自动触发

2. 回答 agent 的问题（每次一个）
   ↓ 探索需求、提出方案

3. "方案看起来不错，开始设计"
   ↓ creating-changes skill 自动触发

4. "用 Prometheus 审阅一下"
   ↓ Metis → Prometheus → Momus 流程

5. "执行计划"
   ↓ executing-plans skill 自动触发
   ↓ 根据 task 数自动选择模式：
      - ≤ 5 tasks → Sequential
      - > 5 tasks → Wave-Parallel

6. "做收尾"
   ↓ finishing-a-development-branch 自动触发

7. "创建 PR" 或 "合并到 main"

8. "归档变更"
   ↓ archiving-changes 自动触发
```

### 快速任务（跳过规划）

```
"修复这个 bug，使用 TDD"
→ 自动触发: systematic-debugging + test-driven-development

"优化这个函数"
→ 直接实现，无需规划阶段

"审查这段代码"
→ 自动触发: requesting-code-review
```

---

## 🎭 Planning Flow 入口

### 完整流程

```
"我想规划 [功能]"
→ Metis (Plan Consultant)
  ↓ 检查遗漏问题、AI 失败点
→ Prometheus (Planner)
  ↓ 生成工作计划
→ Momus (Plan Reviewer) [可选]
  ↓ 高精度审阅
→ 完成
```

### 单独调用

```
/use planning:metis      # 仅调用 Metis
/use planning:prometheus  # 仅调用 Prometheus
/use planning:momus       # 仅调用 Momus
```

---

## 🔧 高级模式

### Ultrawork 模式（最大性能）

在提示词中包含 `ultrawork` 或 `ulw`：

```
"ultrawork：添加用户认证系统"
→ 自动启用：
   ✅ 并行 agent 调用
   ✅ 背景任务
   ✅ 深度探索
   ✅ 持续执行直到完成
```

### Wave Parallel Execution

**自动触发**:
- tasks.md 任务数 > 5 时

**手动触发**:
```
/wave-parallel-execution
```

### 子任务并行执行

使用 `sisyphus_task` 工具：

```typescript
// 使用 category（推荐）
sisyphus_task({
  category: "visual",
  prompt: "创建仪表盘 UI",
  run_in_background: true
})

// 直接指定 agent
sisyphus_task({
  agent: "oracle",
  prompt: "审查架构设计",
  run_in_background: true
})

// 恢复之前的 session
sisyphus_task({
  resume: "session_id_here",
  prompt: "继续之前的任务"
})
```

---

## 💡 快速开始清单

- [ ] 只要说"我想 [做什么]"
- [ ] 等待 agent 自动触发相应 skill
- [ ] 回答问题（每次一个）
- [ ] 确认后继续下一步
- [ ] 复杂任务时加上 `ultrawork`

**就这么简单！** 🎉
