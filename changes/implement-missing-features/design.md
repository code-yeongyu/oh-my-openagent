# Design: implement-missing-features

## Goal

实现 oh-my-opencode 插件的 19 项缺失功能，建立完整的自动化学习和持续进化能力。

## 核心设计原则

> **复制 → 粘贴 → 适配**
> 
> 所有实现必须从 everything-claude-code 复制原始实现，然后适配到 oh-my-opencode 架构。
> 禁止根据理解重写。

## Architecture

### 本能系统设计（关键变更）

**本能不是独立的存储系统，而是通过正式 skill 创建流程生成的完整技能。**

| 原设计（everything-claude-code） | 适配后的设计（oh-my-opencode） |
|:-------------------------------|:------------------------------|
| 本能是独立的 .md 文件 | 本能通过 **skill-create-and-change** 流程生成完整技能 |
| 存储在 `~/.claude/homunculus/instincts/` | 存储在 `~/.claude/skills/instincts/` |
| 使用自定义脚本创建 | 调用 `skill("skill-create-and-change")` 创建 |
| 使用自定义逻辑读取 | 通过现有 skill 加载机制读取 |
| 使用自定义备份 | 调用 `skill("skill-backup")` 备份 |

### 本能工作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     本能生命周期                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [观察阶段 - PostToolUse 钩子]                                    │
│                                                                  │
│  工具调用 → observe.sh 脚本 → observations.jsonl                  │
│                                                                  │
│           │ 达到阈值时触发                                        │
│           ▼                                                      │
│                                                                  │
│  [分析阶段 - Observer 代理]                                       │
│                                                                  │
│  后台 Observer 代理分析观察日志                                    │
│    ├── 检测用户纠正                                              │
│    ├── 检测错误修复                                              │
│    ├── 检测重复工作流                                            │
│    └── 检测工具偏好                                              │
│                                                                  │
│           │ 检测到模式时                                          │
│           ▼                                                      │
│                                                                  │
│  [创建阶段 - 调用 skill-create-and-change]                       │
│                                                                  │
│  调用 skill("skill-create-and-change") 创建正式技能               │
│    → 生成完整目录结构                                             │
│    → 存储到 ~/.claude/skills/instincts/{instinct-name}/          │
│    → SKILL.md 包含 trigger/confidence/action/evidence            │
│                                                                  │
│           │ 使用时                                                │
│           ▼                                                      │
│                                                                  │
│  [触发阶段 - PreToolUse 钩子]                                     │
│                                                                  │
│  用户输入 → 匹配 instincts/ 下的 skill → 注入建议                  │
│                                                                  │
│           │ /evolve 命令时                                        │
│           ▼                                                      │
│                                                                  │
│  [进化阶段 - 聚类生成新技能]                                       │
│                                                                  │
│  调用 progressive-disclosure-md 提取相关本能                      │
│    → 聚类相似本能                                                 │
│    → 调用 skill-create-and-change 生成 evolved skill              │
│    → 调用 skill-backup 备份                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 本能 Skill 格式

每个本能是一个完整的 skill 目录：

```
~/.claude/skills/instincts/
├── prefer-functional-style/
│   └── SKILL.md
├── always-test-first/
│   └── SKILL.md
└── use-zod-validation/
    └── SKILL.md
```

**SKILL.md 格式（复制自 everything-claude-code）：**

```yaml
---
name: prefer-functional-style
description: "When writing new functions, prefer functional patterns"
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
instinct: true  # 标记为本能类型的 skill
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-28
```

### 存储架构

```
~/.claude/
├── homunculus/
│   └── observations.jsonl       # 工具调用观察日志（复制自 everything-claude-code）
│
├── skills/
│   └── instincts/               # 本能存储（作为正式 skill）
│       ├── prefer-functional-style/
│       │   └── SKILL.md
│       ├── always-test-first/
│       │   └── SKILL.md
│       └── ...
│
└── skill-snapshots/             # skill-backup 的存储位置
```

### Observer 代理设计

采用**混合模式**（复制自 everything-claude-code）：

| 层级 | 触发时机 | 实现方式 | 用途 |
|:-----|:---------|:---------|:-----|
| **L1: 轻量检测** | 每次 PostToolUse | 钩子内同步检测 | 检测异常模式（循环、重复失败） |
| **L2: 定期分析** | 每 20 次工具调用 | `delegate_task(subagent_type="observer", run_in_background=true)` | 深度模式分析 |
| **L3: 会话总结** | `session.deleted` 或 `onSummarize` | 同步处理 | 完整模式提取和本能生成 |

**Observer 代理配置：**
- 默认模型：`Antigravity-Gemini/gemini-3-flash`
- 可在 `~/.config/opencode/oh-my-opencode.json` 中覆盖
- 需要添加到 `OverridableAgentNameSchema`

### 数据流

1. **观察流程**:
   - `PostToolUse` → observe.sh → observations.jsonl

2. **分析流程**:
   - Observer 代理读取 observations.jsonl → 检测模式 → 调用 skill-create-and-change 创建本能 skill

3. **触发流程**:
   - 用户输入 → `PreToolUse` → 扫描 `~/.claude/skills/instincts/` → 匹配 trigger → 注入 Action

4. **进化流程**:
   - `/evolve` → 读取所有本能 skill → 聚类 → 调用 skill-create-and-change 生成新 skill

## 复制粘贴清单

### 从 everything-claude-code 复制的文件

| 源文件 | 目标位置 | 适配说明 |
|:-------|:---------|:---------|
| `skills/continuous-learning-v2/SKILL.md` | `src/features/builtin-skills/continuous-learning/SKILL.md` | 更新路径引用 |
| `skills/continuous-learning-v2/config.json` | `src/features/builtin-skills/continuous-learning/config.json` | 更新路径 |
| `skills/continuous-learning-v2/hooks/observe.sh` | `src/features/builtin-skills/continuous-learning/hooks/observe.sh` | 适配到 oh-my-opencode 钩子系统 |
| `skills/continuous-learning-v2/agents/observer.md` | `src/agents/observer.ts` | 转换为 TypeScript 代理定义 |
| `skills/continuous-learning-v2/commands/evolve.md` | `src/features/builtin-commands/templates/evolve.ts` | 转换为命令模板 |

### 需要调用的现有流程

| 操作 | 调用的 skill/流程 |
|:-----|:------------------|
| 创建本能 | `skill("skill-create-and-change")` |
| 备份本能 | `skill("skill-backup")` |
| 读取大文件 | `skill("progressive-disclosure-md")` + `mdsel` |
| 编写本能 | `skill("writing-skills")` TDD 流程 |

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **Libraries**: 
  - `zod` - 类型验证
  - `jsonc-parser` - JSONC 解析
  - `@opencode-ai/sdk` - 插件 SDK
- **Testing**: `bun:test` with BDD comments
- **Storage**: Skill 目录结构（通过 skill-create-and-change 创建）

## File Structure

```
src/
├── features/
│   ├── builtin-skills/
│   │   └── continuous-learning/         # 复制自 everything-claude-code
│   │       ├── SKILL.md                 # 主 skill 文件
│   │       ├── config.json              # 配置
│   │       └── hooks/
│   │           └── observe.sh           # 观察钩子脚本
│   │
│   └── builtin-commands/templates/
│       ├── evolve.ts                    # /evolve 命令
│       ├── learn.ts                     # /learn 命令
│       ├── instinct-status.ts           # /instinct-status 命令
│       ├── instinct-import.ts           # /instinct-import 命令
│       ├── instinct-export.ts           # /instinct-export 命令
│       └── build-fix.ts                 # /build-fix 命令
│
├── agents/
│   └── observer.ts                      # Observer 代理（从 observer.md 转换）
│
├── hooks/
│   ├── instinct-trigger/                # 本能触发钩子（PreToolUse）
│   │   └── index.ts
│   │
│   ├── instinct-learner/                # 本能学习钩子（PostToolUse）
│   │   └── index.ts
│   │
│   └── pattern-extraction/              # 模式提取钩子（onSummarize）
│       └── index.ts
│
└── mcp/
    ├── memory/                          # Memory MCP 集成
    └── sequential-thinking/             # Sequential Thinking MCP 集成
```

## Key Decisions

### 1. 本能存储在 `~/.claude/skills/instincts/`
- **Why**: 与 everything-claude-code 保持一致，复用现有 skill 加载机制
- **Trade-off**: 需要确保 skill 加载器扫描此目录

### 2. 通过 skill-create-and-change 创建本能
- **Why**: 复用现有基础设施，保持一致性
- **Trade-off**: 创建过程可能较慢，但更可靠

### 3. Observer 使用 gemini-3-flash
- **Why**: 轻量级、快速、成本低
- **Trade-off**: 分析能力有限，复杂模式可能漏检

### 4. 本能 SKILL.md 包含 `instinct: true` 标记
- **Why**: 区分本能 skill 和普通 skill
- **Trade-off**: 需要在 skill 加载器中处理此标记

## Edge Cases

### 本能系统
- **空本能库**: 首次使用时显示引导信息
- **本能冲突**: 多个本能同时匹配时，按 confidence 排序
- **循环触发**: 本能执行结果再次触发本能，设置深度限制（3层）

### Skill 创建流程
- **创建失败**: 记录错误，不影响主流程
- **备份失败**: 网络问题时跳过备份，记录警告

### Observer 代理
- **资源限制**: 每 20 次工具调用才分析一次
- **后台任务堆积**: 超过阈值时跳过分析
- **异常检测误报**: 需连续 3 次异常才报警

## Integration Points

### 与现有系统集成

| 模块 | 集成点 | 说明 |
|------|--------|------|
| `src/index.ts` | 注册新钩子 | instinct-trigger, instinct-learner, pattern-extraction |
| `src/agents/utils.ts` | 添加 observer agent | agentSources 数组 |
| `src/config/schema.ts` | 添加 observer 到 OverridableAgentNameSchema | 允许用户覆盖模型 |
| `src/features/builtin-commands/commands.ts` | 注册新命令 | 6 个新命令 |
| `src/features/builtin-skills/skills.ts` | 注册 continuous-learning skill | 1 个新 skill |

### 与现有 skill 流程集成

| 操作 | 调用 |
|------|------|
| 创建本能 | `skill("skill-create-and-change")` |
| 修改本能 | `skill("skill-create-and-change")` + 自动调用 `skill("skill-backup")` |
| 进化本能 | `skill("progressive-disclosure-md")` + `skill("skill-create-and-change")` |
