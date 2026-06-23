---
name: inclusive-personas
description: Use when defining who a design serves — creating personas, user stories, or scenarios — ensures the full ability spectrum and situational contexts are represented from the start, not retrofitted
---

# Inclusive Personas

Personas shape every design decision that follows. If your personas only represent able-bodied, neurotypical, tech-savvy adults with fast internet, your design will only work for those people. This skill ensures the full range of human experience is represented from the beginning.

## The Principle

"Nothing About Us Without Us." Design for the margins and the centre benefits. Design for the centre and the margins get excluded.

## Process

### Step 1: Map the Ability Spectrum

For the design context, identify the relevant spectrum across:

**Permanent conditions:**
- Vision: blind, low vision, colour blind
- Hearing: deaf, hard of hearing
- Motor: limited fine motor, limited reach, tremor, paralysis
- Cognitive: learning differences, memory challenges, attention differences
- Speech: non-verbal, speech differences

**Temporary conditions:**
- Broken arm, ear infection, concussion, medication effects, post-surgery

**Situational conditions:**
- Bright sunlight, noisy environment, one hand occupied, driving, multitasking, emotional distress, unfamiliar language, slow connection

### Step 2: Identify Relevant Personas

Not every project needs every persona. Select 4-6 personas that represent:
- **2-3 primary users** — the most common use cases
- **1-2 edge case users** — people at the margins whose needs reveal design weaknesses
- **1 stress case user** — someone using the design under difficult circumstances

### Step 3: Build Each Persona

For each persona, document:

```markdown
## [Name]

**Context:** [Who they are, what they do, their relationship to this product]

**Abilities and conditions:** [Permanent, temporary, or situational factors that affect how they interact with interfaces]

**Technology:** [Devices, assistive technology, connection speed, technical confidence]

**Goals:** [What they need to accomplish]

**Frustrations:** [What typically goes wrong for them with similar products]

**Environment:** [Where and when they use this — lighting, noise, distractions, time pressure]
```

### Step 4: Write Inclusive User Stories

For each persona, write stories that capture:
- The standard path: "As [persona], I want to [goal] so that [outcome]"
- The assisted path: "As [persona] using [assistive technology], I want to [goal] so that [outcome]"
- The stress path: "As [persona] under [stressful condition], I need to [goal] without [negative outcome]"

### Step 5: Identify Scenario Intersections

Map where personas overlap in unexpected ways:
- A sighted user in bright sunlight has similar needs to a low-vision user
- A stressed parent holding a baby has similar motor constraints to someone with limited hand mobility
- A non-native speaker has similar needs to someone with a cognitive processing difference

These intersections reveal universal design opportunities.

### Step 6: Present and Validate

Present personas to the user. Ask:
- Who is missing from this set?
- Do these feel like real people or cardboard cutouts?
- Which persona makes you most uncomfortable? (That one probably needs the most attention)

Save to: `docs/designpowers/personas/YYYY-MM-DD-<project>-personas.md`

## Integration

- **Called by:** `research-planning`, `design-discovery`
- **Informs:** Every subsequent design skill — personas should be referenced when making any design decision
- **Pairs with:** `cognitive-accessibility`, `adaptive-interfaces`

## Anti-Patterns

| Pattern | Problem |
|---------|---------|
| "Our users are everyone" | If everyone is your user, nobody is. Define specific people |
| Personas without disabilities | You have excluded a quarter of the population |
| Edge cases treated as afterthoughts | Edge cases reveal the quality of your design. They come first, not last |
| Personas based on demographics alone | Age and job title do not determine how someone uses an interface. Focus on behaviour, ability, and context |
