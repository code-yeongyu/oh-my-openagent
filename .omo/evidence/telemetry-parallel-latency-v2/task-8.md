# Task 8 — dashboard card + skill documentation

**Scope**: local skill only, OUTSIDE the git repo. No repo files touched, no commit.
**Date**: 2026-08-16
**Session**: st_01a009c8 (parent 01a00933-a889-7889-b272-c711e52d2530)

## Changed files (all outside the repo)

| Path | Change |
|---|---|
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/templates/unified_model.py` | `PARALLELISM_COLS`, `hms()`, `build_parallelism()`, `"plm"` wired into `build_model` |
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/templates/build_unified.py` | new `.g21` card pair (parallelism + eval/quality), `hms` import, `body{height}` 2580 → 3060 |
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/SKILL.md` | `parallelism_summary` schema row, event count 7→8, full metric documentation block, height-measurement procedure |

Nothing inside `/Volumes/mengmotaStorage/local-workspaces/omo` or its worktrees was modified
except this single evidence file.

## Diffs

The skill lives outside git and had no pristine baseline snapshot, so the added regions are
recorded verbatim below.

### `templates/unified_model.py`

Added after `BATCH_CAP`:

```python
# Column order of the `parallelism` query in scripts/fetch_data.py. It is a NON-GROUPED
# aggregate, so an empty event table returns ONE ROW of nulls (sessions=0 then nulls) rather
# than an empty list - the view model must gate on sessions and never render the nulls.
PARALLELISM_COLS = [
    "sessions", "saved_round_trips", "modeled_saved_ms", "waves_total", "waves_multi",
    "joined_calls", "eval_only_waves", "mixed_waves", "incomplete_calls", "clock_anomalies",
    "dropped_calls", "measured_turn_ms", "upper_bound_saved_ms_ref",
]
```

Column order was CONFIRMED by reading the query in `scripts/fetch_data.py:69`, not guessed:

```
select count() sessions, sum(...non_eval_saved_round_trips), sum(...modeled_wallclock_saved_ms),
       sum(...non_eval_waves_total), sum(...non_eval_waves_multi), sum(...non_eval_joined_calls),
       sum(...eval_only_waves), sum(...mixed_waves), sum(...incomplete_calls),
       sum(...clock_anomalies), sum(...dropped_calls), sum(...measured_turn_duration_ms_total),
       sum(...upper_bound_saved_ms) from events where event='parallelism_summary'
```

Note the query has 13 columns, two MORE than the task brief listed (`measured_turn_ms` and
`upper_bound_saved_ms_ref` trail the brief's list). Reading the source caught this; guessing
from the brief would have mis-mapped the last two columns.

Added helpers:

```python
def hms(ms: float) -> str:
    """Compact duration label for a millisecond total (mirrors k()'s terse style)."""
    s = ms / 1000
    if s >= 3600:
        return f"{s / 3600:,.1f}시간"
    if s >= 60:
        return f"{s / 60:,.1f}분"
    return f"{s:,.1f}초"


def build_parallelism(f: dict) -> dict:
    """Derive the native tool-call parallelism block from the `parallelism` aggregate.

    (`parallelism_daily` is fetched for trend work but the card renders fleet totals only.)

    `parallelism_summary` is not deployed everywhere yet, so the zero-data path is the common
    one: the query returns a single all-null row with sessions=0. Gate on sessions and hand the
    card an explicit `has_data: False` placeholder instead of formatting Nones. Every rate here
    is sum(numerator)/sum(denominator) over the fleet - never a mean of per-session ratios.
    """
    rows = f.get("parallelism") or []
    r = dict(zip(PARALLELISM_COLS, rows[0])) if rows else {}
    sessions = int(r.get("sessions") or 0)
    if sessions == 0:
        return {"has_data": False, "sessions": 0}

    n = {c: float(r.get(c) or 0) for c in PARALLELISM_COLS[1:]}
    waves_total = n["waves_total"]
    joined = n["joined_calls"]
    eval_waves = n["eval_only_waves"] + n["mixed_waves"]
    return {
        "has_data": True,
        "sessions": sessions,
        "modeled_saved_ms": n["modeled_saved_ms"],
        "upper_bound_saved_ms": n["upper_bound_saved_ms_ref"],
        "saved_round_trips": n["saved_round_trips"],
        "waves_total": waves_total,
        "waves_multi": n["waves_multi"],
        # fleet rate = sum/sum, not the average of per-session rates
        "multi_share": (n["waves_multi"] / waves_total * 100) if waves_total else 0.0,
        "joined_calls": joined,
        "calls_per_multi_wave": (joined / n["waves_multi"]) if n["waves_multi"] else 0.0,
        "modeled_saved_per_session_ms": n["modeled_saved_ms"] / sessions,
        "measured_turn_ms": n["measured_turn_ms"],
        "saved_share_of_turn": (n["modeled_saved_ms"] / n["measured_turn_ms"] * 100)
        if n["measured_turn_ms"] else 0.0,
        # eval buckets stay separate on purpose - folding them into non_eval totals would let a
        # single long eval cell masquerade as fleet-wide parallelism
        "eval_only_waves": n["eval_only_waves"],
        "mixed_waves": n["mixed_waves"],
        "eval_bucket_waves": eval_waves,
        "incomplete_calls": n["incomplete_calls"],
        "clock_anomalies": n["clock_anomalies"],
        "dropped_calls": n["dropped_calls"],
    }
```

and `"plm": build_parallelism(f),` appended to the `build_model` return dict.

### `templates/build_unified.py`

Import: `from unified_model import build_model, hms, k`.

CSS: `height:2580px` → `height:3060px` (measurement below).

New view-model-to-HTML block inserted before `corr_rows`:

```python
# Native per-tool-call parallelism (parallelism_summary). Separate from the delegation-batch
# card above: that one infers batches from same-second delegation_started rows and is an
# explicit LOWER BOUND, this one is measured from observed per-call start/end times.
p = m["plm"]
if p["has_data"]:
    plm_big = f'모델 추정 절감 <i>{hms(p["modeled_saved_ms"])}</i> · 라운드트립 {p["saved_round_trips"]:,.0f}회'
    plm_sub = (
        f'non_eval 웨이브 {p["waves_total"]:,.0f}개 · 세션 {p["sessions"]:,}개 · 세션당 '
        f'{hms(p["modeled_saved_per_session_ms"])} · 실측 시작/종료 시각의 스팬 기준 '
        f'(Σ소요시간 − 웨이브 스팬), 측정된 벽시계 시간이 아니라 모델 추정치'
    )
    plm_rows = (
        row("다중 콜 웨이브 비율", p["multi_share"] / 100,
            f'{p["multi_share"]:.0f}% · {p["waves_multi"]:,.0f}/{p["waves_total"]:,.0f}개', GREEN)
        + row("다중 웨이브당 합류 콜", min(p["calls_per_multi_wave"] / 8, 1.0),
              f'{p["calls_per_multi_wave"]:.2f}개 · 총 {p["joined_calls"]:,.0f}콜', GREEN)
        + row("턴 측정시간 대비 모델 추정 절감", min(p["saved_share_of_turn"] / 100, 1.0),
              f'{p["saved_share_of_turn"]:.1f}% · 측정 턴 {hms(p["measured_turn_ms"])}', CORAL)
    )
    plm_side = (
        f'<div class="kvrow"><span>eval 단독 웨이브</span><b>{p["eval_only_waves"]:,.0f}개</b></div>'
        f'<div class="kvrow"><span>eval 혼합 웨이브</span><b>{p["mixed_waves"]:,.0f}개</b></div>'
        f'<div class="kvrow"><span>상한 참고치 (상한, 헤드라인 아님)</span><b>{hms(p["upper_bound_saved_ms"])}</b></div>'
        f'<div class="kvrow"><span>미완결/시계이상/드롭 콜</span>'
        f'<b>{p["incomplete_calls"]:,.0f} · {p["clock_anomalies"]:,.0f} · {p["dropped_calls"]:,.0f}</b></div>'
    )
    plm_side_big = f'eval 버킷 <i>{p["eval_bucket_waves"]:,.0f}개</i>'
else:
    plm_big = f'모델 추정 절감 <span style="color:{STONE}">수집 대기</span>'
    plm_sub = (
        "parallelism_summary 이벤트가 아직 수집되지 않음 (세션 0개) · 세션당 최대 1회 발화되며, "
        "실측 시작/종료 시각의 스팬(Σ소요시간 − 웨이브 스팬)으로 모델 추정 절감을 계산한다"
    )
    plm_rows = (
        row("다중 콜 웨이브 비율", 0, "수집 대기", SILVER)
        + row("다중 웨이브당 합류 콜", 0, "수집 대기", SILVER)
        + row("턴 측정시간 대비 모델 추정 절감", 0, "수집 대기", SILVER)
    )
    plm_side = (
        f'<div class="kvrow"><span>eval 단독 웨이브</span><b style="color:{STONE}">수집 전</b></div>'
        f'<div class="kvrow"><span>eval 혼합 웨이브</span><b style="color:{STONE}">수집 전</b></div>'
        f'<div class="kvrow"><span>상한 참고치 (상한, 헤드라인 아님)</span><b style="color:{STONE}">수집 전</b></div>'
        f'<div class="kvrow"><span>미완결/시계이상/드롭 콜</span><b style="color:{STONE}">수집 전</b></div>'
    )
    plm_side_big = f'eval 버킷 <span style="color:{STONE}">수집 대기</span>'
```

New markup block inserted between the existing delegation-savings `.g21` row and the final `.g3` row:

```html
<div class="g21">
  <div class="card"><div class="ct">네이티브 툴콜 병렬도 — 실측 스팬 기반</div>
    <div class="cbig">{plm_big}</div>
    <div class="cs">{plm_sub}</div>
    {plm_rows}
    <div class="cs" style="margin:2px 0 0">위 카드의 위임 배치 절감은 동일초 디스패치로 추정한 하한, 이 카드는 툴콜별 실측 시각으로 계산한 직접 측정치</div></div>
  <div class="card"><div class="ct">eval 버킷 · 데이터 품질</div>
    <div class="cbig">{plm_side_big}</div>
    {plm_side}
    <div class="cs" style="margin:10px 0 0">eval/코드모드 웨이브는 의도적으로 병렬도 수치에서 제외하고 별도 집계 · 드롭 콜은 세션 상한 초과 때만 발생</div></div>
</div>
```

### `SKILL.md`

- `## Event schema (7 events)` → `(8 events)`; added the `parallelism_summary` row listing every
  property.
- Delegation-batching bullet's closing line retargeted: "not `eval`/tool-call parallelism, which
  `parallelism_summary` (below) measures directly" (was: "which remains uninstrumented").
- Stale "general tool-call/eval parallelism is still NOT instrumented (schema gap)" replaced with
  a note that the `parallel_cache` cross-section predates and is not replaced by the new event.
- New **Native tool-call parallelism** block documenting: once-per-session emission bound and why
  it is the only volume defense; the wave definition (interval-graph connected component, chained
  waves are normal); `modeled_wallclock_saved_ms = Σdᵢ − span` and why `max(dᵢ)` is wrong (4.5x
  overstatement on the chained A(0-5)/B(4-9)/C(8-12) case, identical on true simultaneous batches);
  `savedRoundTrips` via sweep-line `maxConcurrency`, not `N−1`; `upper_bound_saved_ms` as a bound
  only (8.25x / 16.38x inflation); `measured_turn_duration_ms_total` as the only real measurement;
  eval bucketing vs filtering (filtering shrinks the span so savings INFLATE, 1.20s → 0.70s);
  the three data-quality counters incl. `dropped_calls` at `MAX_TRACKED_CALLS = 2000`; the
  positional histogram encoding and the 64-char truncation hazard (labelled form = 69 chars, cut
  silently; positional = 39 chars); the `measured_` / `modeled_` / `_upper_bound` naming
  convention; sum/sum ratio rule; and the zero-data one-row-of-nulls trap.
- Render section: shipped height list updated to note unified is now 3060; added the "measure, do
  not guess" procedure (oversized render at DPR 1, scan rows from the bottom, add ~40px) and the
  "measure the TALLEST variant" rule with the empty-vs-populated numbers from this task.

## Commands and output

### Verify command 1 — fetch

```
$ cd /Users/yeongyu/.agents/skills/omo-native-telemetry/scripts && python3 fetch_data.py /tmp/t8-data
...
parallelism: 1 rows
parallelism_daily: 0 rows
...
EXIT=0   (real 0m9.287s, 41 queries)
```

Zero-data shape confirmed on disk:

```
$ cat /tmp/t8-data/parallelism.json
[[0, null, null, null, null, null, null, null, null, null, null, null, null]]
$ cat /tmp/t8-data/parallelism_daily.json
[]
```

### Verify command 2 — growth analysis

```
$ cd .../scripts && uv run --with numpy --with polars --with scipy python3 growth_analysis.py /tmp/t8-data
...
PARALLEL x CACHE (users delegs>=3, n=433): rho=0.197 p=4e-05 | cache 87.0% (par>=50%, n=296) vs 82.8% (par<50%, n=137)
OK growth_stats.json written
EXIT=0
```

### Verify command 3 — build

```
$ cd .../templates && python3 build_unified.py /tmp/t8-data
html written 12559
EXIT=0
```

Re-run of all three after the final edits: `fetch EXIT=0`, `growth EXIT=0`, `build EXIT=0`.

### Renders

```
$ "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=2 --window-size=1080,3060 \
    --screenshot=/tmp/t8-data/dash_nodata.png "file:///tmp/t8-data/index_unified.html"
1054423 bytes written to file /tmp/t8-data/dash_nodata.png

$ ... --window-size=1080,3060 --screenshot=/tmp/t8-synth/dash_synth.png "file:///tmp/t8-synth/index_unified.html"
1074794 bytes written to file /tmp/t8-synth/dash_synth.png
```

### No-`None` grep gate

```
$ grep -io "none\|null" /tmp/t8-data/index_unified.html | sort | uniq -c
(no matches — exit 1)

$ grep -io "none\|null" /tmp/t8-synth/index_unified.html | sort | uniq -c
   1 none
$ grep -io ".\{40\}none.\{40\}" /tmp/t8-synth/index_unified.html
626.9,81.1 633.5,76.2 640.0,76.9" fill="none" stroke="#141413" stroke-width="3" stro
```

The single match is the sparkline SVG's `fill="none"` attribute — not rendered text. Both crops
were visually inspected and contain no `None`/`null`/`NaN` glyphs.

## Height measurement — before / after

Procedure: render at an oversized window with `--force-device-scale-factor=1`, then scan pixel
rows from the bottom for the last row differing from the canvas background.

| State | Measurement | Value |
|---|---|---|
| BEFORE (inherited `body{height}`) | — | **2580px** |
| After card added, no-data, probe @4000px | true content bottom | **2973px** (clipped by 393px at 2580) |
| First correction | `body{height}` | 3000px |
| With SYNTHETIC data, probe @4200px | true content bottom | **3021px** (clipped by 21px at 3000 — footer line 2 cut, VISUALLY CONFIRMED) |
| FINAL | `body{height}` | **3060px** |
| Final no-data render | content bottom / margin | 2967.5 / **92.5px** |
| Final synth render | content bottom / margin | 3015.5 / **44.5px** |

Key finding worth keeping: the populated card is ~48px TALLER than the empty one (the headline
wraps to two lines once real numbers are present). A height tuned only on today's all-null state
would have shipped, looked fine, and then silently clipped the footer on the day the event starts
landing. This is recorded in SKILL.md.

## Crops viewed (persisted outside /tmp)

| Path | What I observed |
|---|---|
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/.qa/task-8/card_nodata.png` | The new `.g21` pair renders the no-data state cleanly. Left card: "네이티브 툴콜 병렬도 — 실측 스팬 기반" overline, headline "모델 추정 절감 수집 대기" (placeholder in STONE, not the terracotta accent, so it does not read as a value), sub-line naming `parallelism_summary`, the once-per-session bound and the span formula. Three `row()` bars at zero fill with "수집 대기" values in SILVER. Footnote distinguishing the delegation lower bound above from this direct measurement. Right card: "EVAL 버킷 · 데이터 품질" with eval 단독 / eval 혼합 as separate kvrows, the upper bound explicitly labelled "상한 참고치 (상한, 헤드라인 아님)", the three quality counters on one compact row, and the eval-exclusion note. **ZERO `None`/`null` text anywhere.** PASS. |
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/.qa/task-8/bottom_nodata.png` | Bottom 800 CSS px. The final `.g3` row (모델 라우팅 / 스킬 로드 TOP 5 / 행동 시그널) is fully drawn, and the footer renders both lines completely: "리프트 = Fisher exact + RR 95% CI + BH-FDR ... 런치 코호트" / "상관관계이며 인과 아님 · 비용 및 custom 라우팅 수치는 과대 가능 · omo 실시간 집계". Clear background below it. No clipping. PASS. |
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/.qa/task-8/card_synth.png` | Same card with the synthetic non-zero payload. Headline "모델 추정 절감 1.3시간 · 라운드트립 9,134회" — the word 모델 추정 (modeled) is on-screen and adjacent to the figure. Sub-line "non_eval 웨이브 51,204개 · 세션 412개 · 세션당 11.7초 · ... 측정된 벽시계 시간이 아니라 모델 추정치". Rows: 다중 콜 웨이브 비율 14% · 7,318/51,204개 (sum/sum), 다중 웨이브당 합류 콜 3.00개, 턴 측정시간 대비 6.7% · 측정 턴 19.9시간. Right card: eval 단독 1,842개 and eval 혼합 963개 as separate rows (never folded in), 상한 참고치 5.4시간 clearly marked as a bound, 미완결/시계이상/드롭 217 · 4 · 38. PASS. |
| `/Users/yeongyu/.agents/skills/omo-native-telemetry/.qa/task-8/bottom_synth.png` | Same bottom strip in the populated state at the final 3060px height. Footer both lines fully visible with clear space below. This is the crop that FAILED at 3000px (footer line 2 sliced) and passes at 3060px. PASS. |

Full-page renders also persisted at `.qa/task-8/dash_nodata.png` and `.qa/task-8/dash_synth.png`.

## Metric-honesty compliance

| Rule | How it is satisfied |
|---|---|
| `modeled_wallclock_saved_ms` label carries "modeled" | Headline literally reads `모델 추정 절감 <value>`; sub-line repeats "측정된 벽시계 시간이 아니라 모델 추정치". Row 3 label is "턴 측정시간 대비 모델 추정 절감". |
| `upper_bound_saved_ms` never a headline | Rendered only as a `kvrow` in the secondary card, labelled "상한 참고치 (상한, 헤드라인 아님)". |
| eval buckets separate, never summed into non_eval | `eval_only_waves` / `mixed_waves` are their own kvrows; `eval_bucket_waves` (their sum) is a separate card headline and is never added to `waves_total`/`joined_calls`. Note added: "eval/코드모드 웨이브는 의도적으로 병렬도 수치에서 제외하고 별도 집계". |
| Never average a ratio | `multi_share`, `calls_per_multi_wave`, `saved_share_of_turn` are all `sum(numerator)/sum(denominator)` over the fleet sums returned by the query. There is no per-session ratio anywhere in the view model, and the query returns only raw sums. |
| Data-quality counters visible | `incomplete_calls · clock_anomalies · dropped_calls` on one compact kvrow, plus a note that dropped calls occur only when a session exceeds its cap. |

## Design-system compliance

- Colors: only the existing module constants — `STONE` (placeholders), `SILVER` (empty bars),
  `GREEN` / `CORAL` (bar fills), plus the inherited `.kvrow b` terracotta. Zero new hex literals.
- Layout: existing `.g21` grid (2fr/1fr), `.card`, `.ct` / `.cbig` / `.cs` / `.kvrow` classes and
  the shared `row()` helper. No new CSS rules added other than the `body{height}` value.
- No gradients, no shadows, no new fonts, no emoji. Em dash appears only in the card title, matching
  the five sibling card titles that already use it ("병렬 툴콜링 절감 — 시리얼 실행 반사실").
  Placeholder VALUES use the word 수집 대기 / 수집 전 rather than a bare dash.
- Card placement: appended after the existing delegation-savings row, before the final `.g3` row.
  No existing card deleted, reordered, or restyled.

## Adversarial classes probed

| Class | Probe | Result |
|---|---|---|
| **Misleading success output** (no-data is the only live path) | Injected a synthetic non-zero `parallelism.json` (412 sessions, 9,134 round trips, 4.812e6 ms modeled, 51,204/7,318 waves, 21,940 joined, 1,842/963 eval, 217/4/38 quality, 7.15e7 ms measured turn, 1.94e7 ms upper bound) + a 2-row `parallelism_daily.json` into `/tmp/t8-synth`, rebuilt and rendered. | Card renders correct populated values; this is ALSO how the 3000px clipping was caught. Both states captured. |
| **Malformed / absent data — missing daily file** | `rm parallelism_daily.json` then build | `html written 12559`, exit 0. `build_parallelism` no longer reads it at all. |
| **Malformed / absent data — missing `parallelism.json` entirely** | `rm parallelism.json` then build | exit 0, no-data placeholder path. `f.get("parallelism") or []` handles the missing key. |
| **Malformed data — all-null row incl. `sessions=null`** | `[[null × 13]]` | exit 0, placeholder path (`int(r.get("sessions") or 0)` → 0). |
| **Malformed data — empty array** | `[]` | exit 0, placeholder path. |
| **Partial event — `sessions=7` but every metric null** | `[[7, null × 12]]` | exit 0 and renders real zeros ("모델 추정 절감 0.0초 · 라운드트립 0회", "0% · 0/0개", "0.00개 · 총 0콜"), not `None`. Every divisor is guarded, so no ZeroDivisionError. This is the nastiest shape (has_data true, no numbers) and it is safe. |
| **Silent clipping** | Programmatic bottom-row scan at oversized windows in BOTH states + visual bottom-crop inspection | Caught a real 21px clip at 3000px in the populated state that the no-data state hid. Fixed at 3060px, re-measured, re-viewed. |
| **Wrong column mapping** | Read `scripts/fetch_data.py:69` instead of trusting the brief's 11-column list | Query actually returns 13 columns; the brief omitted the trailing two. Mapping built from the source. |

Ruled out with reason:

- **Data corruption in the repo worktree** — no repo file was opened for writing; only this
  evidence file was created inside the worktree.
- **Secret leakage** — the token is read inside `fetch_data.py` and never printed; no query text
  or token appears in the rendered HTML or this file.
- **Regression of existing cards** — no existing card markup, view-model key, or palette constant
  was altered; the only shared-surface change is `body{height}`, which was re-measured for the
  whole page (not just the new card) in both states.
- **Concurrency with the sibling worker** — `scripts/fetch_data.py` was read only, never written.

## Cleanup receipt

Deleted: `/tmp/t8-data`, `/tmp/t8-synth`, `/tmp/t8-adv`, `/tmp/t8-crops`, `/tmp/t8-fetch.log`,
`/tmp/t8-growth.log` (all scratch data dirs, probe HTML, probe PNGs and logs).
Retained deliberately: `/Users/yeongyu/.agents/skills/omo-native-telemetry/.qa/task-8/` (the four
crops + two full renders referenced above) — outside both /tmp and the repo worktree.
Headless Chrome: every invocation was a one-shot `--screenshot` run that exits on its own; a
`pgrep -f "Google Chrome.*headless"` sweep after cleanup returned no processes.

## Risks / follow-ups

1. ~~**`scripts/run_dashboard.py` still renders at `--window-size=1080,2150`** (line 61), which was
   already stale against the old 2580px body and is now 910px short. The one-shot pipeline will
   silently ship a clipped PNG to Discord. That file is OUTSIDE this task's declared scope so it
   was NOT edited — it needs a one-line fix to 3060, ideally by reading the height out of the CSS
   instead of hardcoding it a third time.~~
   **RESOLVED — no longer a risk.** The defect was real when this file was first written. It was
   handed to a separate lane, fixed there, and verified; see the "run_dashboard height derivation
   fix" section below and the re-confirmation in "todo 8 reopen". `run_dashboard.py` now parses
   the height out of the generated CSS (line 59) and passes it to Chrome (line 68), so the
   hardcoded constant is gone (`grep -c 2150` → 0) and a real `--no-upload` run reports
   `"render_height": 3060` with exit 0. The Discord pipeline does NOT ship a clipped PNG today.
   Recorded rather than deleted so the history stays honest.
2. The populated card's height is data-dependent (headline wrap). The current 44.5px margin holds
   for the values probed; a substantially longer headline (e.g. 10-digit round-trip counts) could
   wrap further. The SKILL.md procedure tells the next editor to re-measure with real data once
   `parallelism_summary` is actually flowing.
3. `parallelism_daily` is fetched but unused by any card — it exists for future trend work. Not a
   defect, but a reader may wonder why the JSON is written and never read.
4. `unified_model.build_model` still hardcodes calendar dates (`dau["2026-08-13"]`, the 8/12
   cohort). Pre-existing, untouched, and it will break the whole build once those dates age out of
   the query window.

## run_dashboard height derivation fix

**Defect:** `run_dashboard.py` hardcoded `--window-size=1080,2150` while `build_unified.py` declares `body{ ... height:3060px }` (confirmed at line 134), silently shipping a PNG clipped by 910px.

**Fix (diff, file outside git repo):**

```diff
--- a/scripts/run_dashboard.py
+++ b/scripts/run_dashboard.py
@@
-    png = datadir / "dash_unified.png"
-    rc, _ = sh(
-        f'"{CHROME}" --headless=new --disable-gpu --hide-scrollbars '
-        f'--force-device-scale-factor=2 --window-size=1080,2150 '
+    html = (datadir / "index_unified.html").read_text()
+    m = re.search(r"body\s*\{[^}]*?height:(\d+)px", html)
+    if not m:
+        fail("render_height", 1, f"no body height found in {datadir}/index_unified.html")
+    height = int(m.group(1))
+    out["render_height"] = height
+
+    png = datadir / "dash_unified.png"
+    rc, _ = sh(
+        f'"{CHROME}" --headless=new --disable-gpu --hide-scrollbars '
+        f'--force-device-scale-factor=2 --window-size=1080,{height} '
```

**Commands:**

```
cd .../scripts && python3 fetch_data.py /tmp/rd-qa
cd .../scripts && uv run --with numpy --with polars --with scipy python3 growth_analysis.py /tmp/rd-qa
cd .../templates && python3 build_unified.py /tmp/rd-qa     # -> html written; body height:3060px
cd .../scripts && python3 run_dashboard.py --data-dir /tmp/rd-qa --no-upload
sips -g pixelWidth -g pixelHeight /tmp/rd-qa/dash_unified.png
```

**Resolved height (verbatim from pipeline JSON):** `"render_height": 3060`

**PNG dimensions (verbatim):**

```
/private/tmp/rd-qa/dash_unified.png
  pixelWidth: 2160
  pixelHeight: 6120
```

6120 = 3060 x 2 (`--force-device-scale-factor=2`) — matches the CSS height, not the stale 2150 (which would have given 4300).

**Negative test (HTML with no parseable height, verbatim):**

```
{"error": true, "step": "render_height", "rc": 1, "detail": "no body height found in /tmp/rd-neg/index_unified.html"}
exit=1
```

Fails loudly via the script's existing `fail()` — no silent fallback constant.

**Result: PASS** — render height derives from the generated HTML (3060), PNG is 2160x6120, missing-height case errors out with exit 1 and a clear message.

---

## todo 8 reopen — adversarial verifier `needs-fix`

Reopened after an independent verifier returned `needs-fix`. The data path passed every attack it
ran (13/13 column mapping verified twice including a 101-113 sentinel render, heights reproduced at
2974/3022, zero `None`/`null`, honesty labels correct on screen, all four ratios fleet sum/sum,
every SKILL.md formula claim matched against the repo). Two defects were upheld and are fixed here.

### Defect 1 (blocking) — stale copy shipped in the same image

`build_unified.py:188` still rendered "일반 툴콜/eval 병렬도는 여전히 미계측" (tool-call/eval
parallelism is still uninstrumented) on the **병렬 실행 × 캐시** card, roughly 600px directly ABOVE
the new card that instruments exactly that. I had corrected the equivalent claim in SKILL.md and
missed the pixels. Two statements in one image contradicted each other.

**Copy diff** (`templates/build_unified.py`, the `병렬 실행 × 캐시` card footnote):

```diff
-    <div class="cs" style="margin:10px 0 0">일반 툴콜/eval 병렬도는 여전히 미계측 — 아래 절감치는 위임 배치만의 하한</div></div>
+    <div class="cs" style="margin:10px 0 0">이 카드의 병렬도는 위임 배치 비율 대리치 · 바로 아래 절감치도 위임 배치만의 하한이고, 일반 툴콜/eval 병렬도는 맨 아래 실측 스팬 카드에서 직접 측정</div></div>
```

The nuance is preserved rather than deleted. The new sentence states three distinct things:
this card's parallelism figure is a **delegation-batch-share proxy** (`batch_size_bucket`
cross-section); the savings card immediately below is a **lower bound** derived from same-second
`delegation_started` grouping; and general tool-call/eval parallelism is **directly measured** in
the span-based card at the bottom. Nothing claims the new card supersedes the old one.

`미계측` no longer appears in either rendered HTML:

```
$ grep -c "미계측" /tmp/t8r-data/index_unified.html /tmp/t8r-synth/index_unified.html
/tmp/t8r-data/index_unified.html:0
/tmp/t8r-synth/index_unified.html:0
```

### Re-render commands

```
$ cd .../scripts && python3 fetch_data.py /tmp/t8r-data
fetch EXIT=0   (parallelism: 1 rows, parallelism_daily: 0 rows)
$ cat /tmp/t8r-data/parallelism.json
[[0, null, null, null, null, null, null, null, null, null, null, null, null]]

$ cd .../scripts && uv run --with numpy --with polars --with scipy python3 growth_analysis.py /tmp/t8r-data
growth EXIT=0   (OK growth_stats.json written)

$ cd .../templates && python3 build_unified.py /tmp/t8r-data   -> html written 12603
$ cd .../templates && python3 build_unified.py /tmp/t8r-synth  -> html written 12521
   (/tmp/t8r-synth = same synthetic payload as the original run: 412 sessions, 9,134 round trips,
    4.812e6 ms modeled, 51,204/7,318 waves, 21,940 joined, 1,842/963 eval, 217/4/38 quality)

$ "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
    --hide-scrollbars --force-device-scale-factor=2 --window-size=1080,3060 \
    --screenshot=/tmp/t8r-data/dash_nodata.png "file:///tmp/t8r-data/index_unified.html"
1070473 bytes written
$ ... --screenshot=/tmp/t8r-synth/dash_synth.png "file:///tmp/t8r-synth/index_unified.html"
1094722 bytes written
```

### Height re-measurement (copy edit wraps one extra line)

The replacement sentence is longer and wraps to an additional line, so both states were
re-measured at an oversized window (DPR 1, scan rows from the bottom) before trusting 3060:

| State | Content bottom BEFORE reopen | AFTER copy edit | Slack under 3060 |
|---|---|---|---|
| no-data | 2974 | **2988** | 72 |
| populated (synthetic) | 3022 | **3036** | 24 |

Final rendered margins at `body{height}:3060px` (DPR 2 scan): no-data content bottom 2981.0 CSS
(margin 79.0), populated 3029.0 CSS (margin 31.0). The taller populated state still clears the
canvas, so **height stays 3060** as instructed — no change was needed.

### Crops viewed

| Path | What I observed |
|---|---|
| `~/.agents/skills/omo-native-telemetry/.qa/task-8-reopen/contradiction_nodata.png` | The money crop: spans the **병렬 실행 × 캐시** card (top right, carrying the corrected footnote), the **병렬 툴콜링 절감 — 시리얼 실행 반사실** delegation card, and the new **네이티브 툴콜 병렬도 — 실측 스팬 기반** card, all in one view. The footnote now reads "이 카드의 병렬도는 위임 배치 비율 대리치 · 바로 아래 절감치도 위임 배치만의 하한이고, 일반 툴콜/eval 병렬도는 맨 아래 실측 스팬 카드에서 직접 측정". No "미계측" anywhere. The three statements are mutually consistent: proxy → lower bound → direct measurement. PASS. |
| `~/.agents/skills/omo-native-telemetry/.qa/task-8-reopen/contradiction_synth.png` | Same region in the populated state. Corrected footnote identical; the new card below now shows "모델 추정 절감 1.3시간 · 라운드트립 9,134회" with eval buckets 1,842 / 963 split out. A reader sees the proxy card and the direct-measurement card side by side with no contradiction. PASS. |
| `~/.agents/skills/omo-native-telemetry/.qa/task-8-reopen/bottom_nodata.png` | Bottom 800 CSS px, no-data. Footer renders both lines completely with clear background below. No clipping. PASS. |
| `~/.agents/skills/omo-native-telemetry/.qa/task-8-reopen/bottom_synth.png` | Bottom 800 CSS px, populated (the taller, 31px-slack state). Footer both lines fully rendered. No clipping. PASS. |

Full-page renders also persisted at `.qa/task-8-reopen/dash_nodata.png` / `dash_synth.png`.

Residual `none` check: `grep -io "none\|null"` returns exactly 1 hit per file, and it is the
sparkline's `fill="none"` SVG attribute (`... 640.0,76.9" fill="none" stroke="#141413" ...`), not
rendered text. Both crops were inspected visually and contain no `None`/`null`/`NaN` glyphs.

### Defect 2 (evidence accuracy) — corrected run_dashboard status

Risk #1 in the "Risks / follow-ups" section above has been struck through and annotated in place
rather than deleted, so the record shows the defect was genuinely found, handed to a separate lane,
fixed there, and independently verified.

Verified current state, read-only (this task did NOT modify the file):

```
$ shasum -a 1 scripts/run_dashboard.py
45157b5b266c48e79e0c593cf128e7f35cdba363  run_dashboard.py     # matches the verifier's pin

$ grep -c 2150 scripts/run_dashboard.py
0

$ grep -n "render_height\|window-size" scripts/run_dashboard.py
61:        fail("render_height", 1, f"no body height found in {datadir}/index_unified.html")
63:    out["render_height"] = height
68:        f'--force-device-scale-factor=2 --window-size=1080,{height} '

$ python3 run_dashboard.py --data-dir /tmp/t8r-pipe --no-upload
  "queries": 41,
  "stats": { "n_users": 683, "gini": 0.743, "top10_share": 57.8, ... },
  "render_height": 3060,
  "png": "/tmp/t8r-pipe/dash_unified.png",
  "discord": { "skipped": true }
PIPELINE EXIT=0
```

The height is parsed from the generated CSS at line 59 and passed to Chrome at line 68. The Discord
pipeline does not ship a clipped PNG today.

### Reopen cleanup receipt

Deleted: `/tmp/t8r-data`, `/tmp/t8r-synth`, `/tmp/t8r-pipe`, `/tmp/t8r-crops`, `/tmp/t8r-fetch.log`,
`/tmp/t8r-growth.log` (scratch dirs, probe HTML, probe PNGs, logs).
Retained deliberately: `~/.agents/skills/omo-native-telemetry/.qa/task-8-reopen/` (four crops + two
full renders) — outside both /tmp and the repo worktree.
Headless Chrome: all invocations were one-shot `--screenshot` runs plus the `--no-upload` pipeline,
each exiting on its own; `pgrep -f "Applications/Google Chrome.app.*headless"` returns nothing.

Constraints honored: no install command run; nothing inside the git repo touched except this
evidence file; `run_dashboard.py` not modified (sha1 unchanged at `45157b5b`); height left at 3060.

**Reopen result: PASS** — the contradictory line is gone, the two cards' statements agree in a
single viewed crop, both states re-render with an intact footer, and the evidence now states the
resolved run_dashboard fact.
