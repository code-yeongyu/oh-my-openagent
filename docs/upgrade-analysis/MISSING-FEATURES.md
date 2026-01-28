# Oh-My-OpenCode 缺失功能清单

> 生成时间: 2026-01-28
> 对比基准: everything-claude-code
> 总计缺失: 19 项功能
> 
> **更新记录**:
> - 2026-01-28: 移除 2.3 上下文模式系统（已通过现有 category + subagent 系统实现）
> - 2026-01-28: 移除 4.3 `/skill-create` 和 4.8 `/refactor-clean`（已通过现有 skill 系统实现，见增强清单）
> - 2026-01-28: 移除 4 个可选 MCP（Firecrawl, Supabase, Cloudflare, Magic UI）

---

## 一、缺失功能总览

| 分类 | 缺失数量 | 优先级 |
|:-----|:--------:|:------:|
| 核心系统 | 3 | 🔴 高 |
| 代理 | 1 | 🔴 高 |
| 命令 | 6 | 🟡 中 |
| 钩子 | 2 | 🔴 高 |
| 技能 | 5 | 🟢 低 |
| MCP 服务 | 2 | 🟡 中 |
| **合计** | **19** | - |

> **注**: 原文档中的"上下文模式系统"已通过现有架构实现：
> - 开发模式 → `ultrabrain` category + TDD skills
> - 审查模式 → `oracle` agent
> - 研究模式 → `explore` + `librarian` agents
> 
> **注**: 以下命令已通过现有 skill 系统实现：
> - `/skill-create` → 调用 `skill("writing-skills")` 即可
> - `/refactor-clean` → 现有 `/refactor` 命令可扩展，见增强清单
> 
> 相关增强建议已移至 [ENHANCEMENT-LIST.md](./ENHANCEMENT-LIST.md)。

---

## 二、核心系统 (4项)

### 2.1 持续学习 v2 系统 (Continuous Learning v2)

**状态**: ⚠️ 部分实现 → 需完善

**当前实现**:
- `src/hooks/skill-suggestion` - 自动建议技能
- `src/hooks/failure-counter` - 失败后阶梯式引导

**缺失部分**:
- 动态模式提取 (Pattern Extraction)
- 经验累积与自动化进化
- 会话历史分析与知识沉淀

**实现方案**:
```
新增文件:
├── src/features/continuous-learning/
│   ├── index.ts                    # 模块入口
│   ├── pattern-extractor.ts        # 模式提取器
│   ├── knowledge-store.ts          # 知识存储
│   ├── session-analyzer.ts         # 会话分析
│   └── evolution-engine.ts         # 进化引擎
```

**核心逻辑**:
1. 在会话结束时 (`session-end`) 分析操作历史
2. 识别重复成功的操作模式
3. 将模式转化为可复用的"技能"或"本能"
4. 存储到 `.opencode/learned/` 目录

**OpenCode SDK 支持**: ✅ 可行
- 使用 `event` hook 监听 `session.deleted`
- 使用 `onSummarize` 在压缩时提取关键模式

---

### 2.2 本能模型 (Instinct Model)

**状态**: ❌ 缺失

**功能描述**:
Agent 处理任务的"直觉"层，存储经过验证的高频率操作模式和决策路径。

**数据结构**:
```typescript
interface Instinct {
  id: string;
  name: string;
  trigger: {
    pattern: string;      // 触发模式 (正则或关键词)
    context?: string[];   // 上下文条件
  };
  actions: {
    type: 'prompt' | 'tool' | 'skill';
    content: string;
  }[];
  expectations: {
    success: string[];    // 预期成功标志
    failure: string[];    // 失败标志
  };
  metadata: {
    confidence: number;   // 信心评分 0-1
    usageCount: number;   // 使用次数
    successRate: number;  // 成功率
    createdAt: string;
    updatedAt: string;
  };
}
```

**实现方案**:
```
新增文件:
├── src/features/instinct/
│   ├── index.ts                    # 模块入口
│   ├── types.ts                    # 类型定义
│   ├── instinct-store.ts           # 本能存储 (JSONC)
│   ├── instinct-matcher.ts         # 触发匹配器
│   ├── instinct-executor.ts        # 执行器
│   └── instinct-trainer.ts         # 训练器 (从模式生成本能)
```

**存储位置**: `~/.config/opencode/instincts/` 或 `.opencode/instincts/`

**OpenCode SDK 支持**: ✅ 可行
- 使用 `PreToolUse` hook 检测触发条件
- 使用自定义工具注入本能建议

---

### 2.3 规则系统增强 (Rules System Enhancement)

**状态**: ⚠️ 部分实现 → 需系统化

**当前实现**:
- `src/hooks/rules-injector` - 基础规则注入
- `src/hooks/tdd-guard` - TDD 强制

**缺失部分**:
- 完整的规则分类体系
- 规则优先级与覆盖机制
- 自动化规则验证

**规则分类**:
1. **钩子规则** - Pre/PostToolUse 拦截逻辑
2. **模式规则** - 设计模式、架构骨架
3. **性能规则** - 模型选择、上下文管理
4. **Git 工作流规则** - 约定式提交、PR 审阅
5. **安全规则** - 8项强制性安全自查
6. **测试规则** - TDD、80%覆盖率
7. **编码风格规则** - 不可变性、文件组织
8. **代理使用规则** - 专家代理编排

---

## 三、代理系统 (1项)

### 3.1 Observer 观察者代理

**状态**: ❌ 缺失

**功能描述**:
独立运行的后台进程，"冷眼旁观"主 Agent 的行为。

**职责**:
1. **行为审计**: 监控主 Agent 是否偏离最佳实践
2. **模式提取**: 识别主 Agent 操作中的潜在规律
3. **异常捕获**: 在主 Agent 陷入死循环或发生错误时提供预警

**实现方案**:
```
新增文件:
├── src/agents/observer/
│   ├── index.ts                    # 代理定义
│   ├── observer-prompt.ts          # 系统提示词
│   ├── behavior-analyzer.ts        # 行为分析器
│   ├── pattern-detector.ts         # 模式检测器
│   └── anomaly-detector.ts         # 异常检测器
```

**代理配置**:
```typescript
const observerAgent: AgentSource = {
  name: 'observer',
  description: 'Background monitoring agent for pattern extraction and anomaly detection',
  model: 'opencode/grok-code',  // 轻量级模型
  temperature: 0.1,
  tools: ['read', 'grep', 'glob'],  // 只读工具
  systemPrompt: observerPrompt,
};
```

**触发机制**:
- 每 N 次工具调用后自动分析
- 检测到异常模式时主动介入
- 会话结束时汇总发现

**OpenCode SDK 支持**: ✅ 可行
- 使用 `background-agent` 机制运行
- 使用 `PostToolUse` hook 收集行为数据

---

## 四、命令系统 (6项)

### 4.1 `/evolve` - 系统进化命令

**功能**: 将散落的"本能"聚类为更高层级的命令、技能或代理

**实现方案**:
```
新增文件:
├── src/features/builtin-commands/templates/evolve.ts
```

**命令逻辑**:
1. 扫描现有本能 (`~/.config/opencode/instincts/`)
2. 分析相似度和使用频率
3. 聚类相关本能
4. 生成新的命令/技能定义
5. 提示用户确认

---

### 4.2 `/learn` - 学习命令

**功能**: 从当前会话提取模式并生成技能文件

**实现方案**:
```
新增文件:
├── src/features/builtin-commands/templates/learn.ts
```

**命令逻辑**:
1. 分析当前会话历史
2. 识别成功的操作模式
3. 生成技能 YAML 定义
4. 保存到用户技能目录

---

### 4.3 `/instinct-status` - 本能状态查看

**功能**: 显示当前已注册的本能及其统计信息

**输出示例**:
```
📊 本能状态报告

总计: 15 个本能

ID          名称                  使用次数  成功率  信心
────────────────────────────────────────────────────────
inst_001    TDD 优先检查          142       98%     0.95
inst_002    TypeScript 错误修复   89        87%     0.82
inst_003    Git 原子提交          234       99%     0.97
...
```

---

### 4.4 `/instinct-import` - 本能导入

**功能**: 从文件或 URL 导入本能定义

**用法**:
```
/instinct-import ./my-instincts.json
/instinct-import https://example.com/shared-instincts.json
```

---

### 4.5 `/instinct-export` - 本能导出

**功能**: 导出本能定义供分享或备份

**用法**:
```
/instinct-export ./backup/instincts.json
/instinct-export --all
/instinct-export --filter "TDD*"
```

---

### 4.6 `/build-fix` - 增量构建修复

**功能**: 增量修复 TypeScript 错误，直到构建通过或达到停止条件

**实现方案**:
```
新增文件:
├── src/features/builtin-commands/templates/build-fix.ts
```

**命令逻辑**:
1. 运行 `bun run build` 或 `tsc`
2. 解析错误输出
3. 按文件分组错误
4. 逐个修复
5. 重复直到通过或达到最大迭代次数

---

## 五、钩子系统 (2项)

### 5.1 OnTaskComplete 钩子

**功能**: 任务完成后的学习提取

**触发时机**: 当检测到任务完成标志时

**实现方案**:
```
新增文件:
├── src/hooks/on-task-complete/
│   ├── index.ts
│   └── learning-extractor.ts
```

**钩子逻辑**:
1. 检测任务完成信号 (TODO 全部完成、用户确认等)
2. 分析任务执行历史
3. 提取成功模式
4. 询问用户是否保存为本能/技能

---

### 5.2 PatternExtraction 钩子

**功能**: 会话分析、模式识别

**触发时机**: `onSummarize` (上下文压缩时)

**实现方案**:
```
新增文件:
├── src/hooks/pattern-extraction/
│   ├── index.ts
│   └── pattern-analyzer.ts
```

**钩子逻辑**:
1. 在压缩前分析即将被删除的历史
2. 识别重复出现的操作模式
3. 计算模式的信心评分
4. 达到阈值时自动创建本能

---

## 六、技能系统 (5项)

### 6.1 security-audit 技能

**功能**: 代码安全审查

**技能定义**:
```yaml
name: security-audit
description: 执行全面的代码安全审查
triggers:
  - "安全审查"
  - "security audit"
  - "/security"
checklist:
  - 硬编码凭据检测
  - SQL 注入风险
  - XSS 漏洞
  - CSRF 防护
  - 敏感数据暴露
  - 依赖漏洞扫描
tools:
  - npm audit
  - trufflehog
  - semgrep
```

---

### 6.2 database-optimization 技能

**功能**: 数据库性能调优

**技能定义**:
```yaml
name: database-optimization
description: 分析并优化数据库性能
triggers:
  - "数据库优化"
  - "DB 性能"
focus:
  - 索引分析
  - 查询优化
  - N+1 问题检测
  - 连接池配置
```

---

### 6.3 backend-pattern-go 技能

**功能**: Go 后端开发模式

**技能定义**:
```yaml
name: backend-pattern-go
description: Go 语言后端开发最佳实践
triggers:
  - "Go 后端"
  - "Golang API"
patterns:
  - 标准项目布局 (pkg/cmd/internal)
  - 错误处理模式
  - 接口设计原则
  - 并发模式 (goroutine/channel)
```

---

### 6.4 backend-pattern-java 技能

**功能**: Java 后端开发模式

**技能定义**:
```yaml
name: backend-pattern-java
description: Java/Spring 后端开发最佳实践
triggers:
  - "Java 后端"
  - "Spring Boot"
patterns:
  - 分层架构 (Controller/Service/Repository)
  - 依赖注入
  - 事务管理
  - AOP 切面
```

---

### 6.5 backend-pattern-python 技能

**功能**: Python 后端开发模式

**技能定义**:
```yaml
name: backend-pattern-python
description: Python 后端开发最佳实践
triggers:
  - "Python 后端"
  - "FastAPI"
  - "Django"
patterns:
  - 项目结构 (src layout)
  - 类型注解
  - 异步编程
  - ORM 使用
```

---

## 七、MCP 服务 (2项)

### 7.1 Memory MCP (🔴 必需)

**功能**: 跨会话持久化记忆

**配置**:
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/memory-mcp"],
      "env": {
        "MEMORY_STORE_PATH": "~/.config/opencode/memory"
      }
    }
  }
}
```

**用途**:
- 延续复杂任务进度
- 多日程切换后快速恢复状态
- 长期项目知识积累

---

### 7.2 Sequential Thinking MCP (🟡 推荐)

**功能**: 链式思维推理

**配置**:
```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@anthropic/sequential-thinking-mcp"]
    }
  }
}
```

**用途**:
- 复杂架构设计
- 安全漏洞评估
- 多步骤决策

---

## 八、实施路线图

### Phase 1: 核心能力 (Week 1-2)

| 优先级 | 任务 | 工作量 |
|:------:|:-----|:------:|
| P0 | 持续学习 v2 系统 | 3天 |
| P0 | 本能模型 | 2天 |
| P0 | Observer 观察者代理 | 2天 |
| P0 | OnTaskComplete 钩子 | 1天 |
| P0 | PatternExtraction 钩子 | 1天 |
| P0 | Memory MCP 集成 | 0.5天 |

### Phase 2: 命令系统 (Week 3-4)

| 优先级 | 任务 | 工作量 |
|:------:|:-----|:------:|
| P1 | `/evolve` 命令 | 1天 |
| P1 | `/learn` 命令 | 1天 |
| P1 | `/instinct-*` 系列命令 | 1天 |
| P1 | `/build-fix` 命令 | 0.5天 |

### Phase 3: 扩展能力 (Week 5+)

| 优先级 | 任务 | 工作量 |
|:------:|:-----|:------:|
| P2 | security-audit 技能 | 1天 |
| P2 | database-optimization 技能 | 0.5天 |
| P2 | backend-pattern-* 技能 | 1天 |
| P2 | Sequential Thinking MCP | 0.5天 |
| P2 | Firecrawl MCP | 0.5天 |
| P3 | Supabase/Cloudflare/Magic UI MCP | 按需 |

---

## 九、文件创建清单

### 需要新增的目录和文件

```
src/
├── features/
│   ├── continuous-learning/           # 持续学习 v2
│   │   ├── index.ts
│   │   ├── pattern-extractor.ts
│   │   ├── knowledge-store.ts
│   │   ├── session-analyzer.ts
│   │   └── evolution-engine.ts
│   ├── instinct/                       # 本能模型
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── instinct-store.ts
│   │   ├── instinct-matcher.ts
│   │   ├── instinct-executor.ts
│   │   └── instinct-trainer.ts
│   └── builtin-commands/templates/
│       ├── evolve.ts                   # /evolve
│       ├── learn.ts                    # /learn
│       ├── instinct-status.ts          # /instinct-status
│       ├── instinct-import.ts          # /instinct-import
│       ├── instinct-export.ts          # /instinct-export
│       └── build-fix.ts                # /build-fix
├── agents/
│   └── observer/                       # Observer 代理
│       ├── index.ts
│       ├── observer-prompt.ts
│       ├── behavior-analyzer.ts
│       ├── pattern-detector.ts
│       └── anomaly-detector.ts
├── hooks/
│   ├── on-task-complete/               # OnTaskComplete 钩子
│   │   ├── index.ts
│   │   └── learning-extractor.ts
│   └── pattern-extraction/             # PatternExtraction 钩子
│       ├── index.ts
│       └── pattern-analyzer.ts
└── features/builtin-skills/
    ├── security-audit/                 # 安全审查技能
    │   └── SKILL.md
    ├── database-optimization/          # 数据库优化技能
    │   └── SKILL.md
    ├── backend-pattern-go/             # Go 后端技能
    │   └── SKILL.md
    ├── backend-pattern-java/           # Java 后端技能
    │   └── SKILL.md
    └── backend-pattern-python/         # Python 后端技能
        └── SKILL.md
```

### 预计新增文件数量

| 目录 | 文件数 |
|:-----|:------:|
| features/continuous-learning/ | 5 |
| features/instinct/ | 6 |
| features/builtin-commands/templates/ | 6 |
| agents/observer/ | 5 |
| hooks/on-task-complete/ | 2 |
| hooks/pattern-extraction/ | 2 |
| features/builtin-skills/ | 5 |
| **合计** | **31** |

---

## 十、验收标准

### 功能验收

- [ ] 持续学习 v2 能够自动提取会话模式
- [ ] 本能模型能够存储和触发高频操作
- [ ] Observer 代理能够在后台监控并报告异常
- [ ] 所有 6 个新命令可正常执行
- [ ] Memory MCP 能够跨会话保持记忆

### 技术验收

- [ ] 所有新增文件通过 TypeScript 类型检查
- [ ] 所有新增功能有对应的单元测试
- [ ] `bun run build` 成功
- [ ] `bun test` 全部通过
- [ ] 无新增的 `as any` 或 `@ts-ignore`

---

*本文档由 Sisyphus 自动生成，基于 everything-claude-code 与 oh-my-opencode 的深度对比分析*
