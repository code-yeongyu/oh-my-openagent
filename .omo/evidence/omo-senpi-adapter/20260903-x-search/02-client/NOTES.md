# Todo 2 - COMP/client.ts + COMP/format.ts (x_search request builder, fetch, normalizer, formatter)

## WHAT WAS TESTED

Surface driven: `bun test packages/omo-senpi/src/components/x-search/client.test.ts` (single file, Bun runner,
worktree `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search`, branch `feat/omo-senpi-x-search`).

Behavior the suite is meant to prove:

- `buildXSearchRequest(params, {carrier, variant})` emits the bounded envelope for three param combos
  (dates+allowed handles, top mode with no filters, excluded handles + understanding flags on the reasoning
  carrier): `tool_choice: "required"`, `max_turns: 1`, `parallel_tool_calls: false`, `max_output_tokens: 4000`,
  `store: false`, `x_search` tool keys present ONLY when the corresponding param is set, and `reasoning` present
  only for a reasoning carrier.
- Frozen knobs: `DEFAULT_PROMPT_VARIANT === "v1"`, `DEFAULT_CARRIER === "fast"`, `CARRIER_MODELS` exactly as the
  plan pins them, `PROMPT_VARIANTS.v2` is `v1` plus the recency suffix.
- `performXSearch(...)` with an injected fetch: 200 JSON -> `{ok:true, raw}` with `Authorization: Bearer <...>`
  and `content-type: application/json`; 401/403 -> `AUTH`; 429 with `Retry-After: 42` -> `RATE_LIMITED` +
  `retryAfter: 42`; 500/503 -> `UPSTREAM`; caller abort -> `TIMEOUT`; deadline expiry -> `TIMEOUT`; non-JSON 200
  body -> `PROTOCOL`. The AUTH/UPSTREAM cases also assert the fetch was called EXACTLY ONCE (no retry).
- `normalizeXSearchResponse(raw)` on the recorded probe fixture: >= 4 unique tweet ids incl.
  `2095333026204971141`, `queries[0]` contains `since:2026-09-01` and `Latest`, usage
  `{xSearchCalls: 3, costTicks: 262234000}`; with `{maxResults: 2}` exactly two results survive; on the
  fast-carrier fixture the annotation URL form wins over the inline handle URL for the same id; annotations-only
  citations are recovered; top-level `citations` fall back in; a no-post response yields empty results/queries.
- `formatXSearchResult` golden text for two results (header + three-line blocks + `Queries used:`) and for zero
  (`x_search results: 0\n(no matching X posts)`); `formatXSearchError` renders every one of the ten codes as
  `x_search error [CODE]: msg`.

Timing discipline: no sleeps. The deadline test injects a fetch that never resolves and rejects on the
`abort` event, so the assertion is driven by the abort signal itself, not by wall-clock luck.

## WHAT WAS OBSERVED

| Artifact | Result |
|---|---|
| `red.txt` | Pre-implementation run: `error: Cannot find module './client'`, 0 pass / 1 fail, exit=1. |
| `green.txt` | Post-implementation run: 32 pass / 0 fail, 99 expect() calls, exit=0. |
| `typecheck.txt` | `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` reports ZERO diagnostics for `components/x-search` (filtered; other packages' pre-existing output is not this todo's concern). |
| `mutation.txt` | Annotations pass deleted -> 3 fail (fast-fixture id/URL-form assertion, annotations-only id-count assertion, citation-title assertion); restored (diff clean) -> 32 pass / 0 fail, exit=0. |

## WHY IT IS ENOUGH

Every acceptance clause of plan todo 2 has a named assertion in the suite, and the seam the plan calls out
(the `url_citation` annotations pass) is proven load-bearing by the mutation run: removing it breaks the
id-count assertion for annotation-only citations and the URL-form assertion on the recorded fast-carrier
fixture. Fixtures are the real recorded xAI responses (token-masked; `rg -c 'ACCESS'` finds nothing, and no
Authorization header is present in either file), so the normalizer is exercised against real payload shape
rather than a hand-written idealization.

## PLAN DRIFT (recorded honestly)

- The plan's mutation proof says "drop the annotations pass, observe the id-count assertion FAIL" while pointing
  at the PROBE fixture. Both recorded fixtures echo EVERY cited URL inline in the message text (verified
  programmatically: zero annotation-only ids in both files), so the probe id count alone is blind to the loss.
  The mutation proof therefore uses the id-count assertion that genuinely depends on the pass (an
  annotations-only citation payload) plus the fast-fixture URL-form assertion; both fail under mutation.
- Reference `providers/openai-responses.ts:69-108` in the senpi checkout: `normalizeResponsesPayload` actually
  spans lines 59-103; 106-108 is the `openAiResponsesProvider` export. Shape reference still valid.

## WHAT WAS OMITTED

- No package-wide `bun test` and no build were run locally (orchestrator runs those after commit).
- No tokens, headers, or `auth.json` content were printed or persisted; fixtures ship as recorded and masked.
- No production wiring: the tool/component that consumes these functions is todo 9, not this todo.
