---
name: evolve
description: 将观察记录演化为可执行的 Skill/Command
triggers:
  - "演化"
  - "evolve"
  - "把观察变成技能"
  - "从模式生成 skill"
  - "帮我演化最近的观察"
version: 1.0.0
---

# Evolve Skill

将 `continuous-learning` 收集的观察记录演化为可复用的 Skill。

## When to Use

当你想要：
- 将重复的工作模式转化为自动化 Skill
- 从观察记录中提炼可复用的规则
- 演化高置信度模式（>= 0.7）

## Process

1. **读取观察**
   - 读取 `continuous-learning/references/observations/` 中的观察文件
   - 筛选高置信度模式（confidence >= 0.7）

2. **分析聚类**
   - 按 domain 分组相关观察
   - 识别可合并的模式

3. **生成草稿**
   - 生成 Skill 草稿到 `continuous-learning/references/evolved/drafts/`
   - 包含 SKILL.md 骨架

4. **用户确认**
   - 展示草稿内容
   - 询问是否发布

5. **发布**
   - 用户确认后移动到 `references/evolved/published/`
   - 或发布到 `~/.claude/skills/` 全局可用

## Two-Stage Output

```
Stage 1 (Draft):
  continuous-learning/references/evolved/drafts/{skill-name}/SKILL.md

Stage 2 (Publish):
  用户确认后 → continuous-learning/references/evolved/published/
             → 或 ~/.claude/skills/{skill-name}/
```

## Example Usage

用户: "帮我演化最近的观察"

Agent:
1. 读取 observations/ 目录
2. 找到 3 个高置信度观察
3. 生成 Skill 草稿
4. 询问: "已生成 'grep-edit-workflow' Skill 草稿，是否发布？"

## Observation Format Required

观察文件必须包含以下 frontmatter：

```yaml
---
name: pattern-name
type: observation
confidence: 0.7  # >= 0.7 才会被演化
domain: workflow-optimization
---
```

## Output Skill Format

生成的 Skill 草稿格式：

```markdown
---
name: {derived-from-observation}
description: {auto-generated}
source: auto-evolved
evolved_from:
  - {observation-1}
  - {observation-2}
created: {timestamp}
---

# {Skill Name}

## When to Use
{derived from observation triggers}

## Process
{derived from observation patterns}

## References
- Evolved from: {observation files}
```
