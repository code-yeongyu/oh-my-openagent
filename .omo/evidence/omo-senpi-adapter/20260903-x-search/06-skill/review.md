# Todo 6 review-by-read: packages/omo-senpi/src/components/x-search/skill/SKILL.md

Date: 2026-09-03. Reviewer: worker st_01a065b6 (self-review, read top to bottom twice).

## Front matter (machine-consumed)

- `name: x-search` (matches the skill-name pinning convention in packages/omo-senpi/skills/AGENTS.md:22, verified at worktree 130a5c516, no drift).
- `description` is the exact string from the plan todo, 475 chars, ASCII only, quoted.
- Shape mirrors senpi builtin/imagegen/skill/SKILL.md:1-4 (`---`, name, description, `---`); the reference file lives at packages/coding-agent/src/core/extensions/builtin/imagegen/skill/SKILL.md in the senpi checkout.

## Body sections vs the todo's list

| Required section | Present | Note |
|---|---|---|
| Which tool | yes | tool_search "X posts" -> next turn; absent = not connected, say so, use web_search |
| The 4 rules | yes | yesterday computed from the current date, never hardcoded; widen to 7 days; handles max 20, allowed/excluded exclusive; latest/recent + since:/from:/filter:; 2-3 split passes |
| Operator cheat sheet | yes | since/until/from/filter:links/-filter:replies/lang plus exact phrase; parameters bind, operators nudge |
| Split-search recipe | yes | handle pass, keyword pass, thread-fetch pass |
| Reading results | yes | URL + summary + Queries used trailer; cite x.com URLs; provenance = X post, not verified fact |
| Tandem with web_search | yes | same query on web_search; web-without-X and X-without-web both called out |
| Cost note | yes | $5/1k calls, one call = one search turn |
| Backtest pointer | yes | packages/omo-senpi/scripts/qa/x-search-backtest.mjs |

## Facts checked against references

- docs.x.ai x-search: server sub-tools (keyword, semantic, user, thread fetch), handle lists exclusive and capped at 20, inclusive dates, $5/1k calls. All reflected.
- Probe fact: server ran x_keyword_search in Latest mode when the query carried `since:`. Reflected in rule 3 as an observation, not a guarantee.
- Example dates in the cheat sheet (2026-09-02 / 2026-09-03) are illustrative table cells; the recipe blocks use `<yesterday>` placeholders and the intro says never hardcode a date.

## Style checks

- No em or en dashes (rg for U+2014/U+2013: none). Whole file is ASCII.
- No AI-slop vocabulary (delve, leverage, utilize, robust, streamline, facilitate, in order to): none.
- Contractions used naturally; sentence length varies.

## Test

- skill.test.ts parses the front matter minimally (fence, key: value, strip quotes) and asserts name === "x-search", 0 < description.length < 1024, description matches /^[\x20-\x7e]*$/. No prose pinning.
