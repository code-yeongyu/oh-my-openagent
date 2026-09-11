# Adversarial verification - wave1 (x-search)

Verifier: independent senpi-task child (did NOT implement any todo). Every worker claim was
treated as false until reproduced locally. No product file was left modified; two files were
temporarily mutated for kill-checks and byte-restored (verified via `git diff` hash + md5).

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search`
Branch: `feat/omo-senpi-x-search` @ `130a5c516`

## Global checks

### Typecheck (run once, as instructed)
```
$ bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
(no output, exit 0)
```
Zero errors overall, therefore zero errors in the touched files
(`params.ts`, `client.ts`, `format.ts`, `auth.ts`, and their `.test.ts` peers).

### Dirty worktree probe
```
$ git status --short
 M packages/senpi-task/src/agents/builtin/builtin-agents.test.ts
 M packages/senpi-task/src/agents/builtin/librarian.ts
 M packages/senpi-task/src/runners/in-process/shared-tool-filter.test.ts
 M packages/senpi-task/src/runners/in-process/shared-tool-filter.ts
?? packages/omo-senpi/scripts/qa/fixtures/
?? packages/omo-senpi/scripts/qa/x-search-backtest-core.mjs
?? packages/omo-senpi/scripts/qa/x-search-backtest-core.test.mjs
?? packages/omo-senpi/scripts/qa/x-search-backtest-queries.test.mjs
?? packages/omo-senpi/src/components/x-search/
```
Every path maps to exactly one todo (4/5 -> senpi-task; 1/2/3/6 -> components/x-search;
7/8 -> scripts/qa). **No out-of-scope file was touched.** No commits were made by anyone
(`git log` head is the pre-existing merge commit).

### Independent full-file reruns (my own runs, not the workers')
| file | result |
|---|---|
| `components/x-search/params.test.ts` | 6 pass / 0 fail |
| `components/x-search/auth.test.ts` | 7 pass / 0 fail |
| `components/x-search/client.test.ts` | 32 pass / 0 fail (x3 runs, stable) |
| `components/x-search/skill.test.ts` | 3 pass / 0 fail |
| `scripts/qa/x-search-backtest-core.test.mjs` | 6 pass / 0 fail |
| `scripts/qa/x-search-backtest-queries.test.mjs` | 1 pass / 0 fail |
| `senpi-task/.../shared-tool-filter.test.ts` | 5 pass / 0 fail |
| `senpi-task/.../builtin-agents.test.ts` | 9 pass / 0 fail |

### stale_state probe (mtimes)
Source files were modified AFTER the evidence that claims to test them in four cases:

| todo | latest evidence | source mtime | delta |
|---|---|---|---|
| 01-params | mutation.txt 14:17:25 | params.ts 14:17:28 | mutation predates impl by 3s |
| 04-child-exposure | green 14:16:36 / mutation 14:16:49 | shared-tool-filter.ts **14:25:11** | source touched ~8.5 min later |
| 05-librarian | green 14:17:28 / mutation 14:17:51 | librarian.ts **14:25:26** | source touched ~7.5 min later |
| 07-backtest-core | green 14:17:16 | core.mjs 14:17:26 | green predates impl by 10s |

This makes all four green.txt files stale artifacts. Mitigation: I re-ran every test file
against the CURRENT source myself (table above) and re-derived every mutation kill locally,
so the verdicts below rest on my runs, not on the stale evidence.

### misleading_success_output probe
- `01-params/red.txt` and `01-params/mutation.txt` were produced against
  `packages/omo-senpi/src/components/**thread**/params.test.ts` - a different directory from the
  shipped `x-search/params.test.ts`. The green.txt names the right path. The red is also a bare
  `Cannot find module './params'`, i.e. a module-missing failure, NOT the named assertion.
- `06-skill/green.txt`, `06-skill/mutation.txt`, `07-backtest-core/mutation.txt` (tail),
  `08-queries/mutation.txt` are hand-trimmed excerpts rather than raw captures
  (`mutation.txt` for 06 has no `bun test` banner/command line; 07's restore section is truncated
  mid-banner; 08 references a `restored_fixture_and_green.txt` that does not exist on disk).
  All named assertions were re-derived by me, so the substance holds; the artifacts are just
  not raw.
- All other green.txt files name their test file and carry pass/fail counts that match my runs.

### Red-quality summary
Todos 1, 2, 3, 6, 7, 8 have module-missing / ENOENT reds (`Cannot find module './client'`,
`ENOENT ... SKILL.md`, etc.). These are legitimate pre-implementation reds for brand-new files,
but they do NOT show the named assertion failing. Only todos 4 and 5 have true assertion-level
reds against pre-existing code. The assertion-level guarantee for 1/2/3/6/7/8 comes from the
mutation runs, which I reproduced independently.

## Per-todo detail

### 1. COMP/params.ts - TypeBox schema + validateXSearchParams()
Reproduced. `params.ts` uses `typebox` `Type.Object(..., { additionalProperties: false })` with
`Value.Check`, and returns discriminated `{ok:false, code}` rejections for INVALID_FILTERS,
TOO_MANY_HANDLES, INVALID_DATE, INVALID_DATE_RANGE, INVALID_PARAMS. All five codes are asserted.
My own mutation (deleted the `from_date > to_date` guard, run in a scratch copy at
`components/__xsverify__/`) killed exactly the named test:
`(fail) rejects an inverted date range as INVALID_DATE_RANGE`, 5 pass / 1 fail.
Caveat: worker red/mutation were captured under a `components/thread/` path.

### 2. COMP/client.ts + COMP/format.ts
Reproduced. Request builder freezes the bounded envelope (`tool_choice:"required"`,
`max_turns:1`, `parallel_tool_calls:false`, `max_output_tokens:4000`, `store:false`), only sets
filter keys that are present, and carries `reasoning` only for the reasoning carrier. Deadline
handling uses an `AbortController` + `setTimeout` with `clearTimeout` in `finally`; failure
mapping is 401/403 -> AUTH, 429 -> RATE_LIMITED (+retryAfter), 5xx -> UPSTREAM, abort -> TIMEOUT,
non-JSON 200 -> PROTOCOL, each asserted with `calls === 1` (no retry). The timeout test
subscribes to the `abort` event BEFORE the deadline fires - no fixed sleeps, no timing luck;
32/32 stable over 3 consecutive runs. My own mutation (deleted the `url_citation` annotations
pass in a scratch copy at `components/__xsverify2__/`) reproduced the worker's mutation.txt
byte-for-byte in substance: the same 3 normalizer assertions fail, 29 pass / 3 fail.
The worker's NOTES-style disclosure of plan drift (the probe fixture cannot observe the loss;
the annotations-only case can) is accurate - I confirmed the probe-fixture id-count test still
passes under the mutation.

### 3. COMP/auth.ts - resolveXaiBearer()
Reproduced. Stored credential wins and is read through `modelRegistry.getProviderAuth("xai")`;
a throw from the registry fails CLOSED (returns undefined) instead of silently falling back to
env; env `XAI_API_KEY` is used only when nothing is stored, and is trimmed. My own mutation
(replaced `catch { return undefined }` with `catch {}` so a registry throw falls through to env,
scratch copy under /tmp) killed the named test:
`(fail) xAI auth > stored credential failure fails closed`, 6 pass / 1 fail.

### 4. senpi-task shared-tool-filter - x_search direct for children
Reproduced. `CHILD_DIRECT_EXPOSURE_TOOL_NAMES = new Set(["x_search"])`; the filter maps to
`{ ...tool, exposure: "direct" }`, i.e. a COPY. The test asserts non-identity
(`expect(filtered[0]).not.toBe(xSearch)`) AND that the source object still reads `"search"`,
and that `thread_create` is passed through by identity. My own mutation
(`{...tool}` -> `Object.assign(tool, ...)`, i.e. mutate in place) killed the copy assertion at
line 70, 4 pass / 1 fail; file restored and re-verified 5 pass / 0 fail. The worker's red.txt is
a genuine assertion-level red (`Expected: "direct" / Received: "search"`).

### 5. senpi-task librarian - allow x_search and name it in the prompt
Split verdict. The ALLOWLIST half is real and covered: `{ pattern: "x_search", allow: true }` is
in `librarian.ts`, the test pins librarian to 10 rules vs 9 for the other curated agents and
asserts `explore` does NOT get x_search. Removing the rule fails the test
(`Expected length: 10 / Received length: 9`), 8 pass / 1 fail.
The PROMPT half is NOT covered by any check: I deleted the line
"For X/Twitter social signal, call x_search when it is available..." from the prompt and the
suite still reported **9 pass / 0 fail**. Under the "prose is not pinned by tests" rule this is
acceptable by policy, but it means half the todo's deliverable is asserted only by reading the
file - which I did: the line is present at librarian.ts:17. Both files restored.

### 6. COMP/skill/SKILL.md - conditional x-search skill
Reproduced, with a real defect. Machine-consumed checks (`name: x-search`, description
non-empty/<1024 chars/ASCII-only) all pass, and both of my mutations killed their assertion:
`name: x-search -> x_search` fails the name test; inserting a non-ASCII em dash into the
description fails the ASCII test (2 pass / 1 fail each, scratch copy under
`components/__xsverify3__/`). Content is a genuine conditional skill (tool_search gate,
4 rules, operator table, 3-pass recipe, web_search reconciliation, cost note).
**Defect:** the "Backtest pointer" section points at
`packages/omo-senpi/scripts/qa/x-search-backtest.mjs`, which does not exist - the shipped file
is `x-search-backtest-core.mjs`. Dangling pointer in shipped prose.

### 7. Backtest pure core
Reproduced. `x-search-backtest-core.mjs` exports extraction (`extractTweetIds`, recursive,
deduped), metrics (`jaccard`, `recall`, `aggregate` - non-numerics dropped, median handles
even/odd), canonical `fixtureKey` (key-sorted SHA-256, order-independent - asserted), a
fail-closed `estimateUsd` (`"COST_UNKNOWN"`), `costGuard` reserving `PER_CALL_CEILING_USD` 0.25,
`reconcileCost`, `redactSecrets`, `webOverlap`, `validateQuerySet`, `materializeDates`.
Every named export is exercised by an `expect`. My own mutation (dropped `perCallCeilingUsd`
from the `costGuard` inequality) killed the named test:
`(fail) cost guard reserves ceiling and reconciliation marks exceeded`, 5 pass / 1 fail.

### 8. Query set v1
Reproduced with a caveat. `queries.v1.json` ships version 1, carriers `["fast","reasoning"]`,
`cap_usd` 6, exactly 20 queries with ids q01..q20, cohorts 14 calibration / 6 holdout, all
`since_days_ago` integers within [1,30], 5 with `until_days_ago`. `validateQuerySet` returns
true. My own mutation (duplicated an id in a scratch fixture copy) killed the named assertion:
`expect(validateQuerySet(querySet)).toBe(true) -> Received: false`, 0 pass / 1 fail.
Caveats: splits are `train:15 / test:5` - the `validation` split that `validateQuerySet` accepts
is never exercised by the shipped set; only 1 of 20 queries carries `reference_urls`, so the
recall metric in todo 7 has essentially no ground truth to score against in this set. Neither
contradicts the todo as written ("query set v1"), but both limit downstream usefulness.
Also note `08-queries/mutation.txt` names a `restored_fixture_and_green.txt` that is absent.

## Bottom line

8/8 todos reproduce as implemented and test-backed against the current source, verified by my
own runs and my own independently-authored mutations (never the workers' artifacts).
Two todos carry defects that do not invalidate the implementation but should be fixed:
- todo 6: `SKILL.md` cites a non-existent `x-search-backtest.mjs`.
- todo 5: the prompt half of the deliverable has no machine check (acceptable by prose policy,
  but the todo's second clause rests on file reading alone).
Evidence hygiene is the weakest link: 4 stale green/mutation artifacts, 1 pair captured against
the wrong directory (`components/thread/`), 3 hand-trimmed non-raw captures, and 1 referenced
file that does not exist. The code is fine; the paperwork is not trustworthy on its own.
