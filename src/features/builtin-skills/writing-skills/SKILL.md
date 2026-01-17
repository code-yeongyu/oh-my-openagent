---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
---

# Writing Skills

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

**Personal skills live in agent-specific directories (`~/.claude/skills` for Claude Code, `~/.codex/skills` for Codex)** 

You write test cases (pressure scenarios with subagents), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

**REQUIRED BACKGROUND:** You MUST understand superpowers:test-driven-development before using this skill. That skill defines the fundamental RED-GREEN-REFACTOR cycle. This skill adapts TDD to documentation.

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future Claude instances find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides

**Skills are NOT:** Narratives about how you solved something

## The TDD Cycle for Skills

### RED Phase - Baseline Testing

**Create pressure test scenario matching today's problem:**
1. Spawn fresh subagent with NO skill loaded
2. Present the exact problem context
3. Document failures:
   - What did agent miss?
   - What shortcuts did it take?
   - What rationalizations did it make?

### GREEN Phase - Write Skill

**Write skill that addresses baseline failures:**
1. YAML frontmatter with name and description
2. Clear overview with core principle
3. Address specific failures from RED phase
4. Run same scenarios WITH skill - verify compliance

### REFACTOR Phase - Close Loopholes

**Identify new failure modes:**
1. Run more scenarios
2. Find NEW rationalizations agents use
3. Add explicit counters to skill
4. Build rationalization rejection table
5. Re-test until bulletproof

## Skill Structure

```markdown
---
name: skill-name
description: When to use this skill (searchable)
---

# Skill Title

## Overview
[What this skill teaches + core principle]

## The Process
[Step-by-step workflow]

## Quick Reference
[Table or checklist for fast lookup]

## Rationalizations to Reject
[Common excuses agents make to skip the skill]

## Red Flags
[Never/Always lists]

## Integration
[How this skill relates to others]
```

## Writing Tips

**DO:**
- Keep searchable keywords in frontmatter
- Use tables for quick reference
- Include concrete examples
- Address specific failure modes

**DON'T:**
- Write narratives
- Skip the baseline test
- Assume agents will follow spirit vs letter
- Make skills too long to scan

## The Bottom Line

**Creating skills IS TDD for process documentation.**

Same Iron Law: No skill without failing test first.
Same cycle: RED (baseline) → GREEN (write skill) → REFACTOR (close loopholes).
Same benefits: Better quality, fewer surprises, bulletproof results.

If you follow TDD for code, follow it for skills. It's the same discipline applied to documentation.
