---
name: writing-design-plans
description: Use when you have a design brief or strategy and need to break implementation into reviewable chunks — creates step-by-step plans with verification criteria for each task
---

# Writing Design Plans

A design plan breaks an approved design direction into discrete, reviewable tasks. Each task is small enough to evaluate clearly and specific enough that the result is predictable.

## When to Use

- After design-discovery and/or design-strategy have produced an approved direction
- Before any implementation work begins
- When a design task is too large to complete and review in one step

## Process

### Step 1: Review Inputs

Gather:
- Design brief (from design-discovery)
- Strategy document (from design-strategy, if applicable)
- Personas (from inclusive-personas)
- Existing design system inventory

### Step 2: Identify Design Tasks

Break the work into categories:

1. **Structure tasks** — information architecture, page hierarchy, navigation
2. **Component tasks** — individual UI components that need designing
3. **Layout tasks** — how components compose into screens
4. **Interaction tasks** — states, transitions, feedback patterns
5. **Content tasks** — copy, labels, error messages, help text
6. **Accessibility tasks** — specific inclusive design requirements per component

### Step 3: Order the Work

Design work has natural dependencies:

```
Structure → Layout → Components → Interactions → Content → Review
     ↑ accessibility woven through each step, not a final phase ↑
```

Order tasks so that:
- Foundation work (structure, layout) comes before detail work (interactions, content)
- Each task can be reviewed independently
- Accessibility is addressed within each task, not deferred

### Step 4: Write the Plan

```markdown
# Design Plan: [Feature/Project Name]

> **For agentic workers:** REQUIRED: Use designpowers:designpowers-critique to review completed work against this plan.

**Goal:** [One sentence — what this plan delivers]

**Design Direction:** [Reference to the design brief or strategy]

**Personas:** [Reference to personas this plan serves]

---

## Task 1: [Task Name]

**Files:** [Which files will be created or modified]

- [ ] Step 1: [Specific action]
- [ ] Step 2: [Specific action]
- [ ] Step 3: [Specific action]

**Accessibility check:** [What inclusive design criteria this task must meet]

**Verification:** [How to confirm this task is complete and correct]

---

## Task 2: [Task Name]
...
```

### Step 5: Task Sizing

Each task should be:
- **2-5 minutes of focused work** — small enough to hold in your head
- **Independently reviewable** — someone can evaluate it without seeing everything else
- **Specifically described** — exact files, exact components, exact acceptance criteria
- **Accessibility-inclusive** — each task addresses its own inclusive design requirements

If a task takes longer than 5 minutes, break it down further.

### Step 6: Save and Review

Save to: `docs/designpowers/plans/YYYY-MM-DD-<feature>-plan.md`

Present the plan to the user. Walk through:
- Does the task order make sense?
- Are any tasks missing?
- Are the accessibility checks appropriate for each task?
- Is the scope right, or should anything be deferred?

User must approve the plan before execution begins.

## Integration

- **Called by:** `design-discovery`, `design-strategy`
- **Calls:** Implementation begins via the relevant design skills (`ui-composition`, `interaction-design`, etc.)
- **Pairs with:** `designpowers-critique` (reviews work against the plan)

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| Tasks without accessibility checks | Every task affects the user experience. Every task has accessibility implications |
| Tasks that say "make it look good" | Vague tasks produce vague results. Be specific about what "good" means |
| Accessibility as the final task | By then it is too late. Accessibility is in every task |
| Plan without persona references | If you do not know who you are designing for, you cannot verify the design works |
