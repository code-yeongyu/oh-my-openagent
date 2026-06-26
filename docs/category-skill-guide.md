# Category & Skill System Guide

This document provides a comprehensive guide to the **Category** and **Skill** systems, which form the extensibility core of Matrixx.

## 1. Overview

Instead of delegating everything to a single AI agent, it's far more efficient to invoke **specialists** tailored to the nature of the task.

- **Category**: "What kind of work is this?" (determines model, temperature, prompt mindset)
- **Skill**: "What tools and knowledge are needed?" (injects specialized knowledge, MCP tools, workflows)

By combining these two concepts, you can generate optimal agents through `task`.

---

## 2. Category System

A Category is an agent configuration preset optimized for specific domains.

### Available Built-in Categories

| Category | Default Model | Use Cases |
|----------|---------------|-----------|
| `construct` | Claude Sonnet 4.6 | Frontend, UI/UX, design, styling, animation |
| `source` | Claude Opus 4.6 | Hard logic, backend, core implementation |
| `deep-jack` | Claude Sonnet 4.6 | Goal-oriented autonomous problem-solving. Thorough research before action. |
| `matrix-bend` | Claude Sonnet 4.6 | Creative tasks, novel ideas |
| `bullet-time` | Claude Haiku 4.5 | Quick fixes, trivial tasks — single file changes, typo fixes |
| `blue-pill` | Claude Sonnet 4.6 | General tasks, moderate effort |
| `red-pill` | Claude Opus 4.6 | Complex tasks, high effort |
| `broadcast` | Claude Sonnet 4.6 | Documentation, prose, technical writing |

### Usage

Specify the `category` parameter when invoking the `task` tool.

```typescript
task(
  category="source",
  prompt="Add a responsive chart component to the dashboard page"
)
```

### Mouse (Delegated Executor)

When you use a Category, a special agent called **Mouse** performs the work.
- **Characteristic**: Cannot **re-delegate** tasks to other agents.
- **Purpose**: Prevents infinite delegation loops and ensures focus on the assigned task.

---

## 3. Skill System

A Skill is a mechanism that injects **specialized knowledge (Context)** and **tools (MCP)** for specific domains into agents.

### Built-in Skills (31 total)

**Development & Tools (5):**
- **`git-master`** — Git expert. Detects commit styles, splits atomic commits, rebase strategies.
- **`tdd-enforcer`** — TDD workflow enforcement (RED → GREEN → REFACTOR).
- **`quality-gate`** — Automated quality verification: lint, typecheck, test, build.
- **`software-dev`** — Structured 6-phase development pipeline (PLAN → BUILD → VERIFY → REVIEW → SECURE → SHIP).
- **`review-work`** — Post-implementation review orchestrator with 5 parallel agents.

**Frontend & Browser (4):**
- **`playwright`** — Browser automation. Web page testing, screenshots, scraping. MCP: `@playwright/mcp` (auto-executed)
- **`dev-browser`** — Browser automation with persistent page state.
- **`agent-browser`** — Agent-controlled browser automation.
- **`frontend-ui-ux`** — Designer mindset. Color, typography, motion guidelines.

**DSL Engineering (11):**
- **`dsl-core`**, **`dsl-grammar`**, **`dsl-codegen`**, **`dsl-metamodel`**, **`dsl-tooling`**
- **`dsl-textx-ecosystem`**, **`dsl-pyecore-advanced`**, **`dsl-model-transformation`**
- **`dsl-testing`**, **`dsl-validation`**, **`dsl-composition`**

**Security (9):**
- **`security-core`**, **`security-secrets`**, **`security-sast`**, **`security-dast`**
- **`security-dependencies`**, **`security-api`**, **`security-crypto`**
- **`security-infra`**, **`security-review`**

**Configuration (1):**
- **`matrixx-self-config`** — Configure and tune Matrixx for the current user.

### Usage

Add desired skill names to the `load_skills` array.

```typescript
task(
  category="quick",
  load_skills=["git-master"],
  prompt="Commit current changes. Follow commit message style."
)
```

### Skill Customization (SKILL.md)

You can add custom skills directly to `.opencode/skills/` in your project root or `~/.claude/skills/` in your home directory.

**Example: `.opencode/skills/my-skill/SKILL.md`**

```markdown
---
name: my-skill
description: My special custom skill
mcp:
  my-mcp:
    command: npx
    args: ["-y", "my-mcp-server"]
---

# My Skill Prompt

This content will be injected into the agent's system prompt.
...
```

---

## 4. Combination Strategies (Combos)

You can create powerful specialized agents by combining Categories and Skills.

### 🎨 The Designer (UI Implementation)
- **Category**: `construct`
- **load_skills**: `["frontend-ui-ux", "playwright"]`
- **Effect**: Implements aesthetic UI and verifies rendering results directly in browser.

### 🏗️ The Architect (Design Review)
- **Category**: `red-pill`
- **load_skills**: `[]` (pure reasoning)
- **Effect**: Leverages Claude Opus reasoning for in-depth system architecture analysis.

### ⚡ The Maintainer (Quick Fixes)
- **Category**: `bullet-time`
- **load_skills**: `["git-master"]`
- **Effect**: Uses cost-effective models to quickly fix code and generate clean commits.

---

## 5. task Prompt Guide

When delegating, **clear and specific** prompts are essential. Include these 7 elements:

1. **TASK**: What needs to be done? (single objective)
2. **EXPECTED OUTCOME**: What is the deliverable?
3. **REQUIRED SKILLS**: Which skills should be loaded via `load_skills`?
4. **REQUIRED TOOLS**: Which tools must be used? (whitelist)
5. **MUST DO**: What must be done (constraints)
6. **MUST NOT DO**: What must never be done
7. **CONTEXT**: File paths, existing patterns, reference materials

**Bad Example**:
> "Fix this"

**Good Example**:
> **TASK**: Fix mobile layout breaking issue in `LoginButton.tsx`
> **CONTEXT**: `src/components/LoginButton.tsx`, using Tailwind CSS
> **MUST DO**: Change flex-direction at `md:` breakpoint
> **MUST NOT DO**: Modify existing desktop layout
> **EXPECTED**: Buttons align vertically on mobile

---

## 6. Configuration Guide (matrixx.json)

You can fine-tune categories in `matrixx.json`.

### Category Configuration Schema (CategoryConfig)

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description of the category's purpose. Shown in task prompt. |
| `model` | string | AI model ID to use (e.g., `anthropic/claude-opus-4-6`) |
| `variant` | string | Model variant (e.g., `max`, `xhigh`) |
| `temperature` | number | Creativity level (0.0 ~ 2.0). Lower is more deterministic. |
| `top_p` | number | Nucleus sampling parameter (0.0 ~ 1.0) |
| `prompt_append` | string | Content to append to system prompt when this category is selected |
| `thinking` | object | Thinking model configuration (`{ type: "enabled", budgetTokens: 16000 }`) |
| `reasoningEffort` | string | Reasoning effort level (`low`, `medium`, `high`) |
| `textVerbosity` | string | Text verbosity level (`low`, `medium`, `high`) |
| `tools` | object | Tool usage control (disable with `{ "tool_name": false }`) |
| `maxTokens` | number | Maximum response token count |
| `is_unstable_agent` | boolean | Mark agent as unstable - forces background mode for monitoring |

### Example Configuration

```jsonc
{
  "categories": {
    // 1. Define new custom category
    "korean-writer": {
      "model": "anthropic/claude-sonnet-4-6",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone."
    },
    
    // 2. Override existing category (change model)
    "construct": {
      "model": "openai/gpt-5.3-codex", // Can change model
      "temperature": 0.8
    },

    // 3. Configure thinking model and restrict tools
    "deep-reasoning": {
      "model": "anthropic/claude-opus-4-6",
      "thinking": {
        "type": "enabled",
        "budgetTokens": 32000
      },
      "tools": {
        "websearch_web_search_exa": false // Disable web search
      }
    }
  },
  
  // Disable skills
  "disabled_skills": ["playwright"]
}
```
