---
description: Generate a new custom command based on workflow description and best practices.
---

# Create Custom Command

## Overview

Generate a new custom command based on the user's workflow description and best practices for command design. Supports three levels of command complexity.

## User Input

```text
$ARGUMENTS
```

## Context: Three Levels of Commands

**Level One (Basic Workflows):** Commands that prepare the agent with context and instructions. These are prime commands that set up the AI for specific tasks.

**Level Two (Control & Variables):** Commands that add control structures, variable management, and conditional logic. They enable dynamic workflows with user inputs.

**Level Three (Loops & Automation):** Commands that execute repeated actions autonomously in loops. They enable full automation of repetitive tasks.

## Steps

### 1. Analyze the User's Request

- Extract the core workflow or task from the user's description
- Identify repetitive elements that should be automated
- Determine the complexity and control requirements
- Assess whether the workflow needs:
  - Simple context preparation (Level 1)
  - Dynamic inputs and conditional logic (Level 2)
  - Repeated execution in loops (Level 3)

### 2. Ask Clarifying Questions

Before proceeding, ask targeted questions to ensure you understand the full requirements:

**Scope and Context:**
- What specific problem or inefficiency is this command solving?
- What is the typical frequency of this task?
- Are there variations or edge cases to consider?

**Inputs and Variables:**
- Does this command need user-provided inputs? (files, parameters, selections)
- Should it work with `$ARGUMENTS`, `$SELECTION`, or both?
- Are there default behaviors when inputs are not provided?

**Outputs and Results:**
- What should the command produce or modify?
- Are there specific formats or locations for outputs?

**Workflow Details:**
- What are the exact steps involved in this workflow?
- Are there dependencies or prerequisites?
- Should steps run sequentially or in parallel?

### 3. Determine Command Level

**Choose Level 1 if:**
- The command primarily sets context or prepares the agent
- No dynamic variables or user inputs are needed

**Choose Level 2 if:**
- The command needs user-provided variables (`$ARGUMENTS` or `$SELECTION`)
- Conditional logic or branching is required

**Choose Level 3 if:**
- The command needs to execute actions repeatedly
- Batch processing or iteration over collections

### 4. Structure the Command

Create a well-organized markdown file with:

**Required Sections:**
- **Title:** Clear, action-oriented name
- **Overview:** Brief description of what the command does
- **Steps:** Numbered, actionable steps that guide the agent

**Optional Sections:**
- **Prerequisites:** What must be in place before running
- **Variables:** Document any `$ARGUMENTS`, `$SELECTION`, or other inputs
- **Output:** What the command produces or modifies
- **Checklist:** Items to verify completion

### 5. Apply Best Practices

**Standardization:**
- Use consistent formatting and structure
- Follow naming conventions (kebab-case for filenames)
- Include clear, step-by-step instructions

**Efficiency:**
- Focus on eliminating repetitive explanations
- Include all necessary context in the command
- Anticipate common variations or edge cases

**Clarity:**
- Write self-documenting step descriptions
- Use bullet points for parallelizable tasks
- Number sequential steps that depend on each other

### 6. Generate the Command File

Create a new `.md` file in `.opencode/command/` with:

1. **Filename:** Use kebab-case based on the command's primary action
2. **YAML Frontmatter:** Include `description:` field
3. **Content:** Follow the structure determined in step 4
4. **Variable Usage:** For Level 2/3 commands, clearly document variable usage

### 7. Review and Refine

Before finalizing, ensure:
- The command addresses the user's workflow completely
- Steps are actionable and unambiguous
- The appropriate command level is selected
- The command follows existing command patterns in the project

## Output Format

Generate a complete command file ready to save. Include:

1. The full markdown content for the new command
2. Recommended filename
3. Brief explanation of why this level was chosen
4. Any suggestions for enhancement or future iterations

## References

- Existing Commands: `.opencode/command/`
- Historian: `.opencode/agent/historian.md`
