---
name: inspiration-scouting
description: Use when the team needs aesthetic references, interaction examples, or visual inspiration beyond competitive research — finds design patterns, UI references, and creative approaches that match the brief and taste profile
---

# Inspiration Scouting

The design-scout does competitive research — who else solves this problem and how. Inspiration scouting is different. It finds aesthetic and interaction references that shape the *feel* of the design, even when they come from completely different domains. A banking app can be inspired by a meditation app's calm. A children's education tool can borrow pacing from a well-designed game.

## When to Use

- After design-discovery and design-strategy, before visual design begins
- When the design-lead needs a visual direction and wants reference material
- When the user says "show me some inspiration" or "what could this look like?"
- When the taste profile exists but the project needs a fresh direction within it
- When the team is stuck and needs outside input to break a creative block

## Do Not Use When

- The user has already provided specific visual references — use those directly
- The design system is locked and visual direction is predetermined
- The task is a fix or iteration, not a new direction

## Process

### Step 1: Define the Inspiration Brief

Before searching, define what you're looking for:

```markdown
## Inspiration Brief

**Project:** [Name and one-line description]
**Feel we're going for:** [2-3 adjectives — e.g., "calm, confident, playful"]
**Feel we're avoiding:** [2-3 adjectives — e.g., "clinical, childish, corporate"]
**Taste constraints:** [From taste profile — known preferences and anti-patterns]
**Domain:** [The project's domain — e.g., "pet care", "fintech", "education"]
**Cross-domain openness:** [How far outside the domain to look — same domain / adjacent / anywhere]
**Specific needs:** [e.g., "onboarding flow inspiration", "dashboard layout patterns", "empty state ideas"]
```

### Step 2: Search Across Layers

Inspiration operates at multiple layers. Search each:

#### Visual Layer
- **Colour:** Palette approaches, colour psychology, brand colour usage
- **Typography:** Type pairing, scale, weight distribution, editorial vs UI
- **Layout:** Grid systems, density, whitespace philosophy, asymmetry
- **Imagery:** Photography style, illustration approach, iconography
- **Surface:** Texture, depth, glassmorphism, neumorphism, flat — what's appropriate

#### Interaction Layer
- **Navigation:** Patterns, transitions between views, wayfinding
- **Feedback:** How the interface responds — micro-interactions, loading, success, error
- **Onboarding:** First-run experiences, progressive disclosure, tutorials
- **Data entry:** Form patterns, input methods, validation approaches
- **Empty states:** What the app feels like before there's content

#### Emotional Layer
- **Personality:** How the interface expresses character through details
- **Pacing:** Fast and efficient vs slow and contemplative
- **Trust signals:** How the interface builds confidence
- **Delight moments:** Where and how the interface surprises positively
- **Restraint:** What the interface deliberately does *not* do

### Step 3: Curate a Mood Board

Compile findings into a structured mood board. Quality over quantity — 5 excellent references beat 20 mediocre ones.

For each reference:

```markdown
### [Reference Name]
**Source:** [App/site/product name and what it does]
**Why it's relevant:** [1-2 sentences connecting this to the project brief]
**What to take:** [The specific element or quality to learn from]
**What to leave:** [What doesn't apply — this prevents wholesale copying]
**Taste alignment:** [How it connects to the user's taste profile]
**Layer:** Visual / Interaction / Emotional
```

### Step 4: Cross-Domain Connections

The best inspiration often comes from outside the project's domain. Actively seek cross-domain references:

| Project Domain | Look At |
|---------------|---------|
| Healthcare | Meditation apps (calm), fitness apps (motivation), journaling apps (reflection) |
| Finance | Productivity tools (clarity), weather apps (data viz), news apps (hierarchy) |
| Education | Games (engagement), music apps (progression), social apps (community) |
| E-commerce | Editorial sites (storytelling), gallery apps (browsing), travel apps (discovery) |
| Enterprise | Consumer apps (polish), design tools (power + clarity), documentation sites (wayfinding) |

Don't force connections — but don't limit yourself to competitors either.

### Step 5: Present the Board

Present inspiration to the user and the design-lead as a curated collection:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  INSPIRATION BOARD
  For: [Project Name]
  Feel: [target adjectives]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  VISUAL DIRECTION
  ◆ [Reference 1] — [what to take]
  ◆ [Reference 2] — [what to take]

  INTERACTION PATTERNS
  ◆ [Reference 3] — [what to take]
  ◆ [Reference 4] — [what to take]

  EMOTIONAL TONE
  ◆ [Reference 5] — [what to take]

  CROSS-DOMAIN WILD CARD
  ◆ [Reference 6] — [unexpected connection]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Does any of this resonate? I can dig deeper
  into any direction or find more references.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 6: Refine Based on Response

The user's reaction to inspiration is a powerful taste signal:

| Reaction | What to Do | Taste Signal |
|----------|-----------|--------------|
| "Love that" | Dig deeper into similar references | Strong positive — record in design-memory |
| "Not quite" | Ask what's off — too bold? too safe? wrong tone? | Soft negative — refine search |
| "That but calmer" | The direction is right, the intensity is wrong | Record the adjustment as a taste nuance |
| "None of these" | Go back to Step 1 and redefine the feel | The inspiration brief needs rewriting |
| "Number 3, but for the layout, not the colour" | User is compositing — they see the design in pieces | Record which layers resonate separately |

After refinement, update the inspiration brief with what resonated and pass it to design-lead as part of their brief.

## Integration With Taste Profile

Inspiration is driven by **this project's** direction — the brief and the live taste calibration from `design-taste` — not by the cross-project design record. The `design-memory` record is observational and is **not** used to pre-filter or steer references; doing so would silently apply one project's habits to another. (If the user themselves says "I usually avoid gradients," that's live direction for this project — honour it because they said it now, not because a record predicted it.)

You may still **record** new signals into `design-memory` as observations after the fact (see below) — that's watching, not steering.

## Integration

- **Called by:** `design-discovery` (to set visual direction), `design-strategy` (for positioning references), `using-designpowers` (when user requests inspiration)
- **Calls:** `design-memory` (only to record new observations after the fact — never to read constraints that steer the scouting)
- **Hands off to:** `design-lead` (with curated references as visual brief), `design-strategist` (with emotional/UX references)
- **Pairs with:** `design-memory`, `design-debate` (inspiration can trigger a debate on direction)
- **Updated by:** User reactions — every "love it" or "not for me" is a taste data point

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Dumping 20 references without curation | Overwhelms. 5 excellent references with clear "what to take" beats 20 screenshots |
| Only looking at competitors | Competitors solve the same problem the same way. Cross-domain references unlock fresh approaches |
| Showing inspiration that violates accessibility | A beautiful reference with 2:1 contrast ratios is not inspiration — it's a cautionary tale. Flag accessibility issues in references |
| Copying instead of being inspired | Inspiration means "take the quality, not the pixels." Always specify what to take and what to leave |
| Ignoring this project's stated direction | If the user has said (now) they want a calm, gradient-free look, showing gradient-heavy references wastes their time. Drive from `design-taste`, not from the cross-project record |
| Presenting without "what to take" | A reference without a clear lesson is decoration. Every reference needs a reason |
