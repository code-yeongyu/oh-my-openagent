---
name: usability-testing
description: Use when planning or conducting usability tests — writing test scripts, defining tasks, selecting participants, analysing findings, and turning observations into design actions
---

# Usability Testing

Testing with real people is how you find out if the design works — not by looking at it, but by watching someone use it.

## When to Use

- After design-builder produces a working prototype
- Before declaring a design complete
- When the design-critic flags persona coverage gaps
- When assumptions about user behaviour need evidence

## Process

### Step 1: Define What You're Testing

Write 3-5 task scenarios that map to the core jobs in the brief. Each task:
- **Starts with a realistic trigger** — "You just bought a new plant and want to add it to the app"
- **Has a clear success condition** — "The plant appears in your list with a watering schedule"
- **Does not tell the user how** — never say "tap the + button"

### Step 2: Select Participants

Recruit 5-8 participants. At minimum include:
- 1 person who uses a screen reader
- 1 person over 60
- 1 person who is not a native speaker of the interface language
- 1 person with low tech confidence

Reference `inclusive-personas` for the ability spectrum.

### Step 3: Choose Method

| Method | When to use | Minimum participants |
|--------|-----------|---------------------|
| Moderated think-aloud | New flows, complex interactions | 5 |
| Unmoderated remote | Simple tasks, large sample | 8-12 |
| Guerrilla (hallway) | POC validation, time-constrained | 3-5 |
| Accessibility audit with AT users | After build, before ship | 2-3 |

### Step 4: Write the Test Script

1. **Welcome** — explain what you're testing (the design, not them)
2. **Background** — 2-3 questions about their relationship to the problem
3. **Tasks** — present each scenario one at a time, observe silently
4. **Debrief** — "What was hardest?" "What would you change?"

Never help during a task. Silence is data.

### Step 5: Analyse Findings

Classify outcomes per task:
- **Completed easily** — no hesitation, no errors
- **Completed with difficulty** — hesitation or errors but recovered
- **Failed** — could not complete
- **Completed wrong** — thought they succeeded but didn't

Severity: Critical (blocks 2+ participants), Major (significant difficulty), Minor (noticed but not impeding).

### Step 6: Turn Findings Into Actions

Every finding becomes a design action: "[Severity] [What happened] → [Design action] → [Which agent handles it]"

## What You Deliver

- Task success rates table
- Ranked findings by severity
- Design actions with agent assignments
- Recommendation: iterate / ship / rethink

## Integration

- **Informed by:** `inclusive-personas`, `design-discovery`
- **Feeds into:** `design-lead`, `design-builder`, `design-strategist`
