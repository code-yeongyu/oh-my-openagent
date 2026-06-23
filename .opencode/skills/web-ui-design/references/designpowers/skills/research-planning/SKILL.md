---
name: research-planning
description: Use when user needs are unclear, assumptions need validation, or the design brief identifies gaps in understanding — plans what to learn, which methods to use, and from whom
---

# Research Planning

Research is how we replace assumptions with evidence. This skill structures what you need to learn before committing to a design direction.

## When to Use

- The design brief identifies unknowns about users, context, or behaviour
- The team is making decisions based on assumptions rather than evidence
- A design is being created for a new audience or unfamiliar context
- Stakeholders disagree about user needs

## Process

### Step 1: Identify Knowledge Gaps

Review the design brief and list:
- What do we **know** about the people who will use this? (Evidence-backed)
- What do we **assume**? (Believed but unverified)
- What do we **not know**? (Acknowledged gaps)

Present this to the user. Assumptions and unknowns become research questions.

### Step 2: Frame Research Questions

Convert gaps into answerable questions. Good research questions are:
- **Specific** — "How do users with screen readers navigate multi-step forms?" not "Is the form accessible?"
- **Observable** — focused on behaviour, not opinion
- **Actionable** — the answer will change a design decision

Aim for 3-5 research questions. More than that means you need to narrow scope.

### Step 3: Select Methods

Match methods to questions:

| Question Type | Recommended Methods |
|--------------|-------------------|
| "What do people currently do?" | Journey mapping, diary studies, contextual inquiry |
| "Why do people struggle with X?" | Usability testing, think-aloud protocols |
| "What do people need?" | Interviews, jobs-to-be-done analysis |
| "Which approach works better?" | A/B testing, preference testing, card sorting |
| "How does our offering compare?" | Competitive analysis, heuristic evaluation |
| "Who are we designing for?" | Persona development, ability spectrum mapping |

### Step 4: Plan for Inclusion

Every research plan must address:
- **Participant diversity** — include people with disabilities, different ages, different technical literacy, different languages
- **Method accessibility** — ensure research methods themselves are accessible (e.g., interview formats that work for people with communication differences)
- **Situational contexts** — include scenarios of stress, distraction, low bandwidth, unfamiliar environments

### Step 5: Write the Research Plan

```markdown
# Research Plan: [Topic]

## Research Questions
1. [Question]
2. [Question]
3. [Question]

## Methods
| Method | Questions Addressed | Participants | Timeline |
|--------|-------------------|-------------|----------|
| [Method] | Q1, Q2 | [Who and how many] | [When] |

## Inclusion Considerations
[How participant diversity and method accessibility will be ensured]

## Expected Outputs
[What deliverables this research will produce — personas, journey maps, findings report]

## Decision Points
[Which design decisions this research will inform]
```

Save to: `docs/designpowers/research/YYYY-MM-DD-<topic>-plan.md`

### Step 6: User Review

Present the plan. Confirm scope, methods, and timeline are realistic.

## Integration

- **Called by:** `design-discovery`
- **Calls:** `inclusive-personas` (when persona development is a research output)
- **Pairs with:** `design-strategy` (research informs strategy)

## What This Skill Does NOT Do

This skill plans research — it does not execute it. Execution happens with real people in the real world. The plan ensures that when research happens, it is structured, inclusive, and actionable.
