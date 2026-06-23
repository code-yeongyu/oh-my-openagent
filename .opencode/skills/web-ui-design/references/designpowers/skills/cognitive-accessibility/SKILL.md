---
name: cognitive-accessibility
description: Use when evaluating mental load, wayfinding, focus management, memory demands, or decision complexity in any interface — ensures designs work for people with cognitive differences, under stress, or managing divided attention
---

# Cognitive Accessibility

The hardest accessibility barriers to see are cognitive ones. A screen reader user encounters a missing label and knows immediately. A person with a processing difference encounters an interface that demands too much of their working memory and just... leaves. This skill makes cognitive demands visible and manageable.

## When to Use

- Designing multi-step processes or forms
- Creating navigation structures or information architecture
- Evaluating whether an interface asks too much of the user
- Designing for contexts of stress, distraction, or time pressure
- Reviewing any interface for cognitive load

## Process

### Step 1: Assess Cognitive Load

For each screen or flow, evaluate three types of load:

**Intrinsic load** — complexity inherent to the task
- How many concepts must the user understand simultaneously?
- How many decisions must they make per screen?
- Can the task be simplified without losing essential function?

**Extraneous load** — complexity added by poor design
- Is information organised logically or scattered?
- Are instructions clear and visible, or must the user remember them?
- Is the interface consistent, or do similar things work differently in different places?

**Germane load** — effort spent learning the system
- Can the user build a mental model from the interface structure?
- Are patterns consistent so that learning one part teaches the next?
- Does the interface reward exploration or punish mistakes?

### Step 2: Reduce Extraneous Load

Extraneous load is design debt. Reduce it:

- **Show, do not ask people to remember.** If a user needs information from Step 2 in Step 5, display it — do not expect them to recall it
- **Progressive disclosure.** Show only what is needed now. Reveal complexity as it becomes relevant
- **Consistent patterns.** Same action, same appearance, same location, every time
- **Clear defaults.** Sensible pre-selections reduce decisions. Make the safe choice the easy choice
- **Chunking.** Break long forms into sections of 3-5 related fields. Break long content into scannable sections

### Step 3: Wayfinding

People need to know three things at all times:
1. **Where am I?** (clear page titles, breadcrumbs, highlighted navigation)
2. **Where can I go?** (visible navigation, clear calls to action)
3. **Where have I been?** (visited link styles, progress indicators, history)

For multi-step processes:
- Show progress (step 3 of 5)
- Allow backward navigation without data loss
- Show a summary of previous steps' inputs
- Allow saving progress and returning later

### Step 4: Focus Management

Attention is a limited resource. Protect it:

- **One primary action per screen.** If everything is important, nothing is
- **Visual hierarchy guides attention.** The most important element should be the most visually prominent
- **Minimise interruptions.** Notifications, pop-ups, and auto-updates break concentration
- **Support return from interruption.** If the user is interrupted, the interface should help them resume where they left off
- **Timed actions are hostile.** If a timeout is necessary, warn before it expires and allow extension

### Step 5: Error Recovery

Cognitive accessibility means mistakes are cheap:

- **Undo everything.** Every action should be reversible
- **Confirm destructive actions.** "Delete all items?" with a clear way to cancel
- **Preserve input.** If a form submission fails, do not clear the fields
- **Forgive formatting.** Accept phone numbers with or without dashes, dates in multiple formats
- **Provide clear recovery paths.** After an error, the next step should be obvious

### Step 6: Document Cognitive Considerations

For each screen or flow, note:
- **Decisions required:** how many, how complex
- **Memory demands:** what the user must remember vs. what is displayed
- **Wayfinding cues:** how the user knows where they are
- **Recovery paths:** how the user corrects mistakes
- **Simplification opportunities:** what could be removed or deferred

## Integration

- **Called by:** Any design skill, especially `ui-composition` and `interaction-design`
- **Pairs with:** `accessible-content` (language complexity), `adaptive-interfaces` (personalisation), `inclusive-personas` (cognitive diversity)
- **Reviewed by:** `designpowers-critique`

## Quick Reference: COGA Guidelines

| Guideline | Implementation |
|-----------|---------------|
| Provide help and support | Contextual help adjacent to complex interactions |
| Use clear language | Plain language, no jargon, short sentences |
| Make it easy to find things | Consistent navigation, clear labels, search |
| Make tasks easy to complete | Fewer steps, clear progress, forgiving input |
| Avoid reliance on memory | Display information rather than requiring recall |
| Provide feedback | Clear confirmation of actions and state changes |
| Prevent and support error correction | Validation, undo, confirmation for destructive actions |
