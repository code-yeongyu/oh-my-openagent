---
name: synthetic-user-testing
description: Use after the fix round to validate the design by walking through key tasks as each persona — simulating how Jordan (low-vision), Priya (non-native speaker), Marcus (motor impairment), or any project persona would actually experience the interface. Catches the issues that code review misses because they only surface in the act of using
---

# Synthetic User Testing

Synthetic user testing is the closest thing to putting the design in front of real people without leaving the pipeline. You walk through the interface as each persona, attempting real tasks, and report what works, what breaks, and what feels wrong — from their perspective, not yours.

This is not a checklist exercise. It is an act of empathy disciplined by specifics. When you test as Jordan (low-vision, uses 200% zoom and high contrast), you don't ask "is contrast sufficient?" — you ask "can Jordan find the 'continue reading' button at 200% zoom when three articles are competing for attention?"

## When to Use

- **After the fix round** — the design-builder has addressed findings from critic, accessibility-reviewer, and heuristic-evaluator. Now validate that the fixes work and no new issues were introduced
- **Before verification-before-shipping** — synthetic testing feeds directly into the persona walkthrough in the verification report
- **When the design-critic flags persona coverage gaps** — if the critique says "unclear whether Persona X can complete Task Y," run a synthetic test to find out
- **When the team is unsure about a flow** — synthetic testing turns "I think this works for screen reader users" into "here's exactly where a screen reader user would get stuck"

## Process

### Step 1: Gather Test Context

Before testing, assemble:
- **Personas** from `inclusive-personas` (via `design-state.md`)
- **Key tasks** from the design brief — the things the design must enable
- **The build** — test the actual implementation, not the spec
- **Assistive technology context** — for each persona, what tools they use and how (zoom level, screen reader, keyboard-only, switch access, etc.)

### Step 2: Define Test Scenarios

For each key task in the brief, write a scenario that a persona would actually encounter. Scenarios are not "test case 1" — they are moments:

**Format:**
```
SCENARIO: [Natural situation trigger]
TASK: [What the persona is trying to accomplish]
PERSONA: [Name] — [key ability context]
SUCCESS: [What "done" looks like for this persona]
```

**Example:**
```
SCENARIO: Jordan is on the train home and wants to finish an article
          they started yesterday.
TASK: Find and continue a partially-read article.
PERSONA: Jordan — low vision, uses 200% zoom, high contrast mode,
         reads on a phone with one hand.
SUCCESS: Jordan locates the article, picks up where they left off,
         and the progress updates when they finish.
```

### Step 3: Walk Through as Each Persona

For each scenario, simulate the persona's experience step by step. This is not "would this work?" — it is "let me try to do this the way [Persona] would."

**For each step, document:**

```
STEP [N]: [What the persona does]
USING: [Input method — touch, keyboard, screen reader, switch, etc.]
SEES: [What the interface presents — at their zoom level, contrast
       setting, screen size]
THINKS: [What the persona would likely think or feel]
RESULT: ✓ succeeds / ⚠ succeeds with difficulty / ✗ fails / ? unclear

FINDING: [If ⚠, ✗, or ? — what went wrong and why]
WHO IS AFFECTED: [This persona, and any others with similar needs]
```

**Critical rules for walking through:**
1. **Stay in character** — if the persona uses a screen reader, evaluate what the screen reader would announce, not what the sighted experience looks like
2. **Use their device** — if the persona reads on a phone at 200% zoom, evaluate at that zoom on a phone viewport
3. **Include emotional state** — a stressed parent and a relaxed commuter approach the same interface differently. The scenario sets the emotional context
4. **Test error paths** — what happens if the persona makes a mistake? Can they recover? How much does recovery cost them?
5. **Note friction, not just failure** — a task that technically succeeds but requires 8 taps and 3 scrolls has a friction problem even if it "works"

### Step 4: Cross-Persona Analysis

After walking through all scenarios, look for patterns across personas:

**Barrier matrix:**
```
| Task              | Jordan    | Priya     | Marcus    | [Persona] |
|                   | (low vis) | (ESL)     | (motor)   |           |
|-------------------|-----------|-----------|-----------|-----------|
| Find article      | ⚠ zoom    | ✓         | ✗ target  | ...       |
| Continue reading  | ✓         | ⚠ jargon  | ✓         | ...       |
| Mark complete     | ✗ no fbk  | ✓         | ⚠ gesture | ...       |
```

**Pattern analysis:**
- **Universal barriers** — issues that affect 2+ personas → likely a design problem, not an edge case
- **Persona-specific barriers** — issues that affect only one persona → may need targeted fix or alternative path
- **Friction hotspots** — steps where multiple personas struggle, even if they eventually succeed
- **Emotional patterns** — where do personas feel confused, frustrated, or lost?

### Step 5: Synthesise Findings

Compile findings into a structured report (see "What You Deliver" below). Every finding must:
- Name the specific persona affected
- Describe the exact step where the issue occurs
- Explain why it's a problem from the persona's perspective
- Suggest a fix
- Classify severity (Critical / Major / Minor)

**Severity in synthetic testing:**
| Severity | Definition |
|----------|-----------|
| **Critical** | Persona cannot complete the task at all |
| **Major** | Persona completes the task but with significant difficulty, confusion, or emotional friction |
| **Minor** | Persona completes the task but the experience is rougher than it should be |

### Step 6: Feed Results Forward

Synthetic testing results feed into two places:
1. **design-builder** — if fixes are needed, dispatch the builder with specific findings
2. **verification-before-shipping** — the persona walkthrough section of the verification report should reference synthetic test results, not guesswork

## What You Deliver

```markdown
# Synthetic User Test Results: [Project Name]

**Date:** [YYYY-MM-DD]
**Build tested:** [what was tested]
**Personas tested:** [list]
**Tasks tested:** [list]

## Summary
[2-3 sentences: overall findings — who can use this, who can't,
 and the biggest gap]

## Scenario Results

### Scenario 1: [Scenario name]
**Persona:** [Name] — [context]
**Task:** [what they're trying to do]
**Result:** ✓ / ⚠ / ✗

[Step-by-step walkthrough with findings]

### Scenario 2: ...

## Barrier Matrix

| Task | [Persona 1] | [Persona 2] | [Persona 3] | ... |
|------|-------------|-------------|-------------|-----|
| ...  | ✓/⚠/✗      | ✓/⚠/✗      | ✓/⚠/✗      | ... |

## Cross-Persona Patterns
- **Universal barriers:** [issues affecting 2+ personas]
- **Friction hotspots:** [steps with clustered difficulty]
- **Emotional patterns:** [where confusion/frustration clusters]

## Findings by Severity

### Critical
- [Persona] cannot [task] because [specific reason] → [Fix]

### Major
- [Persona] struggles with [task] at [step] because [reason] → [Fix]

### Minor
- [Persona] experiences friction at [step] because [reason] → [Fix]

## Comparison: Pre-Fix vs Post-Fix
[If this is a re-test after fixes, show what improved and what didn't]

## Recommendation
[Ship / Fix and re-test / Rethink flow for [persona]]
```

## Integration

- **Runs after:** Fix round (design-builder has addressed critic, accessibility-reviewer, and heuristic-evaluator findings)
- **Runs before:** `verification-before-shipping`
- **Informed by:** `inclusive-personas`, `design-discovery` (brief), `design-state` (all decisions)
- **Feeds into:** `verification-before-shipping` (persona walkthrough evidence), `design-builder` (if fixes needed), `design-debt-tracker` (deferred findings)
- **Complements:** `usability-testing` (which plans tests with real people — synthetic testing validates before real testing begins)

## The Difference from Usability Testing

| | Synthetic User Testing | Usability Testing |
|---|---|---|
| **Who** | AI walks through as each persona | Real people use the interface |
| **When** | After fix round, inside the pipeline | After shipping or during user research |
| **Speed** | Minutes | Days to weeks |
| **Catches** | Predictable barriers, flow breaks, friction | Unexpected behaviour, mental model mismatches, emotional reactions |
| **Misses** | True surprises — things no persona model predicts | Nothing (but expensive and slow) |
| **Value** | Closes the gap between build and validation without leaving the pipeline | Ground truth |

Synthetic testing does not replace real usability testing. It makes real testing more efficient by catching the obvious issues first, so real participants encounter the design at its best — and surface the surprises only humans can find.
