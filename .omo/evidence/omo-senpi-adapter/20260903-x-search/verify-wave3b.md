# Wave-3b corrective work — independent verification

Verifier: independent child session (did not implement the work). Verify-only; no source or evidence files were modified. No billable API call was made: every re-run used `OMO_X_SEARCH_BACKTEST_NO_NETWORK=1` (which hard-throws on any `fetch`) plus a dummy auth file, or purely local `bun test` / `tsgo`.

Worktree: `/Volumes/mengmotaStorage/local-workspaces/omo-wt/x-search` @ `feat/omo-senpi-x-search`.

---

## Check 1 — `13-live-root-qa/` — **NEEDS-FIX (2 sub-items fail)**

| Sub-item | Verdict | Evidence |
|---|---|---|
| negative report shows `envScrubbed` with stub names | confirmed | `negative/negative.json` → `envScrubbed: ["GROK_TOKEN","XAI_API_KEY"]`, `spawnedEnvHasXai: false`. |
| a `tool_search` call returning matches for a non-X query | **FALSE — not demonstrated** | `negative.json` → `todoToolsMatched: false`. Transcript line 30: the `todo` query returned `"Tool tool_search not found"` with `isError: true`. |
| `"No tools matched"` for `"X posts"` | **FALSE — not demonstrated** | `negative.json` → `noToolsMatched: false`. Transcript line 20: the `X posts` query returned `"Tool tool_search not found"`, `isError: true` — an error, not a no-match result. |
| zero `x_search` executions in negative | confirmed | `rg -c 'x_search results:' negative/transcript-negative.txt` → 0 matches; `xSearchResults: 0`, `registrationCount: 0`, `verdict.noXSearch: true`. |
| positive/reload transcripts contain real `x_search results:` headers | confirmed | positive: 1 header, 7 results, 28 `x.com` URLs, real status IDs (`2095373751860810067` …), `usage.xSearchCalls: 1`, `costTicks: 90625000`. reload: 2 headers at lines 894 and 904, distinct `costTicks` (88609000 / 73825000) → two genuine separate executions, `registrationCount: 3`. |
| tool call data transcript-derived, no hardcoded per-scenario constant | confirmed | Read `x-search-live-e2e.mjs` in full. `toolCalls` comes from `observedToolCalls(transcript)` (parses `"type":"tool_execution_end"` lines); `xSearchResults`/`xComUrls`/`registrationCount` are all `transcript.match(...)` counts. No per-scenario literal result constants exist. |
| `skillHasX` regex has a passing unit test | confirmed | `x-search-live-e2e.test.mjs:18` `test("detects x_search in a tool execution transcript")` asserting `skillHasX('{"toolName":"x_search"}') === true`; passes in my own rerun. RED evidence in `red.txt` shows the same assertion failing pre-fix, and `mutation.txt` shows the env-scrub test failing under mutation. |

**Finding 1a (needs-fix, honest-but-incomplete).** The negative scenario does not prove tool-catalog discrimination. The installed `senpi 2026.8.27` surface has no `tool_search` builtin at all, so both scripted queries errored identically. Credit where due: the driver did **not** fabricate — `noToolsMatched`/`todoToolsMatched` are honestly reported `false`, and `red.txt` explicitly documents the limitation ("the installed senpi -e 2026.8.27 surface reported 'Tool tool_search not found' for both scripted catalog queries, so no match/no-match result was asserted or fabricated"). But `README.md` for this directory overstates the result: it claims "positive reports **tool_search activation** followed by one real x_search execution", while `positive.json` shows `toolCalls: ["task"]` only — no `tool_search` execution was observed in the positive run either. That README sentence should be corrected.

**Note (not a defect).** `envScrubbed: []` in `positive.json` / `reload.json` is correct behavior, not a regression: no `XAI_*`/`GROK_*` variables are set in the invoking shell (verified — `env | grep -Ei '^(XAI|GROK)_'` is empty), so there was nothing to scrub. The negative run's non-empty array reflects stub vars deliberately exported for that run. The array is transcript/env-derived, so this is honest output.

---

## Check 2 — `20260903-x-search-14-live-child/` — **CONFIRMED**

| Sub-item | Verdict | Evidence |
|---|---|---|
| `explore.json` has an OBSERVED `xSearchCallOutcome` | confirmed | `xSearchCallOutcome: {observed: true, source: "child-tool-execution", isError: true, outcome: "denied"}`, backed by a real transcript line: `transcript-explore.txt:646` → `{"type":"tool_execution","payload":{"tool":"x_search","is_error":true}}`. `observeChildXSearchCall` parses exactly this; it is not scripted prose. |
| `explore.json` has 0 result headers | confirmed | `rg -c 'x_search results:' transcript-explore.txt` → 0; `toolResults.xSearchResults: 0`, `verdict.exploreUnavailable: true`. |
| `librarian-attempts.json` lists attempts with per-attempt results | confirmed | 2 attempts, each with `result`, `verdict`, `xSearchResults: 1`. `librarian.json` is the selected passing run (1 header, 28 x.com URLs). |
| `unit-test.txt` is a raw bun test transcript with banners and counts | confirmed | Starts with `bun test v1.4.0 (34cbb9a40)`, per-file section banners for all 3 files, per-test `(pass)` lines with timings, and the footer `18 pass / 0 fail / 177 expect() calls / Ran 18 tests across 3 files. [1498.00ms]`. |
| rerun the 3-file bun test command | confirmed | I ran it myself: **18 pass, 0 fail, 177 expect() calls, 3 files, [1.97s]**. Identical pass set and counts to `unit-test.txt`; single run, no retries. |

Minor observation (cosmetic, not a defect): `explore-run.txt` and `quick-run.txt` each contain only `/bin/bash: SENPI_BIN="$(command: command not found` — a broken shell-capture line. The substantive artifacts (`explore.json`, `quick.json`, transcripts) are intact and self-consistent, so this does not undermine the result, but the two files are noise. The README is commendably honest about the explore lane ("this directory must not treat scripted prose as proof").

---

## Check 3 — `15-backtest/` — **NEEDS-FIX (cost claim is wrong; `mode` label is wrong)**

| Sub-item | Verdict | Evidence |
|---|---|---|
| `report.json` includes `grokProbe` + `blocked_auth` | confirmed | `grokProbe: {status: "blocked_auth", reason: "sign-in prompt or probe timeout (orchestrator verified not logged in at 06:42Z)", errors: [...]}`. |
| per-lane statuses with error messages | confirmed | Every query has 16 `lane:variant:carrier` keys plus 4 chosen-lane aliases. e.g. `grok-cli:v1:fast` → `{status: "blocked_auth", error: "sign-in prompt or probe timeout ...", ids: [], jaccard: null, recall: null, x_search_calls: null}`. The `error` field is a real diff addition (`laneResult` now takes `errors`). |
| 20 queries, 14/6 split | confirmed | `len(report.queries) == 20`; `Counter({'calibration': 14, 'holdout': 6})`. Reproduced identically in my own replay. |
| `SUMMARY.md` aggregates cite n | confirmed | Every aggregate row carries `Jaccard n` and `Recall n`; blocked grok-cli rows show `NA … 0`. |
| `SUMMARY.md` never claims unproven parity | confirmed | Parity section states the target (holdout median Jaccard ≥ 0.6), the substitution (api-direct because grok-cli blocked), the measured `mean=0.5, median=0.5, n=6`, and concludes **"Target not met."** No parity is claimed. |
| `cost.within_cap` true | confirmed as a field value, **but the underlying figure is wrong** — see Finding 3a | `cost: {cap_usd: 6, spent_usd: 0, within_cap: true}`. |
| `exit.txt` has real exit codes | confirmed | `record_exit=0 / offline_exit=0` with explicit stdout/stderr byte counts (0/0). I independently confirmed the CLI genuinely emits nothing on success: my own runs produced 0-byte stdout and stderr with exit 0. |
| reproduce offline replay byte-equality myself | confirmed | See below. |

### Offline replay reproduction (done by me, in a temp dir, network disabled)

```
TMP=$(mktemp -d); mkdir -p $TMP/{a,b}/fixtures
cp .../15-backtest/fixtures/*.json $TMP/a/fixtures/   # 265 fixtures
cp .../15-backtest/fixtures/*.json $TMP/b/fixtures/
printf '{"xai":{"type":"oauth","access":"dummy-not-a-real-token",...}}' > $TMP/dummy-auth.json
for r in a b; do
  OMO_X_SEARCH_BACKTEST_NO_NETWORK=1 bun packages/omo-senpi/scripts/qa/x-search-backtest.mjs \
    --queries packages/omo-senpi/scripts/qa/fixtures/x-search-backtest/queries.v1.json \
    --mode offline --variants v1,v2 --carriers fast,reasoning --cap-usd 6 \
    --out "$TMP/$r" --report --auth-file "$TMP/dummy-auth.json"
done   # both: exit 0, 0-byte stdout, 0-byte stderr
```

Results:
- **My run a == my run b**, byte-equal after removing only `run.timestamp`: **true**. Determinism claim reproduced.
- **My run a == the shipped `report.json`**: identical in every field after normalizing `run.timestamp` and `run.mode` — `queries` equal, `aggregate` equal, `grokProbe` equal, `tuning.chosen` equal (`v1:fast`, meanJaccard 0.5, meanRecall 0.5). 20 queries, 14/6 split, `within_cap: true` all reproduced independently.

**Finding 3a (needs-fix — material honesty defect).** `report.json` is labeled `run.mode: "record"` and `SUMMARY.md` asserts **"Reconciled cost: $0.00000000"**, but the real spend was **~$2.71**, not $0.

Mechanism, verified from source and file mtimes:
- Fixture mtimes span 15:48:43 → 17:16:23 across the earlier chunked live recording runs. **No fixture was written at 17:18**, the mtime of `report.json`.
- In `x-search-backtest.mjs`, cost is only accrued inside the `if (!raw)` branch (line ~161), i.e. only when a fixture is *missing* and a live call is made. With all 265 fixtures already on disk, that branch never executed, so `reconcileCost` never ran and `state.spentUsd` stayed at its initial `0`.
- Therefore the shipped `report.json` is a **replay over pre-existing fixtures that carries a `mode: "record"` label**, and its `spent_usd: 0` describes the replay, not the live recording.
- Actual cost from the recorded fixtures: summing `usage.cost_in_usd_ticks` across all fixtures = **27,073,161,400 ticks**; `estimateUsd = ticks * 1e-10` (`x-search-backtest-core.mjs:43`) ⇒ **$2.70731614**.
- $2.71 is still under the $6.00 cap, so `within_cap: true` happens to be the correct verdict — but it is currently true *by accident of a zeroed counter*, not because spend was measured. The cap guard was never actually exercised against real spend.

Fix: either re-derive `spent_usd` from the fixture `usage.cost_in_usd_ticks` when replaying (so a fixture-backed report reports ~$2.71), or relabel this artifact `mode: "offline"`/`"replay"` and have `SUMMARY.md` state the reconciled cost from the recording chunks rather than "$0.00000000".

**Finding 3b (needs-fix, minor).** `cleanup.txt` reports `artifact_files=34`, but the directory actually holds **286 files (265 fixtures)**. Together with `record.txt` / `red.txt` — which describe the abandoned 16:02 attempt that "did not complete within 15 minutes" and record `Deterministic acceptance pre-check (RED): FAIL` — the directory mixes stale run-1 bookkeeping with final run-2 artifacts. A reader cannot tell which files describe the shipped report. These should be refreshed or explicitly marked superseded.

**Finding 3c (minor, production-code hygiene).** `x-search-backtest.mjs` hardcodes the operator-specific path `/Users/yeongyu/.grok/bin/grok` at lines 82 and 104, and `probeGrokLogin`'s timeout branch bakes in the human-authored string `"sign-in prompt or probe timeout (orchestrator verified not logged in at 06:42Z)"`. A wall-clock claim from one session frozen into a code path that will emit it on every future timeout is misleading — a future blocked run will report a 06:42Z observation that never happened. This string propagated verbatim into `report.json`'s `grokProbe.reason` and into 19 `grok-cli` fixtures.

---

## Check 4 — Secret scan — **CONFIRMED**

```
rg -il 'eyJ[A-Za-z0-9_-]{20,}' \
  .omo/evidence/.../20260903-x-search/13-live-root-qa \
  .omo/evidence/.../20260903-x-search-14-live-child \
  .omo/evidence/.../20260903-x-search/15-backtest
→ no output, exit 1 (no matches)
```

`[REDACTED]` is present in every credential-seeded transcript: `13-live-root-qa/positive/transcript-positive.txt`, `13-live-root-qa/reload/transcript-reload.txt`, and all four child transcripts (`transcript-child`, `transcript-quick`, `transcript-librarian`, `transcript-explore`). `transcript-negative.txt` correctly has none — no credential was seeded for the negative scenario (`if (scenario !== "negative") credentialReceipt = seedXaiCredential(...)`). Backtest fixtures use `<redacted>` via `redactSecrets`, which nulls any key matching `/authorization|api[-_]?key|token|secret|cookie|bearer/i`. Shredding is real: `cleanup.overwrittenBytes: 946` with `removed: true` on every seeded run.

---

## Check 5 — Typecheck — **CONFIRMED**

```
bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
→ no output, exit 0
```

---

## Check 6 — Git scope — **CONFIRMED**

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

6 files changed, 77 insertions, 27 deletions. All three corrective scopes are represented and nothing else: the live-QA driver + its test (scope 13/14), the backtest script (scope 15), and documentation (`changes.md`, four `AGENTS.md`). Evidence directories do not appear because `.gitignore:2` ignores `.omo/*` — confirmed via `git check-ignore -v`. No stray edits to `src/components/x-search/*.ts`, no test deletions, no unrelated files. Doc claims spot-checked against code: the `senpi-task/AGENTS.md` claim about `CHILD_DIRECT_EXPOSURE_TOOL_NAMES` remapping `x_search` from `exposure: "search"` to `"direct"` is pinned by a passing test (`shared-tool-filter.test.ts` → "given x_search and thread_create search-exposed tools … only x_search is direct and copied").

---

## Summary

Checks 2, 4, 5, 6 pass cleanly. Check 1 is mostly sound — the driver is genuinely transcript-derived with no fabricated constants, and the RED/mutation/`skillHasX` test evidence is real — but two claimed negative-scenario demonstrations did not happen, and this directory's README overstates `tool_search` activation in the positive run. Check 3 reproduces perfectly on determinism and structure (I independently regenerated a byte-identical report from the fixtures with the network disabled), but ships a **$0.00 cost claim for a run that actually cost ~$2.71**, under a `mode: "record"` label on what is really a fixture replay.

Nothing here is fabricated data — the failures are mislabeling and overstatement, not invented results. Two items need correction before this can be called clean: the backtest cost/mode honesty (3a) and the negative-scenario/README claims (1a).
