import type { BuiltinSkill } from "../types"
import { readBuiltinSkillTemplate } from "./template-reader"

export const brainstormingSkill: BuiltinSkill = {
  name: "brainstorming",
  description:
    "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design, then creates change directory with proposal.",
  template: `# Brainstorming Ideas Into Designs

## When to Use This Skill

Trigger when any of these applies:
- User requests a new feature or capability
- User wants to design or plan something
- User says "build", "create", "add", "implement" for something new
- Before any creative work that modifies behavior

## Not For / Boundaries

- Simple bug fixes with clear solutions
- Direct file edits with explicit instructions
- If missing critical information, ask 1-3 questions before proceeding

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue, then create a structured change directory with proposal document.

**Announce at start:** "I'm using the brainstorming skill to explore requirements and create a proposal."

## The Process

### Phase 1: Understanding the Idea

1. Check out the current project state first (files, docs, recent commits)
2. Ask questions one at a time to refine the idea
3. Prefer multiple choice questions when possible
4. Focus on understanding: purpose, constraints, success criteria

### Phase 2: Exploring Approaches

1. Propose 2-3 different approaches with trade-offs
2. Present options conversationally with your recommendation and reasoning
3. Lead with your recommended option and explain why

### Phase 3: Presenting the Design

1. Present the design in sections of 200-300 words
2. Ask after each section whether it looks right so far
3. Cover: architecture, components, data flow, error handling, testing

### Phase 4: Create Change Directory and Proposal

After the design is validated:

1. **Determine Change Name**: kebab-case, verb prefix (\`add-\`, \`fix-\`, \`update-\`)
2. **Create Directory**: \`changes/<name>/\`
3. **Write proposal.md**: See \`reference.md\` for template
4. **Update Status**: \`.sisyphus/boulder.json\`

## Key Principles

- **One question at a time** - Don't overwhelm
- **Multiple choice preferred** - Easier to answer
- **YAGNI ruthlessly** - Remove unnecessary features
- **Explore alternatives** - Always propose 2-3 approaches

## Completion

Report: "Created change: \`changes/<name>/\`. Proposal saved to \`proposal.md\`."

## Next Step

**REQUIRED SUB-SKILL:** Use superpowers:creating-changes to write design and task breakdown.

## References

- \`reference.md\`: Templates for proposal.md, options table, boulder.json`,
}

export const creatingChangesSkill: BuiltinSkill = {
  name: "creating-changes",
  description:
    "Use after brainstorming to write design document and task breakdown. Creates design.md and tasks.md in the change directory.",
  template: readBuiltinSkillTemplate("creating-changes"),
}

export const verificationBeforeCompletionSkill: BuiltinSkill = {
  name: "verification-before-completion",
  description:
    "Verify deliverables meet acceptance criteria, are test-validated, and ready for handoff or archival.",
  template: readBuiltinSkillTemplate("verification-before-completion"),
}

export const usingGitWorktreesSkill: BuiltinSkill = {
  name: "using-git-worktrees",
  description:
    "Use when starting feature work that needs isolation from current workspace or before executing implementation plans - creates isolated git worktrees with smart directory selection and safety verification",
  template: readBuiltinSkillTemplate("using-git-worktrees"),
}

export const dispatchingParallelAgentsSkill: BuiltinSkill = {
  name: "dispatching-parallel-agents",
  description:
    "Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies",
  template: readBuiltinSkillTemplate("dispatching-parallel-agents"),
}

export const subagentDrivenDevelopmentSkill: BuiltinSkill = {
  name: "subagent-driven-development",
  description: "Use when executing implementation plans with independent tasks in the current session",
  template: readBuiltinSkillTemplate("subagent-driven-development"),
}

export const waveParallelExecutionSkill: BuiltinSkill = {
  name: "wave-parallel-execution",
  description: "Use when executing plans with multiple independent waves in parallel",
  template: readBuiltinSkillTemplate("wave-parallel-execution"),
}

export const executingPlansSkill: BuiltinSkill = {
  name: "executing-plans",
  description:
    "Use when you have a written implementation plan to execute in a separate session with review checkpoints",
  template: readBuiltinSkillTemplate("executing-plans"),
}

export const finishingADevelopmentBranchSkill: BuiltinSkill = {
  name: "finishing-a-development-branch",
  description:
    "Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup",
  template: readBuiltinSkillTemplate("finishing-a-development-branch"),
}

export const archivingChangesSkill: BuiltinSkill = {
  name: "archiving-changes",
  description: "归档已完成的变更",
  template: readBuiltinSkillTemplate("archiving-changes"),
}
