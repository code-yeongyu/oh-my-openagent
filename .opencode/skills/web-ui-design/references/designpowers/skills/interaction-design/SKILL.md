---
name: interaction-design
description: Use when designing states, transitions, animations, error handling, loading patterns, feedback, or any behaviour that responds to user action — ensures interactions are perceivable, operable, and inclusive
---

# Interaction Design

Interactions are promises. Every button says "click me and something will happen." Every loading spinner says "wait, it is coming." This skill ensures those promises are kept for everyone, regardless of how they interact with the interface.

## When to Use

- Designing component states (default, hover, active, focus, disabled, error)
- Creating transitions or animations
- Handling errors, empty states, or edge cases
- Designing loading and progress patterns
- Defining feedback mechanisms (success, warning, error confirmations)
- Designing gesture or touch interactions

## Process

### Step 1: Map All States

For every interactive element, define:

| State | Visual | Screen Reader | Keyboard | Touch |
|-------|--------|--------------|----------|-------|
| Default | [appearance] | [announcement] | [behaviour] | [behaviour] |
| Hover | [appearance] | n/a | n/a | n/a |
| Focus | [appearance + focus ring] | [announcement] | [how to reach] | n/a |
| Active/Pressed | [appearance] | [announcement] | [trigger key] | [gesture] |
| Disabled | [appearance, not just greyed] | [announcement + reason] | [skip in tab order?] | [behaviour] |
| Error | [appearance + message] | [announcement + guidance] | [focus moved?] | [behaviour] |
| Loading | [appearance] | [live region update] | [interaction blocked?] | [behaviour] |
| Success | [appearance] | [announcement] | [next focus target] | [behaviour] |

### Step 2: Design Feedback Patterns

Every user action deserves a response. Map the feedback:

**Immediate feedback (< 100ms):**
- Visual state change on interaction (button press, toggle flip)
- Must be perceivable without relying on colour alone

**Short wait feedback (100ms - 1s):**
- Loading indicator or skeleton screen
- ARIA live region announcement: "Loading..."

**Long wait feedback (> 1s):**
- Progress indicator with estimated time or progress percentage
- Ability to cancel or navigate away
- ARIA live region updates at intervals

**Completion feedback:**
- Clear success or error state
- Screen reader announcement of outcome
- Logical next focus target

### Step 3: Error Handling

Errors are not edge cases — they are guaranteed states. Design for them:

1. **Prevention first** — inline validation, clear constraints, sensible defaults
2. **Clear identification** — what went wrong, in plain language
3. **Specific guidance** — what the person should do next
4. **Accessible delivery** — errors announced to screen readers, focus moved to the error, not just a colour change
5. **Recovery path** — preserve user input, allow correction without starting over

Error message format: **[What happened] + [What to do about it]**
- Yes: "That email address is already registered. Try signing in instead, or use a different email."
- No: "Error: invalid input"

### Step 4: Animation and Motion

Animations serve a purpose or they serve nobody:

**When to animate:**
- To show a relationship between elements (a panel sliding in from its trigger)
- To maintain spatial orientation (a page transition showing direction)
- To provide feedback (a subtle bounce on a successful action)

**When NOT to animate:**
- Decoration without function
- Anything that delays the user from completing their task
- Anything that loops indefinitely

**Inclusive motion:**
- Respect `prefers-reduced-motion` — always provide a reduced or no-motion alternative
- Keep durations short: 150-300ms for micro-interactions, 300-500ms for transitions
- Avoid parallax, auto-playing video, flashing content (3 flashes per second maximum per WCAG)
- Provide pause/stop controls for any animation longer than 5 seconds

### Step 5: Gesture and Input Design

If the design includes gesture interactions:
- Every gesture must have a non-gesture alternative (button, keyboard shortcut)
- Swipe actions must be discoverable without trial-and-error
- Drag-and-drop must have a keyboard-accessible alternative
- Touch targets: 44x44px minimum, with adequate spacing between targets

### Step 6: Document the Interaction Spec

For each interaction, document:
- Trigger (what initiates the interaction)
- Behaviour (what happens, step by step)
- States (all states the element passes through)
- Feedback (what the user perceives at each stage)
- Accessibility (screen reader announcements, keyboard behaviour, motion reduction)

## Integration

- **Called by:** `writing-design-plans` (as part of plan execution)
- **Pairs with:** `ui-composition` (visual states), `cognitive-accessibility` (interaction complexity), `accessible-content` (error messages)
- **Reviewed by:** `designpowers-critique`

## Red Flags

| Flag | Response |
|------|----------|
| Component with only default and hover states | Map ALL states including focus, error, loading, disabled |
| Animation without prefers-reduced-motion support | Add motion reduction. This is not optional |
| Error state that only changes colour | Add text, icon, and screen reader announcement |
| Gesture without alternative input method | Add keyboard and/or button alternative |
