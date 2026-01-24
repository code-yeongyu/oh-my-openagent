# Category & Skill System Guide

This document provides a comprehensive guide to the **Category** and **Skill** systems, which form the extensibility core of Oh-My-OpenCode.

## 1. Overview

Instead of delegating everything to a single AI agent, it's far more efficient to invoke **specialists** tailored to the nature of the task.

- **Category**: "What kind of work is this?" (determines model, temperature, prompt mindset)
- **Skill**: "What tools and knowledge are needed?" (injects specialized knowledge, MCP tools, workflows)

By combining these two concepts, you can generate optimal agents through `delegate_task`.

---

## 2. Category System

A Category is an agent configuration preset optimized for specific domains.

### Available Built-in Categories

| Category | Default Model | Use Cases |
|----------|---------------|-----------|
| `visual-engineering` | `google/gemini-3-pro` | Frontend, UI/UX, design, styling, animation |
| `ultrabrain` | `openai/gpt-5.2-codex` (xhigh) | Deep logical reasoning, complex architecture decisions requiring extensive analysis |
| `artistry` | `google/gemini-3-pro` (max) | Highly creative/artistic tasks, novel ideas |
| `quick` | `anthropic/claude-haiku-4-5` | Trivial tasks - single file changes, typo fixes, simple modifications |
| `unspecified-low` | `anthropic/claude-sonnet-4-5` | Tasks that don't fit other categories, low effort required |
| `unspecified-high` | `anthropic/claude-opus-4-5` (max) | Tasks that don't fit other categories, high effort required |
| `writing` | `google/gemini-3-flash` | Documentation, prose, technical writing |

### Usage

Specify the `category` parameter when invoking the `delegate_task` tool.

```typescript
delegate_task(
  category="visual-engineering",
  prompt="Add a responsive chart component to the dashboard page"
)
```

### Sisyphus-Junior (Delegated Executor)

When you use a Category, a special agent called **Sisyphus-Junior** performs the work.
- **Characteristic**: Cannot **re-delegate** tasks to other agents.
- **Purpose**: Prevents infinite delegation loops and ensures focus on the assigned task.

---

## 3. Skill System

A Skill is a mechanism that injects **specialized knowledge (Context)** and **tools (MCP)** for specific domains into agents.

### Built-in Skills

1. **`git-master`**
   - **Capabilities**: Git expert. Detects commit styles, splits atomic commits, formulates rebase strategies.
   - **MCP**: None (uses Git commands)
   - **Usage**: Essential for commits, history searches, branch management.

2. **`playwright`**
   - **Capabilities**: Browser automation. Web page testing, screenshots, scraping.
   - **MCP**: `@playwright/mcp` (auto-executed)
   - **Usage**: For post-implementation UI verification, E2E test writing.

3. **`frontend-ui-ux`**
   - **Capabilities**: Injects designer mindset. Color, typography, motion guidelines.
   - **Usage**: For aesthetic UI work beyond simple implementation.

### Usage

Add desired skill names to the `skills` array.

```typescript
delegate_task(
  category="quick",
  skills=["git-master"],
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
- **Category**: `visual-engineering`
- **Skills**: `["frontend-ui-ux", "playwright"]`
- **Effect**: Implements aesthetic UI and verifies rendering results directly in browser.

### 🏗️ The Architect (Design Review)
- **Category**: `ultrabrain`
- **Skills**: `[]` (pure reasoning)
- **Effect**: Leverages GPT-5.2's logical reasoning for in-depth system architecture analysis.

### ⚡ The Maintainer (Quick Fixes)
- **Category**: `quick`
- **Skills**: `["git-master"]`
- **Effect**: Uses cost-effective models to quickly fix code and generate clean commits.

---

## 5. delegate_task Prompt Guide

When delegating, **clear and specific** prompts are essential. Include these 7 elements:

1. **TASK**: What needs to be done? (single objective)
2. **EXPECTED OUTCOME**: What is the deliverable?
3. **REQUIRED SKILLS**: Which skills should be used?
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

## 6. Configuration Guide (oh-my-opencode.json)

You can fine-tune categories in `oh-my-opencode.json`.

### Category Configuration Schema (CategoryConfig)

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Human-readable description of the category's purpose. Shown in delegate_task prompt. |
| `model` | string | AI model ID to use (e.g., `anthropic/claude-opus-4-5`) |
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
      "model": "google/gemini-3-flash",
      "temperature": 0.5,
      "prompt_append": "You are a Korean technical writer. Maintain a friendly and clear tone."
    },
    
    // 2. Override existing category (change model)
    "visual-engineering": {
      "model": "openai/gpt-5.2", // Can change model
      "temperature": 0.8
    },

    // 3. Configure thinking model and restrict tools
    "deep-reasoning": {
      "model": "anthropic/claude-opus-4-5",
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
