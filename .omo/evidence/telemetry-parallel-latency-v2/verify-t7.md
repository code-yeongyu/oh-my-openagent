# Adversarial verification — todo 7 (local skill query bank: `parallelism`, `parallelism_daily`)

Independent verifier. Did NOT implement todo 7. Goal was to BREAK the done-claim, not confirm it.
No repo file and no skill script was modified by this verification — only this verdict file was written.

Under verification: two `QUERIES` entries + an 8-line explanatory comment in
`/Users/yeongyu/.agents/skills/omo-native-telemetry/scripts/fetch_data.py`.
Author evidence: `.omo/evidence/telemetry-parallel-latency-v2/task-7.md`.

```AdversarialVerify
verdict: confirmed
evidence: |
  P0 NEGATIVE CONTROL — is silence diagnostic at all? (the crux; the author never ran this)
    $ python3 -c "import fetch_data as fd; fd.hogql(fd.read_token(), <parallelism with 'count() sessions,,'>)"
      -> broken query raised as expected: HTTP Error 400: Bad Request
    $ ... <parallelism with sum(toFloat(nonexistent_column_xyz))>
      -> unknown column raised as expected: HTTP Error 400: Bad Request
    Establishes that PostHog rejects malformed SQL and unknown columns with a hard 400, which
    fetch_one surfaces as an `ERROR` line. Therefore a clean 0-row/null result is NOT the same
    signal a broken query would produce. This is what makes the emptiness meaningful.

  P1 PROPERTY-NAME CROSS-CHECK (highest-risk defect) — mechanical extraction, not eyeballing
    $ python3 <extract every `properties.X` from both new queries; compare to the
      parallelism_summary block in packages/omo-senpi/.../product-identity.ts>
      -> 13/13 references present in schema. 0 mismatches. Table below.
    Third-way check against the ACTUAL EMITTER (not just the schema declaration):
    $ grep -nE '"parallelism_summary"|non_eval_|modeled_wallclock|...' \
        packages/omo-senpi/src/components/telemetry/omo-native-parallel-summary.ts
      -> event name `parallelism_summary` (lines 37, 56) and all 13 property names emitted at
         lines 80-94 match the query text exactly. Query <-> schema <-> emitter all agree.

  P2 MY OWN RELAXED-FILTER PROOF (deliberately different from the author's transcript)
    Author used turn_completed; I used session_started for the structure proof and a different
    property mapping for the aggregation proof, so this is not a re-run of their commands.
    $ python3 <swap ONLY event='parallelism_summary' -> event='session_started'>
      [parallelism]       ROWS=1  [[81409, None x12]]
      [parallelism_daily] ROWS=6  [['2026-08-11',257,None], ['2026-08-12',5661,None],
                                   ['2026-08-13',9686,None], ...]
    $ python3 <structure held constant, my own mapping onto turn_completed properties:
      non_eval_saved_round_trips->output_tokens, modeled_wallclock_saved_ms->cost_usd,
      non_eval_waves_multi->reasoning_tokens, mixed_waves->cache_read_tokens,
      upper_bound_saved_ms->turn_index>
      ROWS=1, column count 13 (expected 13: True)
        sessions                          = 1634612
        saved_round_trips(<-output_tokens)= 748105907.0
        modeled_saved_ms(<-cost_usd)      = 263830.3184
        waves_multi(<-reasoning)          = 262485791.0
        mixed_waves(<-cache_read)         = 215317217416.0
        upper_bound_ref(<-turn_index)     = 80378318.0
        (the 7 unmapped slots correctly stay None)
      [parallelism_daily-mapped] ROWS=6
        ['2026-08-11', 1666,   110.78649999999998]
        ['2026-08-12', 262489, 40390.54420000003]
        ['2026-08-13', 465343, 79766.57950000008]
        ['2026-08-14', 415600, 67845.35139999996]
        ['2026-08-15', 274439, 44130.372600000046]
        ['2026-08-16', 215080, 31587.273299999986]
    Proves independently: the 13-column select list, every toFloat()->sum()->alias slot, and the
    KST toDate(toTimeZone(...)) day bucketing all execute and produce real values. The production
    nulls/[] are caused solely by the event not being deployed.

  P3 RE-RUN OF BOTH VERIFY COMMANDS
    $ cd ~/.agents/skills/omo-native-telemetry/scripts && python3 -c "import ast;ast.parse(...)" \
      && python3 fetch_data.py /tmp/advq-t7 --only parallelism,parallelism_daily
      syntax ok
      parallelism: 1 rows
      parallelism_daily: 0 rows
      EXIT=0
      parallelism.json       = [[0, null, null, null, null, null, null, null, null, null, null, null, null]]  valid json
      parallelism_daily.json = []                                                                              valid json
    Plan's literal acceptance criterion (--only parallelism alone):
    $ python3 fetch_data.py /tmp/advq-t7-plan --only parallelism
      parallelism: 1 rows ; EXIT=0 ; /tmp/advq-t7-plan/parallelism.json created
    Author's claimed payloads reproduce byte-for-byte. Honest emptiness: sessions=0 with null
    sums, not fabricated zeros — a downstream card cannot misread it as "0 ms saved by real users".

  P4 FULL-BANK REGRESSION
    $ python3 fetch_data.py /tmp/advq-t7-full > /tmp/advq-t7-full.log 2>&1
      SCRIPT_EXIT=0
      total query lines: 41   | QUERIES dict size: 41 | json files written: 41
      ERROR count: 0          | unreachable count: 0  | invalid json: none
      parallelism: 1 rows / parallelism_daily: 0 rows
      parallel_savings: 30 rows / parallel_savings_basis: 1 rows / headline: 1 rows / dau: 6 rows
    All 41 ran concurrently through the real 4-worker pool in one pass; siblings hold their
    expected shapes; no rate-limit retry was tripped or bypassed.

  P5 ADDITIVE-ONLY RECONSTRUCTION
    $ python3 <locate the added block, delete it, re-parse the remainder>
      ADDED BLOCK: lines 61..70 (10 lines) = 8 comment lines + keys ['parallelism','parallelism_daily']
      line following the block is '}' -> block is a self-contained tail insertion inside QUERIES
      reconstructed pre-edit file parses OK (ast.parse)
      insertion order: last 4 keys = ['parallel_savings','parallel_savings_basis','parallelism','parallelism_daily']
      new keys are the final two: True
    $ grep -nE "^import |^from |max_workers|attempt|time.sleep|def (hogql|fetch_one|main|read_token)"
      imports 1-7 unchanged (stdlib only, no additions); fetch_one 3-attempt loop (line 94/100),
      time.sleep(4 * (attempt + 1)) backoff (line 102), ThreadPoolExecutor(max_workers=4) (line 121)
      all present and untouched. No existing query modified, removed, or reordered.

  P6 SEMANTICS vs THE PLAN'S FOUR PROHIBITIONS (mechanical scan of the SQL text)
      R1 eval summed into non_eval totals -> PASS. 12 aggregate exprs in `parallelism`; no agg
         mixes an eval_only_*/mixed_waves term with a non_eval_* term; zero '+' between any two
         properties. eval_only_waves (col 7) and mixed_waves (col 8) are dedicated columns.
      R2 average of a ratio -> PASS. No `avg(`. The only '/' in either query is inside the
         'Asia/Seoul' string literal; with string literals stripped, no '/' remains -> no division.
      R3 fleet median from per-session medians -> PASS. No quantile/median token; no nested
         `from (select ...)` subquery. Only count() and sum(toFloat(...)).
      R4 upper_bound as headline -> PASS. Appears exactly once, position 13 of 13 (last), aliased
         `upper_bound_saved_ms_ref`, and absent entirely from parallelism_daily, whose only
         savings metric is modeled_wallclock_saved_ms.
      Plan-mandated aggregate coverage: all 7 required (saved_round_trips, modeled_wallclock_saved_ms,
      waves_total, waves_multi, eval_only_waves, mixed_waves, session count) present.
repro: no defect found; nothing to reproduce
confidence: 0.93
```

## Property-name cross-check table

Authority: `parallelism_summary` block in
`packages/omo-senpi/src/components/telemetry/product-identity.ts` (working tree), corroborated
against the emitter `omo-native-parallel-summary.ts:80-94`.

| # | Query | Property referenced | In schema? | In emitter? | Verdict |
|---|---|---|---|---|---|
| 1 | `parallelism` | `non_eval_saved_round_trips` | YES | YES (:89) | OK |
| 2 | `parallelism` | `modeled_wallclock_saved_ms` | YES | YES (:87) | OK |
| 3 | `parallelism` | `non_eval_waves_total` | YES | YES (:92) | OK |
| 4 | `parallelism` | `non_eval_waves_multi` | YES | YES (:91) | OK |
| 5 | `parallelism` | `non_eval_joined_calls` | YES | YES (:88) | OK |
| 6 | `parallelism` | `eval_only_waves` | YES | YES (:83) | OK |
| 7 | `parallelism` | `mixed_waves` | YES | YES (:86) | OK |
| 8 | `parallelism` | `incomplete_calls` | YES | YES (:84) | OK |
| 9 | `parallelism` | `clock_anomalies` | YES | YES (:80) | OK |
| 10 | `parallelism` | `dropped_calls` | YES (see note) | YES (:81) | OK |
| 11 | `parallelism` | `measured_turn_duration_ms_total` | YES | YES (:85) | OK |
| 12 | `parallelism` | `upper_bound_saved_ms` | YES | YES (:94) | OK |
| 13 | `parallelism_daily` | `modeled_wallclock_saved_ms` | YES | YES (:87) | OK |

**13/13 match. Zero typos. Zero silent-null risks.**

Note on `dropped_calls` (row 10): the task brief flagged that a concurrent worker was adding this
key and that its absence should be treated as EXPECTED, not a defect. Checked both states:

```
$ git show HEAD:.../product-identity.ts | grep -n "parallelism_summary" -A 20
    -> committed de7416776 has 15 keys, NO dropped_calls
$ git diff .../product-identity.ts
    +    dropped_calls: NUMBER_PROPERTY,
    -> working tree HAS it (16 keys), uncommitted, from the concurrent worker
```
It has since landed in the working tree and in the emitter, so row 10 resolves to a clean YES.
Not a defect either way.

Schema keys deliberately NOT queried (correct, not omissions): `$session_id` (identity, not an
aggregate), `schema_kind` (enum discriminator), `non_eval_wave_size_histogram` (positionally
encoded string — cannot be `sum()`ed; it belongs to todo 8's card rendering), and
`eval_only_duration_ms` (eval-bucket duration, reportable separately). None of these can be
meaningfully summed by this query, so their absence is right.

## My independent relaxed-filter proof (full output)

Distinct from the author's: different substitute event (`session_started` rather than
`turn_completed`) and a different property mapping, plus a negative control they never ran.

### A. Negative control — is an empty result actually distinguishable from a broken query?
```
broken query raised as expected: HTTP Error 400: Bad Request
unknown column raised as expected: HTTP Error 400: Bad Request
```
Both a syntax fault and an unknown column produce a hard HTTP 400 that `fetch_one` would print as
an `ERROR` line. So the clean run is genuinely informative — this is the step that upgrades
"returned nothing" from meaningless to meaningful, and it is the gap in the author's own proof.

### B. Structure proof — swap ONLY the event filter to `session_started`
```
[parallelism]       ROWS=1  first=[[81409, None, None, None, None, None, None, None, None, None, None, None, None]]
[parallelism_daily] ROWS=6  first=[['2026-08-11', 257, None], ['2026-08-12', 5661, None], ['2026-08-13', 9686, None]]
```

### C. Aggregation proof — structure constant, my own mapping onto real `turn_completed` properties
```
[parallelism-mapped] ROWS= 1
[[1634612, 748105907.0, 263830.3184, None, 262485791.0, None, None, 215317217416.0, None, None, None, None, 80378318.0]]
column count in SQL result: 13 expected 13: True
   sessions                               = 1634612
   saved_round_trips(<-output_tokens)     = 748105907.0
   modeled_saved_ms(<-cost_usd)           = 263830.3184
   waves_total                            = None
   waves_multi(<-reasoning)               = 262485791.0
   joined_calls                           = None
   eval_only_waves                        = None
   mixed_waves(<-cache_read)              = 215317217416.0
   incomplete                             = None
   clock_anom                             = None
   dropped                                = None
   measured_turn_ms                       = None
   upper_bound_ref(<-turn_index)          = 80378318.0

[parallelism_daily-mapped] ROWS= 6
    ['2026-08-11', 1666, 110.78649999999998]
    ['2026-08-12', 262489, 40390.54420000003]
    ['2026-08-13', 465343, 79766.57950000008]
    ['2026-08-14', 415600, 67845.35139999996]
    ['2026-08-15', 274439, 44130.372600000046]
    ['2026-08-16', 215080, 31587.273299999986]
```
Every mapped slot returns a real number; the 7 unmapped slots correctly remain `None`; the daily
series produces six populated KST day buckets. The `toFloat -> sum -> alias` path and the KST
grouping are proven functional independently of the author's transcript.

These relaxed queries ran in an ad-hoc subprocess only. `QUERIES` on disk still filters on
`event='parallelism_summary'` — the file's mtime is unchanged from the author's edit (17:37:24).

## Claim-by-claim adjudication

| Author claim | Independently reproduced? |
|---|---|
| `--only parallelism,parallelism_daily` exits 0; 1 row / 0 rows | YES — exact match |
| `parallelism.json` = `[[0, null x12]]`, `parallelism_daily.json` = `[]`, both valid JSON | YES — byte-identical |
| Full bank: 41 queries, 0 ERROR lines, exit 0 | YES — 41/41, 0 ERROR, 0 unreachable, 41 valid JSON |
| `parallel_savings` 30 rows / `parallel_savings_basis` 1 row unchanged | YES |
| Relaxed-filter run returns rows and proves the SQL/KST path | YES — and strengthened with a negative control the author omitted |
| Purely additive; no existing query touched/reordered; no import changes | YES — verified by reconstruction + ast.parse + key-order check |
| Retry/backoff and 4-worker pool untouched | YES — lines 94/100/102/121 intact |

## Residual risk (why 0.93, not 1.0)

Not defects in todo 7, but the honest limits of what is verifiable today:

1. **End-to-end with real data is impossible right now.** `parallelism_summary` has zero rows in
   project 552066. Names/shape/aggregation path are proven three ways (schema, emitter, relaxed
   execution), but the first real ingested event is still the only thing that can prove the values
   are *sensible* rather than merely well-formed. That is inherent to todo 7 running before
   deployment, not a flaw in it.
2. **`dropped_calls` is uncommitted.** The query depends on a schema key that currently exists only
   in the working tree. If that concurrent change is reverted before landing, column 11 silently
   becomes permanent nulls (no error). Low risk — the emitter already sends it — but it is a real
   cross-worker coupling.
3. Semantics rules R1-R4 were judged by mechanical scan of the SQL plus reading it; they are
   structural properties of the query text, which is the correct level for these rules.

## Cleanup receipt

```
$ rm -rf /tmp/advq-t7 /tmp/advq-t7-full /tmp/advq-t7-full.log /tmp/advq-t7-plan
$ ls -d /tmp/advq-t7 /tmp/advq-t7-full /tmp/advq-t7-plan /tmp/advq-t7-full.log 2>&1
ls: /tmp/advq-t7: No such file or directory
ls: /tmp/advq-t7-full: No such file or directory
ls: /tmp/advq-t7-full.log: No such file or directory
ls: /tmp/advq-t7-plan: No such file or directory
$ ls -d /tmp/advq* 2>&1
ls: /tmp/advq*: No such file or directory
```
All four scratch paths I created are deleted; no leftovers. Verified I mutated nothing else:
`git status --porcelain` shows only the concurrent worker's pre-existing changes (unchanged by me),
and `stat` on `fetch_data.py` shows mtime 17:37:24 — the author's edit, not touched by this
verification.

**Verdict: `confirmed`.**
