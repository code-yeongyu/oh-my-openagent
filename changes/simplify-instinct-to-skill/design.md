# Design: 简化 Instinct-to-Skill 学习系统

## Goal

将 oh-my-opencode 的断开的 Instinct 学习管道简化，采用目录转移方案而非代码重构。

## 核心洞察

通过分析 everything-claude-code 的原版实现，发现：
1. 原版使用 `~/.claude/homunculus/` 作为独立存储目录
2. 原版通过 Shell 脚本 hook 写入 `observations.jsonl`
3. oh-my-opencode 已有 TypeScript 版本的 hook，但存储路径未配置

**结论**：不需要修改代码逻辑，只需配置存储路径。

## Architecture

### 原版流程（everything-claude-code）

```
Session Activity
      │
      │ Shell hook (observe.sh) 100% 触发
      ▼
~/.claude/homunculus/observations.jsonl
      │
      │ Observer agent (Haiku) 后台分析
      ▼
~/.claude/homunculus/instincts/personal/*.md
      │
      │ /evolve 命令
      ▼
~/.claude/homunculus/evolved/{skills,commands,agents}/
```

### 简化后流程（oh-my-opencode）

```
Session Activity
      │
      │ TypeScript hooks (已存在，100% 触发)
      │ - observer-detector
      │ - instinct-learner  
      │ - pattern-extraction
      ▼
continuous-learning/references/observations/
      │
      │ SKILL.md 提醒 agent 检查观察
      ▼
continuous-learning/references/evolved/{skills,commands}/
```

## Tech Stack

- **Runtime**: 现有 TypeScript hooks（无需修改）
- **Storage**: Markdown 文件（符合 skill references 结构）
- **Trigger**: 现有 hook 事件（无需修改）

## Key Decisions

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储位置 | `continuous-learning/references/` | 符合现有 skill 结构 |
| 存储格式 | Markdown（非 jsonl） | 可用 mdsel 读取 |
| 代码修改 | 仅配置，不重构 | YAGNI 原则 |
| Instinct 中间层 | 移除 | 简化流程 |

## File Structure

### 变更前（断开状态）
```
src/features/builtin-skills/continuous-learning/
├── SKILL.md                    # 描述模式 A（未实现）
├── config.json                 # 配置（未使用）
└── hooks/
    └── observe.sh              # Shell 脚本（未触发）
```

### 变更后
```
src/features/builtin-skills/continuous-learning/
├── SKILL.md                    # 更新为模式 B，作为提醒文档
├── config.json                 # 更新存储路径
└── references/
    ├── observations/           # 【新增】观察存储
    │   └── index.md            # 观察索引
    └── evolved/                # 【新增】演化产物
        ├── skills/
        └── commands/
```

## Edge Cases

1. **目录不存在**：首次写入时创建
2. **文件冲突**：同名观察追加而非覆盖
3. **大文件**：使用 mdsel 按需读取

## Open Questions

1. 是否需要保留 `hooks/observe.sh`？（建议删除，使用 TypeScript hooks）
2. 是否需要配置 `config.json` 的存储路径？（建议更新）
