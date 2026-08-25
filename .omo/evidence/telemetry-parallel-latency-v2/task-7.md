# Task 7 — 로컬 스킬 쿼리 뱅크 확장 (`parallelism`, `parallelism_daily`)

Target file (OUTSIDE the repo, not version-controlled):
`/Users/yeongyu/.agents/skills/omo-native-telemetry/scripts/fetch_data.py`

Commit: **N** — the skill lives outside git, so the diff is recorded here per the plan.
Nothing inside `/Volumes/mengmotaStorage/local-workspaces/omo` or its worktrees was modified
except this single evidence file.

## 1. Diff

Produced against a pre-edit copy (`/tmp/fetch_data.py.bak`) since the skill dir is not a git repo:

```diff
--- fetch_data.py.bak	2026-08-16 17:37:09
+++ /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts/fetch_data.py	2026-08-16 17:37:24
@@ -58,6 +58,16 @@
     # Marginal cost of one extra round trip: the median session-median turn among sessions that
     # actually delegate. Uses observed cost_usd, which already prices cache reads correctly.
     "parallel_savings_basis": "select quantile(0.5)(p50_prefix) med_prefix, quantile(0.5)(p50_cost) med_cost, count() sessions from (select properties.$session_id sid, quantile(0.5)(toFloat(properties.input_tokens)+toFloat(properties.cache_read_tokens)+toFloat(properties.cache_write_tokens)) p50_prefix, quantile(0.5)(toFloat(properties.cost_usd)) p50_cost from events where event='turn_completed' and properties.$session_id in (select distinct properties.$session_id from events where event='delegation_started') group by sid)",
+    # Native tool-call parallelism, one parallelism_summary per session. The non_eval_* properties
+    # ALREADY exclude eval-tool waves, so eval_only_waves/mixed_waves are reported as SEPARATE
+    # buckets and are never folded into the non_eval totals - one eval cell running many internal
+    # operations would otherwise masquerade as fleet-wide parallelism. modeled_wallclock_saved_ms
+    # (sum of call durations minus the wave's wall-clock span) is the headline savings figure;
+    # upper_bound_saved_ms is a BOUND, not an estimate, so it is carried only as a secondary
+    # reference column. Fleet ratios must be derived downstream as sum(numerator)/sum(denominator)
+    # - these queries deliberately emit raw sums only, never per-session averages or medians.
+    "parallelism": "select count() sessions, sum(toFloat(properties.non_eval_saved_round_trips)) saved_round_trips, sum(toFloat(properties.modeled_wallclock_saved_ms)) modeled_saved_ms, sum(toFloat(properties.non_eval_waves_total)) waves_total, sum(toFloat(properties.non_eval_waves_multi)) waves_multi, sum(toFloat(properties.non_eval_joined_calls)) joined_calls, sum(toFloat(properties.eval_only_waves)) eval_only_waves, sum(toFloat(properties.mixed_waves)) mixed_waves, sum(toFloat(properties.incomplete_calls)) incomplete_calls, sum(toFloat(properties.clock_anomalies)) clock_anomalies, sum(toFloat(properties.dropped_calls)) dropped_calls, sum(toFloat(properties.measured_turn_duration_ms_total)) measured_turn_ms, sum(toFloat(properties.upper_bound_saved_ms)) upper_bound_saved_ms_ref from events where event='parallelism_summary'",
+    "parallelism_daily": f"select toDate({KST}) d, count() sessions, sum(toFloat(properties.modeled_wallclock_saved_ms)) modeled_saved_ms from events where event='parallelism_summary' group by d order by d",
 }
```

The diff is **purely additive**: `parallel_savings` / `parallel_savings_basis` are untouched, no
existing entry was removed or reordered, and the two new keys are appended at the end of `QUERIES`.

### Convention compliance
- stdlib only (no new imports at all).
- Both queries are single-line strings in the `QUERIES` dict.
- HogQL against project `552066` via the existing `hogql()` / `fetch_one()` path.
- `toFloat(properties.X)` for every numeric property.
- `parallelism_daily` reuses the module-level `KST` constant via f-string, exactly like
  `dau` / `turns_daily` / `prompts_daily`.
- Comment block above the new entries explains the eval-bucket separation and the
  `upper_bound_saved_ms` demotion, matching the commented style of `parallel_savings`.

### Semantic compliance
- `eval_only_waves` and `mixed_waves` are emitted as their **own columns**; they are never added
  into any `non_eval_*` sum. There is no `+` between an eval column and a non_eval column anywhere.
- `modeled_wallclock_saved_ms` is the headline (`modeled_saved_ms`, second column of `parallelism`
  and the only savings metric in the daily trend). `upper_bound_saved_ms` appears once, last,
  explicitly named `upper_bound_saved_ms_ref`.
- **No ratios are computed in SQL at all** — only raw sums plus `count()`. Any fleet ratio must be
  derived downstream as sum(numerator)/sum(denominator); there is no `avg(a/b)` and no per-session
  median anywhere in the new code (`quantile(...)` does not appear in either query).
- All 13 aggregate columns use property names byte-identical to the todo-5 schema.

## 2. Commands run (verbatim)

### 2.1 Syntax check + targeted run (the plan's acceptance criterion)

```
$ cd /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts && python3 -c "import ast,sys; ast.parse(open('fetch_data.py').read()); print('syntax ok')" && python3 fetch_data.py /tmp/t7-qa --only parallelism,parallelism_daily; echo "EXIT=$?"
syntax ok
parallelism: 1 rows
parallelism_daily: 0 rows
EXIT=0
```

**exit code 0.** Both JSON files were written.

### 2.2 JSON payloads

```
$ cd /tmp/t7-qa && for f in parallelism.json parallelism_daily.json; do echo "--- $f"; cat $f; echo; python3 -c "import json,sys; json.load(open('$f')); print('valid json')"; done
--- parallelism.json
[[0, null, null, null, null, null, null, null, null, null, null, null, null]]
valid json
--- parallelism_daily.json
[]
valid json
```

Interpretation (this is the correct result today, `parallelism_summary` is not yet deployed):
- `parallelism.json` — a non-grouped aggregate always returns exactly one row. `sessions = 0`
  and every `sum()` is `null` (ClickHouse/HogQL returns null for a sum over an empty set, not a
  fabricated `0`). This is the honest empty answer: it cannot be mistaken for "0 ms saved across
  real sessions" because the session count is explicitly 0.
- `parallelism_daily.json` — `[]`, a true empty series, because the `GROUP BY d` produces no groups.

Neither crashed, neither produced a bogus aggregate, and both are valid JSON.

### 2.3 Full query bank (sibling-regression check)

```
$ cd /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts && python3 fetch_data.py /tmp/t7-full > /tmp/t7-full.log 2>&1; echo "EXIT=$?"; cat /tmp/t7-full.log; echo "--- ERROR lines:"; grep -c ERROR /tmp/t7-full.log
EXIT=0
cohort_0812: 360 rows
user_features: 682 rows
parallelism: 1 rows
funnel_stages: 1 rows
parallel_savings_basis: 1 rows
parallel_cache: 558 rows
depth_cache: 5 rows
ulw_funnel: 1 rows
skill_pairs_onboarding: 12 rows
ulw: 6 rows
models: 25 rows
token_split: 1 rows
parallel_savings: 30 rows
deleg_funnel: 1 rows
d1_retention_0812: 1 rows
skill_diversity: 1 rows
depth_ladder: 1 rows
parallelism_daily: 0 rows
hourly: 100 rows
token_pcts: 1 rows
turn_depth: 1 rows
ordinal: 5 rows
prompt_len: 4 rows
prompts_daily: 6 rows
per_user: 653 rows
queue_mode: 4 rows
delegation: 15 rows
sessions_with_delegation: 1 rows
version_daily: 19 rows
headline: 1 rows
new_users_daily: 6 rows
skills: 22 rows
prompts_total: 1 rows
features: 3 rows
platform: 4 rows
batch_size: 3 rows
hour_profile: 24 rows
turns_daily: 6 rows
versions: 5 rows
dau: 6 rows
delegation_bg: 2 rows
--- ERROR lines:
0
```

`fetch_data.py` **exited 0**; `grep -c ERROR` reports **0** ERROR lines across all 41 queries.
(The shell reported a trailing non-zero status only because `grep -c` itself exits 1 when its
match count is zero — that is the *desired* outcome here, and the script's own `EXIT=0` is printed
above before it.) `parallel_savings` (30 rows) and `parallel_savings_basis` (1 row) still return
their pre-existing shapes, so no sibling query was broken.

## 3. Relaxed-filter proof — the SQL is valid, not silently empty

An empty result set alone cannot distinguish "valid query, no data" from "query matches nothing
because of a mistake". Two escalating proofs were run.

### 3.1 Structure proof — swap only the event filter to one that exists

```
$ cd /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts && python3 - <<'PY'
import fetch_data as fd
tok = fd.read_token()
for name in ("parallelism", "parallelism_daily"):
    q = fd.QUERIES[name].replace("event='parallelism_summary'", "event='turn_completed'")
    print(f"--- RELAXED {name}\nQUERY: {q}")
    rows = fd.hogql(tok, q)
    print(f"ROWS: {len(rows)}")
    print(rows[:8])
PY
--- RELAXED parallelism
QUERY: select count() sessions, sum(toFloat(properties.non_eval_saved_round_trips)) saved_round_trips, sum(toFloat(properties.modeled_wallclock_saved_ms)) modeled_saved_ms, sum(toFloat(properties.non_eval_waves_total)) waves_total, sum(toFloat(properties.non_eval_waves_multi)) waves_multi, sum(toFloat(properties.non_eval_joined_calls)) joined_calls, sum(toFloat(properties.eval_only_waves)) eval_only_waves, sum(toFloat(properties.mixed_waves)) mixed_waves, sum(toFloat(properties.incomplete_calls)) incomplete_calls, sum(toFloat(properties.clock_anomalies)) clock_anomalies, sum(toFloat(properties.dropped_calls)) dropped_calls, sum(toFloat(properties.measured_turn_duration_ms_total)) measured_turn_ms, sum(toFloat(properties.upper_bound_saved_ms)) upper_bound_saved_ms_ref from events where event='turn_completed'
ROWS: 1
[[1633540, None, None, None, None, None, None, None, None, None, None, None, None]]
--- RELAXED parallelism_daily
QUERY: select toDate(toTimeZone(timestamp,'Asia/Seoul')) d, count() sessions, sum(toFloat(properties.modeled_wallclock_saved_ms)) modeled_saved_ms from events where event='turn_completed' group by d order by d
ROWS: 6
[['2026-08-11', 1666, None], ['2026-08-12', 262489, None], ['2026-08-13', 465343, None], ['2026-08-14', 415600, None], ['2026-08-15', 274439, None], ['2026-08-16', 214010, None]]
```

Both parse and execute server-side and return rows (1 and 6). The `KST` date bucketing in
`parallelism_daily` demonstrably produces the six real KST day buckets. The sums are still null
here only because `turn_completed` does not carry the `parallelism_*` properties.

### 3.2 Aggregation proof — same structure, properties that actually exist on `turn_completed`

```
$ cd /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts && python3 - <<'PY'
import fetch_data as fd
tok = fd.read_token()
q = (fd.QUERIES["parallelism"]
     .replace("event='parallelism_summary'", "event='turn_completed'")
     .replace("properties.non_eval_saved_round_trips", "properties.turn_index")
     .replace("properties.modeled_wallclock_saved_ms", "properties.total_tokens")
     .replace("properties.non_eval_waves_total", "properties.input_tokens")
     .replace("properties.upper_bound_saved_ms", "properties.output_tokens"))
print("QUERY:", q)
print("ROWS:", fd.hogql(tok, q))
q2 = (fd.QUERIES["parallelism_daily"]
      .replace("event='parallelism_summary'", "event='turn_completed'")
      .replace("properties.modeled_wallclock_saved_ms", "properties.total_tokens"))
print("QUERY:", q2)
for r in fd.hogql(tok, q2):
    print(r)
PY
QUERY: select count() sessions, sum(toFloat(properties.turn_index)) saved_round_trips, sum(toFloat(properties.total_tokens)) modeled_saved_ms, sum(toFloat(properties.input_tokens)) waves_total, sum(toFloat(properties.non_eval_waves_multi)) waves_multi, sum(toFloat(properties.non_eval_joined_calls)) joined_calls, sum(toFloat(properties.eval_only_waves)) eval_only_waves, sum(toFloat(properties.mixed_waves)) mixed_waves, sum(toFloat(properties.incomplete_calls)) incomplete_calls, sum(toFloat(properties.clock_anomalies)) clock_anomalies, sum(toFloat(properties.dropped_calls)) dropped_calls, sum(toFloat(properties.measured_turn_duration_ms_total)) measured_turn_ms, sum(toFloat(properties.output_tokens)) upper_bound_saved_ms_ref from events where event='turn_completed'
ROWS: [[1633594, 80327925.0, 253928243169.0, 32854976150.0, None, None, None, None, None, None, None, None, 747578824.0]]
QUERY: select toDate(toTimeZone(timestamp,'Asia/Seoul')) d, count() sessions, sum(toFloat(properties.total_tokens)) modeled_saved_ms from events where event='turn_completed' group by d order by d
['2026-08-11', 1666, 202514905.0]
['2026-08-12', 262489, 38811264641.0]
['2026-08-13', 465343, 70675922083.0]
['2026-08-14', 415600, 67649333555.0]
['2026-08-15', 274439, 42810892867.0]
['2026-08-16', 214062, 33779245301.0]
```

This is the decisive proof: with the query **structure held constant** and only the property names
mapped onto ones `turn_completed` actually carries, every `sum(toFloat(properties.X))` slot returns
a real number and the daily series returns a populated per-KST-day trend. So the
`toFloat(...)` → `sum(...)` → column-alias path and the `KST` grouping are all functioning; the
nulls/empties in the production run are caused solely by the event not existing yet.

These relaxed queries were run **ad hoc in a subprocess only** — the `QUERIES` dict on disk still
filters on `event='parallelism_summary'` (see the diff in §1). Nothing relaxed was persisted.

## 4. Adversarial classes probed

| Class | Verdict | Evidence |
|---|---|---|
| **Malformed / absent data** (zero matching events) | **Handled** | §2.2 — `parallelism.json` is one row with `sessions=0` and null sums; `parallelism_daily.json` is `[]`. No crash, no exception, exit 0. Critically, the empty aggregate does **not** fabricate a `0` savings figure attributable to real sessions: the leading `sessions=0` makes the emptiness self-evident to the downstream card. |
| **Misleading success output** (empty result mistaken for success) | **Ruled out by direct proof** | §3.1 and §3.2 — the identical query structure returns 1 and 6 rows against `turn_completed`, and §3.2 shows the sum columns yielding real numbers when the properties exist. A syntax or aliasing fault would have raised a HogQL error, which `fetch_one` would have surfaced as an `ERROR` line. |
| **Flaky behavior / PostHog rate limits** | **Not bypassed** | No change to `fetch_one`, `hogql`, the 3-attempt retry, the `4 * (attempt + 1)` backoff, or the `max_workers=4` pool. The new queries go through `fetch_one` exactly like every sibling (§2.1, §2.3 both ran via the CLI, not via a hand-rolled request). The full 41-query bank ran in one pass with 0 ERROR lines, so the added load did not trip a limit. |
| **Sibling-query regression** (reorder/removal/edit of existing entries) | **Ruled out** | §1 diff is additive-only inside the dict; §2.3 shows all 39 pre-existing queries still returning rows, including `parallel_savings` (30) and `parallel_savings_basis` (1). |
| **Eval-bucket contamination** | **Ruled out by construction** | `eval_only_waves` / `mixed_waves` occupy dedicated columns; there is no arithmetic operator combining an eval column with a `non_eval_*` column anywhere in either query string. |
| **Ratio-of-averages / per-session median leakage** | **Ruled out by construction** | Neither new query contains `avg`, `quantile`, `median`, or a division operator. Only `count()` and `sum(toFloat(...))` are used, so all fleet ratios are necessarily computed downstream as sum/sum. |
| **`upper_bound_saved_ms` promoted to headline** | **Ruled out** | It appears exactly once, as the final column, aliased `upper_bound_saved_ms_ref`, and is absent entirely from `parallelism_daily` (the trend series carries only `modeled_wallclock_saved_ms`). |
| **Wrong timezone bucketing** | **Ruled out** | `parallelism_daily` interpolates the module-level `KST` constant (`toTimeZone(timestamp,'Asia/Seoul')`) rather than re-declaring it; §3.1/§3.2 show the resulting `toDate(toTimeZone(timestamp,'Asia/Seoul'))` producing correct KST day buckets. |
| **Non-stdlib dependency creep** | **Ruled out** | Zero import lines changed; the diff touches only the `QUERIES` dict literal. |
| **Repo contamination by a concurrent worker's tree** | **Ruled out** | The only path written under the worktree is this evidence file. The skill edit is at `~/.agents/skills/...`, outside every git tree. |

## 5. Cleanup receipt

```
$ rm -rf /tmp/t7-qa /tmp/t7-full /tmp/t7-full.log /tmp/t7.diff /tmp/fetch_data.py.bak
$ ls -d /tmp/t7-qa /tmp/t7-full 2>&1
ls: /tmp/t7-full: No such file or directory
ls: /tmp/t7-qa: No such file or directory
```

Both scratch output directories are deleted, along with the full-bank log, the diff scratch file,
and the pre-edit backup copy used to generate the diff. No temp artifacts remain.

## 6. Result

**PASS.**
- `python3 fetch_data.py /tmp/t7-qa --only parallelism,parallelism_daily` → exit 0.
- `/tmp/t7-qa/parallelism.json` and `/tmp/t7-qa/parallelism_daily.json` both existed and both
  parsed as valid JSON (empty/zero-session results, as expected today).
- `python3 fetch_data.py /tmp/t7-full` → exit 0 with **0** `ERROR` lines across all 41 queries.
- Relaxed-filter runs proved the SQL is genuinely valid and the aggregation path genuinely sums.
