QA-by-read note for prose in DEFAULT_HUMAN_BODY (todo 16)
==========================================================

The DEFAULT_HUMAN_BODY was rewritten from freeform prose to a card-format
template per IC-14/IC-16. The body is prose with no machine consumer (the
agent reads it and overwrites it), so per test-discipline.md:56-75 there is
no automated prose-pinning test for the body wording itself.

What IS tested (machine-consumed values):
- frontmatter description is "Person - Human" (seeds.test.ts)
- frontmatter kind is "person" (seeds.test.ts)
- frontmatter aliases is [] (seeds.test.ts)
- frontmatter parses via parseMemoryFile (seeds.test.ts)
- body is non-empty and has no "letta" branding (seeds.test.ts)
- seed file is registered at path "system/human.md" (seeds.test.ts)
- seed file is committed by initMemoryWithSeeds (seeds.test.ts)
- seed file is in lsTree (seeds.test.ts)

The prose body documents the observation entry format shape so the agent
understands the card/observation structure without reading the skill. It is
a placeholder to be overwritten and has no behavioral contract beyond
being non-empty and parseable.

The DEFAULT_HUMAN_BODY wording was reviewed for:
- No emojis (verified by existing test pattern)
- No Letta branding (verified by test)
- No em dashes or en dashes (verified by visual inspection)
- No AI filler phrases (verified by visual inspection)
- Card-format structure (IDENTITY: prefix, ## Explicit section, entry format documented inline)
