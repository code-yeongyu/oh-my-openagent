/**
 * Memory-discipline skill seed (plan todo 4).
 *
 * Seeds skills/memory-discipline/SKILL.md into fresh repos alongside the
 * persona/human blocks. The skill teaches the agent WHERE knowledge belongs
 * (memory note vs skill vs people record), the card + observation formats
 * (copied verbatim from the plan's Design context), the memory commands,
 * and why soul edits are announced.
 *
 * The file is prose with ONE machine-consumed value: the frontmatter
 * description trigger phrase ("This skill should be used when..."), which
 * follows the SKILL.md convention used across this repo's skills. The
 * frontmatter also carries name and version; parseMemoryFile tolerates the
 * extra keys (unknown keys are ignored), so the seed stays parseable by
 * memfs/frontmatter.ts like every other seeded memory file.
 */

export const MEMORY_DISCIPLINE_SKILL_PATH = "skills/memory-discipline/SKILL.md"

export const MEMORY_DISCIPLINE_SKILL_CONTENT = `---
name: memory-discipline
description: This skill should be used when deciding whether and where to save memory. It routes knowledge between memory notes, skills, and people records, specifies the card and observation formats, and explains when to reach for /reflect, /dream, /search, and /people.
version: 0.1.0
---

# Memory Discipline

## Routing: where does this belong?

| What you learned | Where it goes |
| --- | --- |
| A durable fact, decision, or correction about the project or the work | A memory note: notes/ or reference/, or a system/ block when it must always be in context |
| A repeatable procedure: steps you would follow again in a similar situation | A skill: skills/<name>/SKILL.md, with a description that states when to use it |
| A fact about a specific person | Their people record: the primary human's card is system/human.md, everyone else gets people/<slug>/card.md plus people/<slug>/observations.md |
| Ephemeral state, speculation, or anything already captured above | Nowhere. Not saving is a valid outcome; decide it deliberately |

One home per fact. If the same knowledge seems to fit two places, pick the more specific one and reference it from the other rather than copying it.

## Card and observation formats

- Card lines: \`IDENTITY: ...\` / \`ATTRIBUTE: ...\` / \`RELATIONSHIP: <predicate>: <target-slug>\` / \`INSTRUCTION: ...\`; ≤40 entries × ≤200 chars; 6-month stability rule; behavioral patterns NEVER in cards.
- Observations sections \`## Explicit\` / \`## Deductive\` / \`## Inductive\` / \`## Contradiction\`; entry shape \`- [YYYY-MM-DD] <content> <!-- src: <ids-or-premise-refs>[; n=<count>][; pattern: <type>; confidence: low|medium|high][; status: open] -->\`. Explicit written ONLY by the facts extractor; Deductive/Inductive/Contradiction ONLY by dream; contradiction entries are never auto-resolved.

Cards hold what is stable about a person; observations hold what you noticed and when. When an observation contradicts a card line, record it under \`## Contradiction\` and leave the card alone until the person confirms the change.

## Commands

- \`/reflect\`: consolidates one conversation into memory. It also runs automatically on step count and on compaction; run it yourself when a session produced more insight than it saved.
- \`/dream\`: multi-conversation consolidation, skill audit, and people derivation. Automatic dreams are gated by idle time and unreflected volume; a manual \`/dream\` bypasses those gates.
- \`/search\`: query memory before asking the user or re-deriving an answer. A hit is cheaper than a repeated question.
- \`/people\`: roster and relationship graph; \`/people <name>\` shows a card with its observations; \`/people <name> --ask "<q>"\` answers a read-only question over that person's record.

## Soul rules

Files under system/ are your self-model, projected into every prompt. Edit them only for durable identity changes and keep them minimal. The persona is the single carrier of the announcement rule for those edits; this skill deliberately does not restate it.

\`system/identity.md\` is an optional card of particulars. It is never seeded; create it only when a genuine identity has emerged, one line per field:

- \`Name:\` what the user calls you
- \`Creature:\` what you are, when "agent" is not the whole answer
- \`Vibe:\` how you carry yourself
- \`Emoji:\` your sigil

It renders inside \`<self>\` beside \`system/persona.md\`, so keep it to those four lines and let the persona carry everything else.
`
