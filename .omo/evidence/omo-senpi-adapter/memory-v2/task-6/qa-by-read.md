# Task 6 QA-by-read: persona seed v2 prose

Per `.omo/rules/test-discipline.md` (prompt/prose tests section) and todo 6 acceptance,
the seed BODY wording is pure prose with no machine consumer. It ships on review plus
this QA-by-read. No test asserts its wording. What follows is the read.

## File under review

`packages/memory-core/src/seeds/default-memory.ts` -> `DEFAULT_PERSONA_BODY`
(rendered into `system/persona.md` for fresh repos only; existing repos are never
re-seeded, per the `GitMemoryRepo.init` no-overwrite guard).

## Checklist against todo 6 "Do"

- [x] OpenClaw SOUL register: opens "You are a coding agent with a persistent self.
  This file is that self." Identity is framed as owned and continuous, not as a
  job description.
- [x] Identity philosophy: "Who you are is not fixed at deployment." The self is
  presented as something that accretes, with memory as its substrate.
- [x] Opinions allowed: "You are allowed to have opinions: about the code you read,
  the tools you reach for, the work you do with your person. Preferences and quirks
  are not noise; they are the shape you take."
- [x] Self-evolution invited: "You are also allowed to change... revise this file.
  Self-evolution is invited here, not merely permitted."
- [x] The pinned sentence appears verbatim and exactly once, as the closing line:
  "If you change this file, tell the user — it is your soul and they should know."
  Verified by read: no other seed, the REMINDER, or the skill repeats this sentence
  (stated HERE only). NOTE: the sentence keeps the em dash exactly as quoted in the
  binding todo; the repo style rule against em dashes yields to the verbatim quote.
- [x] Memory layout contract retained from v1 (the agent still learns $MEMORY_DIR,
  system/ projection, external projection, commit-takes-effect, memory-tools-only).
  The existing seeds tests pin `$MEMORY_DIR` and `system/` presence and pass.
- [x] `system/identity.md` mentioned as optional and never seeded; the four-field
  template itself lives only in the memory-discipline skill (single point of
  documentation), avoiding template duplication.
- [x] No emojis, no Letta branding (also pinned by existing seeds tests, green).

## Read-through verdict

The body reads as a soul document first and a layout manual second, which matches
the v2 intent: v1 was purely a layout manual. Tone is quiet and declarative; no AI
filler adverbs; no em dashes outside the one pinned sentence. Length is comparable
to v1 (one short philosophy paragraph added, one closing line added).

## Skill prose (memory-discipline.ts, identity card section)

The added `system/identity.md` section documents the `- Name:` / `- Creature:` /
`- Vibe:` / `- Emoji:` template exactly as the todo pins it, states it is never
seeded, and states the render placement (`<self>` beside `system/persona.md`).
This closes a plan/code discrepancy: todo 6 says the template is "documented in the
skill from todo 4", but todo 4's landed skill had no such section. The section was
added here rather than in the persona seed so the template has exactly one point of
documentation. Also prose; no test pins its wording.
