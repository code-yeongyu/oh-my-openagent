name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design, then creates change directory with proposal."
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

1. **Determine Change Name**: kebab-case, verb prefix (`add-`, `fix-`, `update-`)
2. **Create Directory**: `changes/<name>/`
3. **Write proposal.md**: See `reference.md` for template
4. **Update Status**: `.superpowers/status.json`

## Key Principles

- **One question at a time** - Don't overwhelm
- **Multiple choice preferred** - Easier to answer
- **YAGNI ruthlessly** - Remove unnecessary features
- **Explore alternatives** - Always propose 2-3 approaches

## Completion

Report: "Created change: `changes/<name>/`. Proposal saved to `proposal.md`."

## Next Step

**REQUIRED SUB-SKILL:** Use superpowers:creating-changes to write design and task breakdown.

## References

- `reference.md`: Templates for proposal.md, options table, status.json
