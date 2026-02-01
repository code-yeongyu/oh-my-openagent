---
name: continuous-learning-v2
description: Instinct-based learning system that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents.
version: 2.0.0
---

# Continuous Learning v2 - Instinct-Based Architecture

An advanced learning system that turns your Claude Code sessions into reusable knowledge through atomic "instincts" - small learned behaviors with confidence scoring.

## What's New in v2

| Feature | v1 | v2 |
|---------|----|----|
| Observation | Stop hook (session end) | PreToolUse/PostToolUse (100% reliable) |
| Analysis | Main context | Background agent (Haiku) |
| Granularity | Full skills | Atomic "instincts" |
| Confidence | None | 0.3-0.9 weighted |
| Evolution | Direct to skill | Instincts → cluster → skill/command/agent |
| Sharing | None | Export/import instincts |

## The Instinct Model

An instinct is a small learned behavior:

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**Properties:**
- **Atomic** — one trigger, one action
- **Confidence-weighted** — 0.3 = tentative, 0.9 = near certain
- **Domain-tagged** — code-style, testing, git, debugging, workflow, etc.
- **Evidence-backed** — tracks what observations created it

## How It Works

```
Session Activity
      │
      │ Hooks capture prompts + tool use (100% reliable)
      ▼
┌─────────────────────────────────────────┐
│         observations.jsonl              │
│   (prompts, tool calls, outcomes)       │
└─────────────────────────────────────────┘
      │
      │ Observer agent reads (background, Haiku)
      ▼
┌─────────────────────────────────────────┐
│          PATTERN DETECTION              │
│   • User corrections → instinct         │
│   • Error resolutions → instinct        │
│   • Repeated workflows → instinct       │
└─────────────────────────────────────────┘
      │
      │ Creates/updates
      ▼
┌─────────────────────────────────────────┐
│         instincts/personal/             │
│   • prefer-functional.md (0.7)          │
│   • always-test-first.md (0.9)          │
│   • use-zod-validation.md (0.6)         │
└─────────────────────────────────────────┘
      │
      │ /evolve clusters
      ▼
┌─────────────────────────────────────────┐
│              evolved/                   │
│   • commands/new-feature.md             │
│   • skills/testing-workflow.md          │
│   • agents/refactor-specialist.md       │
└─────────────────────────────────────────┘
```

## Quick Start

### 1. Enable Observation Hooks

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh pre"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh post"
      }]
    }]
  }
}
```

### 2. Initialize Directory Structure

```bash
mkdir -p ~/.claude/skills/{instincts/{personal,inherited},evolved/{agents,skills,commands}}
touch ~/.claude/skills/observations.jsonl
```

### 3. Run the Observer Agent (Optional)

The observer can run in the background analyzing observations:

```bash
# Start background observer
~/.claude/skills/continuous-learning-v2/agents/start-observer.sh
```

## Commands

| Command | Description |
|---------|-------------|
| `/instinct-status` | Show all learned instincts with confidence |
| `/evolve` | Cluster related instincts into skills/commands |
| `/instinct-export` | Export instincts for sharing |
| `/instinct-import <file>` | Import instincts from others |

## Configuration

Edit `config.json`:

```json
{
  "version": "2.0",
  "observation": {
    "enabled": true,
    "store_path": "~/.claude/skills/observations.jsonl",
    "max_file_size_mb": 10,
    "archive_after_days": 7
  },
  "instincts": {
    "personal_path": "~/.claude/skills/instincts/",
    "inherited_path": "~/.claude/skills/instincts/inherited/",
    "min_confidence": 0.3,
    "auto_approve_threshold": 0.7,
    "confidence_decay_rate": 0.05
  },
  "observer": {
    "enabled": true,
    "model": "haiku",
    "run_interval_minutes": 5,
    "patterns_to_detect": [
      "user_corrections",
      "error_resolutions",
      "repeated_workflows",
      "tool_preferences"
    ]
  },
  "evolution": {
    "cluster_threshold": 3,
    "evolved_path": "~/.claude/skills/evolved/"
  }
}
```

## File Structure

```
~/.claude/skills/
├── identity.json           # Your profile, technical level
├── observations.jsonl      # Current session observations
├── observations.archive/   # Processed observations
├── instincts/
│   ├── personal/           # Auto-learned instincts
│   └── inherited/          # Imported from others
└── evolved/
    ├── agents/             # Generated specialist agents
    ├── skills/             # Generated skills
    └── commands/           # Generated commands
```

## Local Storage Structure (Mode B)

为了实现项目隔离和便携性，oh-my-opencode 采用了 **Mode B** 架构，将所有学习产物存储在 skill 本地的 `references/` 目录中，而非全局路径。

### Storage Layers

- **Storage Layer (观察存储)**: `references/observations/`
  - 记录原始观察、模式检测结果和初步本能。
  - `index.md`: 观察索引，记录所有已识别的模式。
- **Output Layer (演化产物)**: `references/evolved/`
  - **Drafts (`drafts/`)**: 由观察演化而来的草稿，待用户审核。
  - **Published (`published/`)**: 已通过审核并发布的知识，可直接被其他 Agent 调用。

```
references/
├── observations/           # 存储层：原始观察
│   ├── index.md           # 观察索引
│   └── {pattern-name}.md  # 单个观察记录
└── evolved/                # 产出层：演化知识
    ├── drafts/            # 草稿（待审核）
    └── published/         # 已发布（正式本能）
```

## Linkage Mechanism: Observations → Evolution → Skills

系统的核心流程是从分散的观察中提取规律，并最终沉淀为可复用的技能。

```
观察阶段 (Hooks)                 演化阶段 (Commands)
┌─────────────────┐         ┌─────────────────┐
│ observer-detector│         │ /evolve         │
│ instinct-learner │    →    │ skill-create    │
│ pattern-extraction│        │                 │
└────────┬────────┘         └────────┬────────┘
         │ 写入                      │ 生成
         ▼                           ▼
┌─────────────────────────────────────────────┐
│         references/                          │
│  observations/  ───────→  evolved/drafts/   │
│  (存储层：数据收集)           (产出层：知识演化)      │
└─────────────────────────────────────────────┘
```

## Agent Behavior Guide: When to Observe

### 何时写入 observations/

Agent 在执行任务时，若发现以下情况，**必须**主动将观察记录到 `references/observations/`：

| 触发场景 | 说明 | 写入内容 |
|----------|------|----------|
| **错误循环** | 连续失败 2 次以上或陷入逻辑死循环 | 错误模式、失败原因及绕过方案 |
| **用户纠偏** | 用户对代码风格、逻辑或工具选择提出明确修改意见 | 用户偏好、强制约束 |
| **工作流提取** | 成功完成一个复杂的多步骤任务（如重构、新功能实现） | 任务链条、关键决策点、依赖关系 |
| **重复模式** | 发现相同的操作或代码结构出现 3 次以上 | 抽象后的行为模式 |

### 观察文件格式

所有观察文件必须包含标准的 YAML 元数据，以便演化工具解析：


```yaml
---
name: pattern-name
type: observation
confidence: 0.7
domain: workflow-optimization
session_count: 3
last_observed: 2026-02-01T12:00:00Z
created: 2026-02-01T10:00:00Z
---
```

## Linkage Mechanism

```
观察者 Hooks                    演化命令
┌─────────────────┐         ┌─────────────────┐
│ observer-detector│         │ /evolve         │
│ instinct-learner │    →    │ skill-create    │
│ pattern-extraction│        │                 │
└────────┬────────┘         └────────┬────────┘
         │ 写入                      │ 生成
         ▼                           ▼
┌─────────────────────────────────────────────┐
│         references/                          │
│  observations/  ───────→  evolved/drafts/   │
│  (存储层)                  (产出层)          │
└─────────────────────────────────────────────┘
```

### Two-Stage Evolution

1. **草稿阶段** → `references/evolved/drafts/`
   - 高置信度观察（>= 0.7）可通过 `/evolve` 演化
   - 生成 Skill 草稿待审核

2. **发布阶段** → 用户确认后
   - 移动到 `references/evolved/published/`
   - 或发布到 `~/.claude/skills/` 全局可用

## Confidence Scoring

Confidence evolves over time:

| Score | Meaning | Behavior |
|-------|---------|----------|
| 0.3 | Tentative | Suggested but not enforced |
| 0.5 | Moderate | Applied when relevant |
| 0.7 | Strong | Auto-approved for application |
| 0.9 | Near-certain | Core behavior |

**Confidence increases** when:
- Pattern is repeatedly observed
- User doesn't correct the suggested behavior
- Similar instincts from other sources agree

**Confidence decreases** when:
- User explicitly corrects the behavior
- Pattern isn't observed for extended periods
- Contradicting evidence appears

## Why Hooks vs Skills for Observation?

> "v1 relied on skills to observe. Skills are probabilistic—they fire ~50-80% of the time based on Claude's judgment."

Hooks fire **100% of the time**, deterministically. This means:
- Every tool call is observed
- No patterns are missed
- Learning is comprehensive

## Backward Compatibility

v2 is fully compatible with v1:
- Existing `~/.claude/skills/learned/` skills still work
- Stop hook still runs (but now also feeds into v2)
- Gradual migration path: run both in parallel

## Privacy

- Observations stay **local** on your machine
- Only **instincts** (patterns) can be exported
- No actual code or conversation content is shared
- You control what gets exported

## Related

- [Skill Creator](https://skill-creator.app) - Generate instincts from repo history
- [Homunculus](https://github.com/humanplane/homunculus) - Inspiration for v2 architecture
- [The Longform Guide](https://x.com/affaanmustafa/status/2014040193557471352) - Continuous learning section

---

*Instinct-based learning: teaching Claude your patterns, one observation at a time.*
