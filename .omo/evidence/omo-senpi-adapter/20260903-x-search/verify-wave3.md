# Wave 3 adversarial verification (todos 13-16)

Verifier: independent child session (`st_01a0662b`). Did not implement any todo. Every worker claim
was treated as false until reproduced locally on `mengmotaHost` (darwin arm64, bun 1.4.0).

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search`
Branch: `feat/omo-senpi-x-search`, HEAD `c6832b89c`.
No product file was edited; no commit was made; no billable API call was issued by this verification.

## Global checks

### Typecheck (once, as scoped)

```
$ bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
tsgo_exit=0
```

Zero diagnostics. No errors in any touched file.

### Dirty worktree (`git status --short`)

```
 M changes.md
 M packages/omo-senpi/AGENTS.md
 M packages/omo-senpi/plugin/AGENTS.md
 M packages/omo-senpi/scripts/qa/x-search-backtest.mjs
 M packages/omo-senpi/src/AGENTS.md
 M packages/senpi-task/AGENTS.md
?? packages/omo-senpi/scripts/qa/x-search-live-e2e.mjs
?? packages/omo-senpi/scripts/qa/x-search-live-e2e.test.mjs
?? packages/omo-senpi/src/components/x-search/AGENTS.md
```

All nine paths map to a wave-3 todo (13/14 own the two live-e2e files; 16 owns the five AGENTS.md +
changes.md). **One is out of scope for its own todo:** `packages/omo-senpi/scripts/qa/x-search-backtest.mjs`
is modified but uncommitted, and its diff adds a `probeGrokLogin()` + `--auth-file` capability that is
**not reflected in the todo-15 report.json** (see todo 15). That is a real dirty-worktree finding:
production QA-harness code changed after the evidence it is supposed to justify was written.

### Secret scan over EV/13, EV/14, EV/15

```
$ rg -il 'authorization|bearer|api[_-]?key|access_token|refresh|eyJ' \
    EV/13-live-root-qa EV/15-backtest ../20260903-x-search-14-live-child
EV/13-live-root-qa/mutation.txt
EV/13-live-root-qa/positive/transcript-positive.txt
EV/13-live-root-qa/reload/transcript-reload.txt
../20260903-x-search-14-live-child/transcript-quick.txt
../20260903-x-search-14-live-child/transcript-librarian.txt
../20260903-x-search-14-live-child/transcript-explore.txt
```

Six hits, **all benign** — verified by extracting context:

- `transcript-*.txt`: the literal string `XAI_API_KEY` appears inside a *fetched X post body*
  ("...with a SuperGrok or X Premium+ account (or XAI_API_KEY)..."), i.e. third-party prose, not a value.
- `mutation.txt`: the test fixture literal `XAI_API_KEY: "must-not-reach-child"`.
- `refresh`/`API_KEY` in explore/librarian: bare words in prose.

Confirmed no real credential: `rg -o '\beyJ[A-Za-z0-9_-]{20,}'` over all three dirs returns **zero**
matches, and the transcripts carry `[REDACTED]` markers from `scrubSecrets`. **Secret scan: clean.**

### Plugin bundle currency

```
$ bun packages/omo-senpi/plugin/scripts/build-extension.mjs --check
omo-senpi extension build is current: .../plugin/extensions/omo.js
check_exit=0
```

## Todo 13 — Live root QA with the real senpi binary

**Unit test reproduced:**

```
$ bun test packages/omo-senpi/scripts/qa/x-search-live-e2e.test.mjs
2 pass / 0 fail / 9 expect() calls
```

**Evidence gate:**

- `red.txt` fails with `error: Cannot find module './x-search-live-e2e.mjs'` — a **module-resolution
  error, not the named assertion**. This is exactly the "red for the wrong reason" class. The
  assertion `expect(JSON.parse(child.stdout)).toEqual({ safe: "kept" })` was never shown failing in RED.
- `mutation.txt` **is** correct: it shows that named assertion failing with the received object
  containing `xai`/`grok` keys, `mutation_exit=1`. So the assertion is proven load-bearing by mutation
  even though RED was structurally invalid.

**Required (a) sub-checks, reproduced from the JSON + transcripts:**

| Requirement | Result |
|---|---|
| negative/positive/reload JSON reports exist | **YES** (`negative.json`, `positive.json`, `reload.json`) |
| negative `envScrubbed` lists `XAI_API_KEY` | **NO** — `envScrubbed: []` in all three reports |
| negative has no x_search / x-search skill | **YES** — 0 `x_search results:`, 0 `skills-conditional`, 0 x_search executions |
| positive: `tool_search` activation on FIRST prompt | **YES** |
| positive: tool result starts `x_search results:` with an x.com URL | **YES** |
| reload: a second successful call | **YES** — exactly 2 `x_search` `tool_execution_end`, 3 registrations |

Reproduced positive activation directly from the transcript:

```
"toolName":"tool_search","result":{...,"text":"Found 1 tool(s) matching \"X posts\". Matched tools are
now active and callable from your NEXT turn:\n\n- x_search — Searches X (Twitter) posts through xAI...
[tool_search:activated:v2] [{\"name\":\"x_search\",...}]
"toolName":"x_search","result":{...,"text":"x_search results: 7\n\n[1] https://x.com/i/status/2095331987955609826...
```

Reload:

```
$ rg -o '"tool_execution_end","toolCallId":"[^"]*","toolName":"x_search"' reload/transcript-reload.txt | wc -l
2
$ rg -c 'x-search registered' reload/transcript-reload.txt   -> 3
$ rg -c '/reload' reload/transcript-reload.txt               -> 3
```

**Defects found (independent of worker claims):**

1. **`envScrubbed: []` — required sub-check not met.** The scrubbing *mechanism* works (I proved it:
   `XAI_API_KEY=dummy GROK_TOKEN=dummy node -e "createScrubbedEnvironment(process.env)"` →
   `[ 'GROK_TOKEN', 'XAI_API_KEY' ]`), but the recorded runs had no `XAI_*`/`GROK_*` in the parent env,
   so the isolation path was **never exercised live**. The report honestly records `[]`; the spec
   requirement is simply unfulfilled.
2. **`toolCalls` is hardcoded, not observed.** In `x-search-live-e2e.mjs:146`,
   `toolCalls: scenario === "negative" ? ["tool_search"] : ["tool_search","x_search"]`. This field is a
   constant per scenario and proves nothing. The underlying claim survives only because I re-derived it
   from the transcript independently.
3. **`skillHasX` regex is half-dead.** Its second alternative
   `toolName["']?\\s*:\s*["']x_search` contains `\\s` inside a regex literal (literal backslash + `s`),
   so it can never match. Verified: `skill.test('"toolName":"x_search"') === false`. The negative
   verdict `noXSearch` therefore rests only on `xSearchCalls === 0` plus the skills-conditional branch.
4. **Negative scenario is weaker than described.** Its transcript shows
   `"toolName":"tool_search","result":{...,"text":"Tool tool_search not found"},"isError":true` — the
   negative run never exercised a working `tool_search`, so it does not demonstrate "tool_search ran and
   found no x_search"; it demonstrates the whole extension was absent. Still a valid gate signal, but
   not the stated one.
5. **Stale-state:** `x-search-live-e2e.mjs` mtime is **16:17**, after every todo-13 artifact
   (positive 15:48, negative 15:56, reload/green 16:11). The driver was edited for todo 14 *after*
   todo 13's evidence was captured. The edit added the `child|librarian|explore` scenarios; the
   negative/positive/reload paths appear unaffected, but the evidence is not byte-traceable to the
   current source.

**Verdict: needs-fix.** The three headline behaviors reproduce from primary transcript data, but a
named sub-check (`envScrubbed` listing `XAI_API_KEY`) is unmet, RED failed for the wrong reason, and
two verdict computations (`toolCalls`, `skillHasX`) are non-evidential.

## Todo 14 — Live child + librarian QA

**Location:** not under this slug. Lives in sibling `.omo/evidence/omo-senpi-adapter/20260903-x-search-14-live-child/`.
README documents the split, so this is disclosed, not hidden.

**Required (b) sub-checks:**

| Requirement | Result |
|---|---|
| `quick.json` exists and contains `x_search results:` | **YES** — `xSearchResults: 1`, transcript-quick has 1 header |
| `librarian.json` exists and contains `x_search results:` | **YES** — `xSearchResults: 1`, transcript-librarian has 1 header |
| `explore.json` does NOT contain `x_search results:` | **YES** — `xSearchResults: 0`, 0 headers in transcript-explore |

```
$ rg -c 'x_search results:' transcript-quick.txt      -> 1
$ rg -c 'x_search results:' transcript-librarian.txt  -> 1
$ rg -c 'x_search results:' transcript-explore.txt    -> (no match)
```

Supporting unit tests reproduced (deps 4 and 5):

```
$ bun test packages/senpi-task/src/runners/in-process/shared-tool-filter.test.ts   -> 5 pass / 0 fail
$ bun test packages/senpi-task/src/agents/builtin/builtin-agents.test.ts           -> 9 pass / 0 fail
```

**Defects found:**

1. **`unit-test.txt` is a misleading_success_output artifact.** It is 28 bytes — literally
   `bun test v1.4.0 (34cbb9a40)\n` and nothing else. **No test file named, no pass/fail counts, no
   results.** Verified by `xxd`. It asserts nothing.
2. **The explore denylist is NOT proven.** The "unavailable" string that `explore.json` keys on
   (`unavailable: true`, `exploreUnavailable: true`) is **scripted into the mock provider**:
   `x-search-live-e2e.mjs:72` makes explore's final childStep the literal text
   `"The x_search tool is unavailable to this child."`. The mock emits that sentence regardless of
   whether `x_search` was actually denied. The parent transcript contains **no child-level
   `tool_execution_end` for `x_search`** at all (only `toolName":"task"`), so there is no observation
   distinguishing "explore was blocked" from "the mock said it was blocked". The predicate
   `/unavailable/i.test(transcript)` matches the harness's own scripted output — circular.
3. **Lane is flaky and the flake is visible in the worker's own file.** `red.txt` records a librarian
   run with `"xSearchResults":0,"verdict":{"positive":false}` while `result` is still `"PASS"`. So the
   librarian lane produced a `x_search results:` header on some runs and not others; only the passing
   run was promoted to `librarian.json`. That is selection of a favorable sample.
4. **`green.txt` names no test file and no counts** — it is a one-line JSON blob
   `{"acceptance":"PASS","quickHeader":1,...}` with no command, no runner output.

**Verdict: needs-fix.** quick and librarian headers reproduce; the explore half of the todo is
unproven (tautological assertion against mock-scripted text), and `unit-test.txt` is an empty
success-looking artifact.

## Todo 15 — Backtest record run, tuning, applying the winner

**Client/CLI tests reproduced:**

```
$ bun test packages/omo-senpi/scripts/qa/x-search-backtest.test.mjs            -> 2 pass / 0 fail
$ bun test packages/omo-senpi/src/components/x-search/client.test.ts           -> 32 pass / 0 fail
$ bun test packages/omo-senpi/src/components/x-search/index.test.ts            -> 9 pass / 0 fail
```

Total 43 pass / 0 fail — matches `green.txt`'s claim.

**Required (c) sub-checks:**

| Requirement | Result |
|---|---|
| report.json has 20 queries | **YES** — `queries.length === 20` |
| 14 calibration / 6 holdout | **YES** — `{ calibration: 14, holdout: 6 }` |
| `cost.within_cap` true | **YES** — `{"cap_usd":6,"spent_usd":0,"within_cap":true}` |
| grok-cli lane status `ok` or `blocked_auth` | **NO** — status is **`error`** on every lane key |
| offline replay byte-equal except timestamp | **YES — independently reproduced** |
| SUMMARY.md states parity verdict honestly | **YES** |

**Byte-equality reproduced myself** (offline, no network, no billing):

```
$ TMP=$(mktemp -d) && cp -R EV/15-backtest/fixtures "$TMP/fixtures"
$ OMO_X_SEARCH_BACKTEST_NO_NETWORK=1 XAI_API_KEY=dummy-offline \
  bun packages/omo-senpi/scripts/qa/x-search-backtest.mjs \
    --queries packages/omo-senpi/scripts/qa/fixtures/x-search-backtest/queries.v1.json \
    --mode offline --variants v1,v2 --carriers fast,reasoning --cap-usd 6 --out "$TMP" --report
exit=0
$ node -e '<strip run.timestamp, compare JSON.stringify>'
byte-equal-modulo-timestamp: true
```

This is the strongest single result in wave 3: the offline replay is deterministic and I regenerated
it independently from the committed fixtures.

**SUMMARY.md honesty — confirmed.** It states plainly:

> Record attempt: incomplete (the mandated live run exceeded the 15-minute execution bound...)
> Parity verdict ... **Not established.** The incomplete record has no final holdout aggregate, so the
> gap cannot be numerically claimed without inventing results.

That matches the data: `aggregate.holdout` is `{jaccard:{mean:null,median:null,n:0}}` and
`aggregate.lanes["grok-cli"]` is `n: 0`. No fabricated parity number. `red.txt` records the
deterministic acceptance FAIL. This is the correct behavior.

**Defects found:**

1. **grok-cli status is `error`, not `ok` or `blocked_auth`.** Required by the task spec, and the
   orchestrator's probe said "not logged in" — which should surface as `blocked_auth`. Every lane key
   (`grok-cli:v1:fast`, `:v1:reasoning`, `:v2:fast`, `:v2:reasoning`, and the rolled-up `grok-cli`)
   carries bare `{"status":"error"}` with **no error message recorded**, so the report cannot even be
   read as "auth-blocked". `report.md` likewise shows `| q01 | grok-cli | error | NA | NA |`.
2. **The `blocked_auth` capability exists but postdates the report.** The uncommitted diff to
   `x-search-backtest.mjs` adds `probeGrokLogin()` which returns `status: "blocked_auth"` on
   `/Sign in|Open this URL/`. `report.json` (mtime 16:04) contains **no `grokProbe` field and the string
   `blocked_auth` appears nowhere** in it — verified programmatically. So the report was generated by an
   older harness than the one now in the tree. **Stale-state confirmed.**
3. **Zero-byte stdout/stderr evidence.** `record.stdout.txt`, `record.stderr.txt`, `offline.stdout.txt`,
   `offline.stderr.txt` are all **0 bytes**, and there is no `exit.txt`. There is no captured exit code
   for either the record attempt or the offline run. (I independently confirmed the CLI legitimately
   writes nothing to stdout, and that offline exits 0 — so the emptiness is not falsified, merely
   uninformative as evidence.)
4. **"Applying the winner" is a no-op by construction.** `tuning.chosen` is `v1:fast` with
   `meanJaccard: 0`, `meanRecall: 0`, selected from `calibration.jaccard.n = 2`. SUMMARY says no client
   default change was made because it already matches. Choosing a winner on an all-zero metric from
   n=2 is not a tuning result; the todo's "tuning and applying the winner" half is vacuous.

**Verdict: needs-fix.** Offline determinism, query split, and cost cap are genuinely proven and
independently reproduced, and the SUMMARY is commendably honest about non-parity. But the required
grok-cli lane status is `error` rather than `ok|blocked_auth`, the report predates the probe code now in
the tree, and tuning/apply is vacuous.

## Todo 16 — Docs, inventory rows, changelog, bundle refresh, full gate

**Required (e) sub-checks, all reproduced:**

| Requirement | Result |
|---|---|
| `EV/README.md` indexes 16 dirs | **YES** — 16 todo-dir `##` headings, 01-13 + 14 (sibling, labeled) + 15-16 |
| `changes.md` has the new entry | **YES** — `## 2026-09-03 — Add the credential-gated x_search tool and skill` at line 1 |
| `x-search/AGENTS.md` exists | **YES** — `packages/omo-senpi/src/components/x-search/AGENTS.md` (5953 bytes) |
| committed bundle current | **YES** — `build-extension.mjs --check` → "build is current", exit 0 |

All named inventory files present:

```
OK packages/omo-senpi/src/components/x-search/AGENTS.md
OK packages/omo-senpi/AGENTS.md
OK packages/omo-senpi/src/AGENTS.md
OK packages/omo-senpi/plugin/AGENTS.md
OK packages/senpi-task/AGENTS.md
OK changes.md
```

`red.txt` and `mutation.txt` correctly and explicitly decline a RED/mutation gate on the grounds that
this is prose/data work and no test pins wording. That is the right call under the repo's own rule
against prose-pinning tests — it is a disclosure, not a gap.

**Defects found:**

1. **"Full gate" is not in this todo's evidence.** `green.txt` §6 defers `bun run test:senpi` and
   `bun test packages/senpi-task` to an orchestrator-owned `16-gate/` directory, which **does not
   exist** anywhere under the slug (confirmed by `find`). The todo title claims "full gate"; the full
   gate is unevidenced here. Scoped out by design, but the todo is not self-contained.
2. **README self-reference risk:** README states HEAD `c6832b89c` and that the docs/bundle commit SHA
   "is not recorded here yet" — accurate, since the doc changes are still uncommitted (`git status`
   shows all five AGENTS.md + changes.md as ` M`). The index describes a state that is not yet in git.

**Verdict: confirmed** for every check the task actually enumerated in (e). The full-gate portion is
explicitly delegated and absent, which I record as a scope note rather than a failure of (e).

## Adversarial class summary

| Class | Found |
|---|---|
| stale_state | **YES** — todo 13 (`x-search-live-e2e.mjs` 16:17 > all todo-13 artifacts); todo 15 (`report.json` predates the `probeGrokLogin`/`blocked_auth` code now in the tree) |
| misleading_success_output | **YES** — todo 14 `unit-test.txt` is a 28-byte bun banner with no test file, no counts, no results; todo 14 `green.txt` names no command; todo 15 has four 0-byte stdout/stderr files and no exit.txt |
| dirty_worktree | **YES** — `packages/omo-senpi/scripts/qa/x-search-backtest.mjs` modified but uncommitted, and its new capability is not represented in the todo-15 evidence it should justify |
| red-for-wrong-reason | **YES** — todo 13 `red.txt` is a module-not-found error, not the named assertion (mutation.txt does cover the assertion) |
| tautological assertion | **YES** — todo 14 explore lane asserts against mock-scripted text |
| fabricated results | **NO** — todo 15 SUMMARY explicitly refuses to claim unproven parity; no invented numbers found anywhere |
| secret leakage | **NO** — scan clean; all pattern hits are third-party prose or test fixtures |
