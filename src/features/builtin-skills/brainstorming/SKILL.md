name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design through conversation."
---

# Brainstorming Ideas Into Designs

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

Help turn ideas into fully formed designs and specs through natural collaborative dialogue. This skill focuses on **conversation and exploration only** - file creation happens in the creating-changes skill.

**Announce at start:** "I'm using the brainstorming skill to explore requirements and design."

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

### Phase 4: Hand Off to Creating-Changes

After the design is validated through conversation:

1. **Confirm change name**: Suggest kebab-case name with verb prefix (`add-`, `fix-`, `update-`)
2. **Summarize decisions**: Recap key decisions made during brainstorming
3. **Hand off**: Invoke creating-changes skill to create all files

**Note**: This skill does NOT create files. File creation (proposal.md, design.md, tasks.md, findings.md, progress.md) is handled by the creating-changes skill.

## Key Principles

- **One question at a time** - Don't overwhelm
- **Multiple choice preferred** - Easier to answer
- **YAGNI ruthlessly** - Remove unnecessary features
- **Explore alternatives** - Always propose 2-3 approaches
- **Conversation only** - No file creation in this skill

## Completion

Report: "Brainstorming complete. Key decisions captured. Ready to create change directory."

## Next Step

After brainstorming is complete, invoke the next skill in the workflow:

| Condition | Next Skill | Action |
|-----------|------------|--------|
| Design validated | `creating-changes` | `skill("creating-changes")` to create change directory and planning documents |

**REQUIRED:** Do NOT skip this step. The creating-changes skill creates all necessary planning files.

## References

- `reference.md`: Example conversation flows and decision tables
