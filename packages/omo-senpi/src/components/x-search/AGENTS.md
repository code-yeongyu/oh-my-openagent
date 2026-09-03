# x-search component

Credential-gated `x_search` tool and conditional skill. Searches X (Twitter) posts through xAI's server-side X tools. There is no `omo.json` key and no disable flag: the only gate is a connected xAI credential.

## Anatomy

| Path | Purpose |
|------|---------|
| `index.ts` | `createXSearchComponent`: load-time gate, `registerTool`, `resources_discover` skill path. `resolveXSearchSkillPath` prefers the packaged copy. |
| `auth.ts` | Sync `hasXaiCredential` (registration) and async `resolveXaiBearer` (per-call, refresh-aware via `modelRegistry`). |
| `params.ts` | TypeBox `XSearchParams` plus `validateXSearchParams` (mutual exclusion, calendar dates, handle cap). |
| `client.ts` | Bounded request envelope, `performXSearch` fetch, `normalizeXSearchResponse`. |
| `format.ts` | Result text, `x_search error [CODE]:` lines, `XSearchErrorCode`. |
| `tool.ts` | `x_search` `ToolDefinition`: catalog copy, execute, `isError` results. |
| `skill/SKILL.md` | Source for the conditional skill (four rules, operators, split-search recipe). |
| `__fixtures__/` | Probe response used by unit tests. |

## Gating

Registration runs at **extension load**, not `session_start`. Senpi builtin extensions (including tool-search) start before package extensions, and `ToolSearchService.beginSession()` snapshots the catalog at session start, so a later register would leave `tool_search` unaware of `x_search` until the next refresh.

`hasXaiCredential({ agentDir, env })` is a synchronous read of `<agentDir>/auth.json`:

- Missing file: `XAI_API_KEY` (trimmed, non-empty) is enough.
- File present: the `xai` entry's `type` must be `oauth` or `api_key`. Invalid JSON, a missing `xai` object, or any other `type` fails closed **even when `XAI_API_KEY` is set**.

On skip, the component logs `x-search skipped: no xAI credential` and registers nothing. On success it registers the tool and contributes the skill path via `pi.on("resources_discover", () => ({ skillPaths: [...] }))`, so a machine without xAI never pays for the skill in the skills index.

`resolveXSearchSkillPath` prefers `plugin/skills-conditional/x-search/SKILL.md` (from the bundled `plugin/extensions/omo.js` URL) and falls back to `./skill/SKILL.md` for source-tree runs. `plugin/scripts/stage-x-search-skill.mjs` copies the source into `skills-conditional/`; that directory is in the plugin `files` list but **must not** join `pi.skills`.

Per-call auth is independent of the load-time gate: `execute` resolves the bearer through `ctx.modelRegistry` (store first, then `XAI_API_KEY`) so a mid-session OAuth refresh is picked up. Do not cache the token at register time.

In-process task children have no `tool_search` builtin. `CHILD_DIRECT_EXPOSURE_TOOL_NAMES` in `packages/senpi-task` remaps `x_search` from `exposure: "search"` to `"direct"` so a child that inherited the parent tool can call it. It is not in `TASK_CHILD_UI_ONLY_TOOL_NAMES` (that list is the memory tools).

## Contract

| Field | Value |
|-------|--------|
| Tool name | `x_search` |
| Label | Search X posts |
| Exposure | `search` (parent); remapped `direct` for in-process children |
| `searchGroup` | `x-search` |
| `searchKeywords` | X posts, tweets, twitter search, xAI live search, what people are saying on X |
| `allowLazyActivation` | `true` |
| `executionMode` | `parallel` (read-only network call) |
| Endpoint | `https://api.x.ai/v1/responses` |
| Default carrier | `grok-4.20-0309-non-reasoning` (`fast`); override with `OMO_X_SEARCH_MODEL` |
| Envelope | `tool_choice: "required"`, `max_turns: 1`, `parallel_tool_calls: false`, `max_output_tokens: 4000`, `store: false` |

Parameters (`additionalProperties: false`):

| Param | Rule |
|-------|------|
| `query` | required string, 1–2000 chars, not blank |
| `from_date` / `to_date` | optional `YYYY-MM-DD`, real calendar dates; `from_date <= to_date` |
| `allowed_x_handles` / `excluded_x_handles` | optional unique arrays, 1–20 handles matching `^[A-Za-z0-9_]{1,15}$`; mutually exclusive |
| `mode` | `latest` (default) or `top` |
| `max_results` | integer 1–30, default 10 |
| `enable_image_understanding` / `enable_video_understanding` | optional bool, default false |

Success text is `x_search results: N` plus `[i] title / URL / Snippet` blocks and a `Queries used:` trailer (the exact server-side queries). Empty: `x_search results: 0\n(no matching X posts)`. Errors set `isError: true` and `details.code`.

## Error codes

| Code | When |
|------|------|
| `INVALID_PARAMS` | not an object, blank query, or TypeBox reject |
| `INVALID_FILTERS` | both handle lists set |
| `TOO_MANY_HANDLES` | more than 20 handles on either list |
| `INVALID_DATE` | `from_date`/`to_date` not a real ISO calendar day |
| `INVALID_DATE_RANGE` | `from_date > to_date` |
| `AUTH` | no bearer at execute time, or HTTP 401/403 |
| `RATE_LIMITED` | HTTP 429 (optional `retryAfter`) |
| `UPSTREAM` | other non-OK HTTP or network throw |
| `TIMEOUT` | abort after 60s (or caller signal) |
| `PROTOCOL` | non-JSON success body |

Error text is always `x_search error [<CODE>]: <message>`.

## Backtest pointer

Query recipes, lane parity, and cost accounting live in `packages/omo-senpi/scripts/qa/x-search-backtest.mjs` (core + query set colocated). Changing a rule in `skill/SKILL.md` means updating that query set so the backtest still measures the recipe. Live harness proof is `packages/omo-senpi/scripts/qa/x-search-live-e2e.mjs`.

## Anti-patterns

- Do not add `omo.json` keys or a disable flag for this component; credential presence is the gate.
- Do not register on `session_start`; tool_search would miss the tool for the first session.
- Do not put `x-search` under `plugin/skills/` or `pi.skills`; that loads the skill on machines with no xAI account.
- Do not log, print, or persist bearer tokens, `auth.json` bodies, or `XAI_API_KEY`.
- Do not cache the bearer at registration; resolve it per call through the live registry.
