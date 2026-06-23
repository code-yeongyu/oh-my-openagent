---
name: design-retrospective
description: Use after shipping or completing a design project — structured reflection on what worked, what didn't, and what taste decisions landed. Adds observations to the design record (design-memory) about how the user designs — a descriptive journal, not preferences applied to future projects
---

# Design Retrospective

A retrospective is not a post-mortem. Post-mortems examine failures. Retrospectives examine the whole process — wins, misses, surprises, and taste evolution. This skill runs after a project ships and turns hindsight into foresight for the next one.

## When to Use

- After `verification-before-shipping` passes and the project is declared complete
- When the user says "let's reflect" or "what did we learn?"
- At natural project milestones (end of a major phase, end of a sprint)
- When restarting work on a project after a break — retrospect on what came before

## Process

### Step 1: Gather Evidence

Before reflecting, assemble the full record:

1. **Read `design-state.md`** — the decisions log, handoff chain, and open questions
2. **Read the taste profile** — what was known at the start vs now
3. **Review user overrides** — every correction, redirect, and override from the handoff chain
4. **Review critique findings** — what the design-critic and accessibility-reviewer flagged
5. **Review fix rounds** — how many, what was fixed, what kept coming back
6. **Check the original brief** — compare what was asked for vs what was delivered

### Step 2: Evaluate What Worked

For each major design decision that survived to shipping:

```markdown
### What Worked

| Decision | Why It Worked | Evidence |
|----------|--------------|----------|
| [Decision from state log] | [Why this was the right call] | [User approved, critic passed, no fix rounds needed] |
| ... | ... | ... |
```

Look for:
- Decisions that sailed through critique without issues
- Choices the user explicitly praised
- Patterns that emerged naturally and felt right
- Accessibility approaches that enhanced rather than constrained the design
- Moments that revealed something characteristic about how the user designs (to note in the record — not to apply later)

### Step 3: Evaluate What Didn't Work

For decisions that required rework, debate, or user correction:

```markdown
### What Didn't Work

| Decision | What Went Wrong | Root Cause | Fix Rounds |
|----------|----------------|------------|------------|
| [Original decision] | [What happened] | [Why it happened — misread brief? ignored taste? wrong assumption?] | [How many iterations to fix] |
| ... | ... | ... | ... |
```

Look for:
- Decisions the user overrode — what signal did we miss?
- Findings that came back in multiple fix rounds — why wasn't it caught earlier?
- Accessibility issues that should have been caught in design, not review
- Moments where agents converged on a direction too quickly (a debate might have helped)
- Taste profile mismatches — did we apply an old preference to a new context?

### Step 4: Process Evaluation

Evaluate the workflow itself, not just the output:

```markdown
### Process Assessment

**Pipeline efficiency:**
- Agents dispatched: [X of 10]
- Agents skipped: [list and why]
- Fix rounds: [count] — [were they necessary or preventable?]
- Mode used: [direct/auto/mixed] — [did the mode serve the project?]

**Handoff quality:**
- Were handoff messages specific enough?
- Did any agent miss context from the previous agent?
- Were there gaps where information was lost between agents?

**Debate moments:**
- Were there decisions that should have been debated but weren't?
- Were debates held that didn't need to be?
- Did debate outcomes hold, or were they revisited?

**User engagement:**
- How often did the user override or redirect?
- Were overrides concentrated in one area? (signals a systematic gap)
- Did the user switch from auto to direct? (signals the system missed something)
```

### Step 5: Design Debt Review

Review the Design Debt Register from `design-state.md`:

```markdown
### Design Debt

**Register status:**
- Total items created: [count]
- Resolved: [count] ([percentage])
- Accepted: [count] — [were these the right trade-offs?]
- Still Open: [count] — [should any escalate?]
- Escalated during project: [count]

**Debt patterns:**
- Most affected persona: [name] — [X items affect them]
- Most common source: [design-critic/accessibility-reviewer]
- Average age of open items: [duration]

**Debt health:**
- [ ] Are we resolving debt faster than we create it?
- [ ] Are the same types of issues recurring? (signals a systemic problem)
- [ ] Did any accepted debt turn out to matter more than expected?
```

### Step 6: Taste Evolution

Note what this project revealed about how the user designs, to add to the observational record. This is *describing* the user's habits, not setting rules for future work:

```markdown
### What this project revealed (observations for the record)

**Recurring decisions reinforced:**
- [Observation] — now seen in [N] projects, per [evidence]

**New habits or inclinations noticed:**
- [Observation] — first seen here, per [evidence]

**Things the user moved away from:**
- [Observation] — corrected/reversed because [reason]

**Surprises:**
- [What was characteristic or unexpected about how they decided] — e.g. chose [X] over [Y]

_(All recorded as descriptions of how the user designs — never as preferences to apply to future work.)_
```

### Step 7: Carry-Forward Items

What should the next project know?

```markdown
### Carry Forward

**For the next project:**
- [Lesson learned that applies broadly]
- [Process improvement to try]
- [Taste insight to remember]

**For specific agents:**
| Agent | Lesson |
|-------|--------|
| **design-lead** | [e.g., "User prefers to see colour options before committing — show swatches, not descriptions"] |
| **design-strategist** | [e.g., "Spend more time on the navigation model early — it affected everything downstream"] |
| **content-writer** | [e.g., "User reads everything — content quality matters more than expected"] |
| ... | ... |

**Open questions for next time:**
- [Unresolved question that might be relevant in future projects]
```

### Step 8: Write the Retrospective

Compile everything into a single document:

```markdown
# Design Retrospective: [Project Name]

**Date:** [YYYY-MM-DD]
**Duration:** [How long the project ran]
**Mode:** [direct/auto/mixed]
**Agents used:** [X of 10]

## Summary
[3-5 sentences: what was built, what worked, what was hard, what we learned]

## What Worked
[From Step 2]

## What Didn't Work
[From Step 3]

## Process Assessment
[From Step 4]

## Design Debt
[From Step 5]

## Taste Evolution
[From Step 6]

## Carry Forward
[From Step 7]
```

Save to: `[project-root]/design-retrospective.md`

### Step 9: Add to the Design Record

After the retrospective is written:

1. Invoke `design-memory` to add this project's observations to the record
2. Record them as descriptions of *how the user designs* (habits, inclinations), with evidence — never as preferences to apply to future work
3. Update the project history in the record

### Step 10: Present to User

Show the retrospective to the user as a summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DESIGN RETROSPECTIVE: [Project Name]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  WINS:
  • [Top 2-3 things that worked well]

  MISSES:
  • [Top 2-3 things that needed rework]

  TASTE LEARNED:
  • [Key taste insights from this project]

  DESIGN DEBT:
  • Open: [count] | Resolved: [count] | Accepted: [count]
  • Most affected: [persona]

  CARRY FORWARD:
  • [Top 2-3 lessons for next time]

  EFFICIENCY:
  • Fix rounds: [count]
  • User overrides: [count]
  • Agents used: [X of 10]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Your taste profile has been updated.
  Next project starts smarter.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Integration

- **Called by:** `using-designpowers` (after project completion or on user request)
- **Reads from:** `design-state.md` (including Design Debt Register), taste profile, critique documents, verification results
- **Writes to:** `[project-root]/design-retrospective.md`
- **Calls:** `design-memory` (to update taste profile with learnings)
- **Pairs with:** `design-memory`, `verification-before-shipping`, `designpowers-critique`

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Skipping retrospective because the project "went fine" | Even smooth projects teach you something. "Why did this go well?" is as valuable as "why did this go wrong?" |
| Blaming agents for wrong decisions | Agents are tools. If the output was wrong, the question is what context they were missing, not what they did wrong |
| Only looking at what failed | Wins are data too. Understanding what worked is how you replicate it |
| Not adding observations to the design record | Each project should leave the user a richer mirror of how they design. The record isn't applied to future work, but it's only honest if it's kept current |
| Running retrospective in auto mode | Retrospectives need user reflection. Always run in direct mode with pauses for user input |
