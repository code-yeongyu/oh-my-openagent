# Task 19 - Palace people-graph panel: QA by read

Machine gate: `bun test packages/omo-senpi/src/components/memory/palace` (31 pass, 0 fail).
Typecheck: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` exit 0 (typecheck.txt).

## Artefact inspected
`palace.html` in this directory is a real generator output for the people fixture
(3 cards: system/human.md, people/jane-doe/card.md, people/sam-rivers/card.md).

Machine-consumed values verified in that artefact:
- tabs present: core, external, history, reflection, people (each has a matching `id="panel-<tab>"`).
- inline payload `people.nodes`: human, jane-doe, sam-rivers with kind + aliases from card frontmatter.
- inline payload `people.edges`: 4 edges derived from the 4 `RELATIONSHIP:` card lines,
  the dangling `unknown-person` target carrying no `targetSlug`.
- ATTRIBUTE lines produce no edges; the graph is derived per read and never stored.

## Security constraints preserved
- No external asset references (`http://`, `https://`, `@import`, `<link>`) - existing generator
  assertion still green with the new panel markup and CSS.
- Inline JSON hardening unchanged: a `</script><img ...>` payload inside a people card is escaped
  in the document and round-trips through the parsed payload (people.test.ts injection case).
- Viewer file stays 0600 inside a 0700 directory (existing generator assertion).

## Design system
Every new rule in the people panel CSS references an existing token (`--border`, `--radius`,
`--space-*`, `--surface`, `--panel`, `--text*`, `--accent`). No new colors, no magic spacing.
Relative `letter-spacing` matches the file's existing `.tab` / `.header h1` idiom.

## Visual spot check
No DOM harness exists in this repo (no jsdom/happy-dom dependency), so the panel render path was
verified by read plus the structural assertions above, consistent with how the other palace panels
are covered.
