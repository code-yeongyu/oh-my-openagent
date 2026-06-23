---
name: verification-before-shipping
description: Use before declaring any design work complete, fixed, or ready — requires running verification and confirming output before making any success claims. Evidence before assertions, always
---

# Verification Before Shipping

Do not say it is done until you have proof. This skill prevents the most common failure mode in design work — declaring completion based on intent rather than evidence.

## The Rule

NEVER claim work is complete, fixed, passing, or ready without running verification and confirming the output. "I believe this works" is not verification. "I ran these checks and here are the results" is.

## When to Use

- Before declaring a design task complete
- Before moving from one phase to the next
- Before handoff to engineering
- Before creating a PR or committing design artefacts
- Any time you are about to say "done"

## Process

### Step 1: Check Against the Plan

If a design plan exists:
- [ ] Every task in the plan is marked complete
- [ ] Every verification criterion in the plan has been met
- [ ] No tasks were skipped or deferred without explicit user approval

### Step 2: Check Against the Brief

Reference the design brief:
- [ ] The stated problem is addressed
- [ ] All identified personas are served
- [ ] Success criteria are met or measurable
- [ ] Nothing in "out of scope" crept into scope (and vice versa)

### Step 3: Accessibility Verification

Run — do not guess:

**If code exists:**
- [ ] Automated accessibility scan (axe-core, Lighthouse, or equivalent) — report results
- [ ] Keyboard navigation test — report results
- [ ] Screen reader test (at minimum, check heading structure and form labels)
- [ ] Zoom to 200% — report results
- [ ] Check prefers-reduced-motion behaviour — report results

**If design artefacts only:**
- [ ] Contrast ratios verified with a tool (not by eye)
- [ ] Touch targets measured (not estimated)
- [ ] Heading hierarchy documented
- [ ] All states designed (not just the happy path)

### Step 4: Content Verification

- [ ] All placeholder text has been replaced with real content
- [ ] Error messages are written (not "TODO")
- [ ] Alt text is present for all images
- [ ] Labels are specific and descriptive

### Step 5: Cross-Reference Personas

For each persona from the inclusive-personas phase:
- [ ] Could [Persona 1] complete the primary task? How?
- [ ] Could [Persona 2] complete the primary task? How?
- [ ] Could [Edge Case Persona] complete the primary task? What barriers remain?

### Step 6: Check Design Debt

Before declaring the project shippable, review the Design Debt Register in `design-state.md`:

- [ ] All Critical and Major items are Resolved (not just Open or Escalated)
- [ ] Any Escalated items have been addressed or consciously Accepted by the user
- [ ] Open Minor items have been reviewed — the user knows what debt ships with this release
- [ ] Accessibility debt items have explicit user acknowledgement if Accepted

### Step 7: Report

Present verification results to the user:

```markdown
## Verification Report: [Feature/Task]

**Date:** [YYYY-MM-DD]

### Plan Completion
[All tasks complete / X tasks remaining]

### Brief Alignment
[Aligned / Gaps identified]

### Accessibility Results
- Automated scan: [Pass/Fail — specific issues]
- Keyboard: [Pass/Fail — specific issues]
- Screen reader: [Pass/Fail — specific issues]
- Zoom: [Pass/Fail — specific issues]
- Motion: [Pass/Fail — specific issues]

### Content Status
[Complete / Gaps identified]

### Persona Walkthrough
[Summary of persona-by-persona evaluation]

### Design Debt Status
- Open items shipping with this release: [count]
- Escalated items: [count] — [resolved/accepted]
- Accessibility debt accepted: [count] — [summary]
- Oldest unresolved: [DD-XXX] from [date]

### Verdict
[Ready to ship / Issues to resolve first]
```

## Integration

- **Called by:** Before any completion claim
- **Follows:** `designpowers-critique`, `design-handoff`
- **Blocks:** Completion claims, PR creation, merge decisions

## The Iron Law

If you cannot produce evidence that the design works for the identified personas — including those at the margins of the ability spectrum — it is not done. Go back and verify.
