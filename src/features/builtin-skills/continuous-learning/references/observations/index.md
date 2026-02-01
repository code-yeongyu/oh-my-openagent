# Observations Index

此目录存储由以下 hooks 自动检测并记录的观察：
- `observer-detector` - 异常检测
- `instinct-learner` - 模式检测（3次阈值）
- `pattern-extraction` - 会话压缩时提取

## 文件格式

每个观察记录为独立的 .md 文件：

```yaml
---
name: pattern-name
type: observation
confidence: 0.7
domain: workflow-optimization
session_count: 3
last_observed: ISO日期
created: ISO日期
---

# Observation: [Pattern Name]

## Pattern Detected
[描述]

## Evidence
[观察记录]

## Suggested Action
[建议]
```

## 联动机制

观察 → 演化：
1. 高置信度观察（>= 0.7）可通过 `/evolve` 命令演化
2. 演化结果存储在 `../evolved/drafts/`
3. 用户确认后发布到 `../evolved/published/` 或 `~/.claude/skills/`
