# Adversarial verification — todo 8 (dashboard card + skill docs)

Verifier: independent (did NOT implement todo 8). Task `st_01a009cc`, depth 1.
No skill file and no repo file was modified. Only this verdict file was written.

```
AdversarialVerify
verdict: needs-fix
evidence: see "Commands run" below — every claim here is backed by a command I ran and a
          render I looked at. Column mapping verified programmatically AND by sentinel render.
          Both states rendered at DPR2/3060 and inspected. Heights measured independently.
repro:    DEFECT-1 (stale on-screen copy contradicting the new card):
            cd ~/.agents/skills/omo-native-telemetry/templates && grep -n "여전히 미계측" build_unified.py
            -> line 188 renders "일반 툴콜/eval 병렬도는 여전히 미계측" ~600px ABOVE the new card
               that instruments exactly that. Visually confirmed on screen in both states.
          DEFECT-2 (evidence file states a fact that is false):
            grep -n "window-size" ~/.agents/skills/omo-native-telemetry/scripts/run_dashboard.py
            -> line 68 uses --window-size=1080,{height}; height is parsed from the CSS at :59.
               There is no 2150 anywhere: grep -c 2150 run_dashboard.py -> 0.
confidence: 0.93
```

`confirmed` withheld for todo 8 on two grounds: one shipped-pixel copy contradiction (DEFECT-1)
and one false statement in the task-8 evidence file's Risks section (DEFECT-2). Everything the
author claimed about the DATA path — column mapping, gating, ratios, honesty labels, eval
separation, heights — I independently reproduced and it is correct.

---

## 1. Column mapping, position by position — PASS (13/13)

Extracted the SELECT list of the `parallelism` query from `scripts/fetch_data.py:69` by
top-level comma split (paren-depth aware), zipped against `PARALLELISM_COLS` from
`templates/unified_model.py:12-16`.

| idx | query column (alias) | model label | match |
|---|---|---|---|
| 0 | `count() sessions` -> `sessions` | `sessions` | match |
| 1 | `sum(toFloat(properties.non_eval_saved_round_trips)) saved_round_trips` | `saved_round_trips` | match |
| 2 | `sum(toFloat(properties.modeled_wallclock_saved_ms)) modeled_saved_ms` | `modeled_saved_ms` | match |
| 3 | `sum(toFloat(properties.non_eval_waves_total)) waves_total` | `waves_total` | match |
| 4 | `sum(toFloat(properties.non_eval_waves_multi)) waves_multi` | `waves_multi` | match |
| 5 | `sum(toFloat(properties.non_eval_joined_calls)) joined_calls` | `joined_calls` | match |
| 6 | `sum(toFloat(properties.eval_only_waves)) eval_only_waves` | `eval_only_waves` | match |
| 7 | `sum(toFloat(properties.mixed_waves)) mixed_waves` | `mixed_waves` | match |
| 8 | `sum(toFloat(properties.incomplete_calls)) incomplete_calls` | `incomplete_calls` | match |
| 9 | `sum(toFloat(properties.clock_anomalies)) clock_anomalies` | `clock_anomalies` | match |
| 10 | `sum(toFloat(properties.dropped_calls)) dropped_calls` | `dropped_calls` | match |
| 11 | `sum(toFloat(properties.measured_turn_duration_ms_total)) measured_turn_ms` | `measured_turn_ms` | match |
| 12 | `sum(toFloat(properties.upper_bound_saved_ms)) upper_bound_saved_ms_ref` | `upper_bound_saved_ms_ref` | match |

Query returns **13** columns; `PARALLELISM_COLS` has **13**. The author's correction of the
briefing's "11 columns" is CORRECT — `measured_turn_ms` and `upper_bound_saved_ms_ref` really do
trail the list, and every alias matches its model label at the same index. **Zero off-by-one.**

### Sentinel render check (the real test) — PASS

Injected `[[101,102,103,104,105,106,107,108,109,110,111,112,113]]` (one distinct sentinel per
column, in query order), rebuilt, rendered at DPR2/3060, and read the numbers off the PNG:

| sentinel | query column | where it appeared on screen | verdict |
|---|---|---|---|
| 101 | sessions | `세션 101개` | correct |
| 102 | saved_round_trips | `라운드트립 102회` | correct |
| 103 | modeled_saved_ms | headline `모델 추정 절감 0.1초` (=103ms) | correct |
| 104 | waves_total | `non_eval 웨이브 104개`, denominator of `105/104개` | correct |
| 105 | waves_multi | numerator of `105/104개` (=101%) | correct |
| 106 | joined_calls | `총 106콜` | correct |
| 107 | eval_only_waves | kvrow `eval 단독 웨이브 107개` | correct |
| 108 | mixed_waves | kvrow `eval 혼합 웨이브 108개` | correct |
| 109 | incomplete_calls | `미완결/시계이상/드롭 콜 109 · 110 · 111` (1st) | correct |
| 110 | clock_anomalies | same row, 2nd | correct |
| 111 | dropped_calls | same row, 3rd | correct |
| 112 | measured_turn_ms | `측정 턴 0.1초`; ratio 103/112 rendered as `92.0%` | correct |
| 113 | upper_bound_saved_ms_ref | `상한 참고치 (상한, 헤드라인 아님) 0.1초` | correct |

Derived sanity: eval bucket headline showed `215개` = 107+108 exactly; `1.01개` = 106/105;
`101%` = 105/104. Every arithmetic relation is consistent with the correct column assignment.
A single-position shift would have broken at least three of these. **No mislabel.**

## 2. Both render states, independently measured — PASS

Built my own dirs from a live fetch (41 JSONs, EXIT=0). Real production `parallelism.json` today
is `[[0,null,null,null,null,null,null,null,null,null,null,null,null]]` and
`parallelism_daily.json` is `[]` — exactly the one-row-of-nulls trap the code gates on.

Oversized probe at `--force-device-scale-factor=1 --window-size=1080,4200` with `body{height}`
raised to 4200, then a bottom-up pixel scan (background `#f5f4ed`, tolerance 6, every 2nd column):

| state | last non-background row (0-idx) | content bottom | margin at 3060 |
|---|---|---|---|
| no-data (real fetch) | 2973 | **2974px** | 86px |
| populated (synthetic) | 3021 | **3022px** | **38px** |

This reproduces the author's 2973 / 3021 figures to the pixel. The populated card IS ~48px taller
(headline wraps to two lines once real numbers arrive) — the clipping risk they describe is real,
and 3060 covers the taller state. 2580 would have clipped by 442px; 3000 would have clipped the
populated footer by 22px. Their claimed final margins (92.5 / 44.5) are ~6px more generous than
mine, likely a different background tolerance; the ordering and the conclusion are identical.

Rendered both at the declared `--window-size=1080,3060 --force-device-scale-factor=2` and looked
at the crops:
- **No-data**: headline `모델 추정 절감 수집 대기` (STONE placeholder), three zero bars reading
  `수집 대기`, right card `eval 버킷 수집 대기` with all four kvrows `수집 전`. Footer both lines
  fully rendered with clear space below.
- **Populated**: `모델 추정 절감 1.3시간 · 라운드트립 9,134회` (wrapped to 2 lines),
  `14% · 7,318/51,204개`, `3.00개 · 총 21,940콜`, `6.7% · 측정 턴 19.9시간`, right card
  `eval 버킷 2,805개` / `1,842개` / `963개` / `5.4시간` / `217 · 4 · 38`. Footer both lines
  fully rendered with clear space below.

`None`/`null`/`undefined`/`NaN` in **visible text** (tags stripped): zero hits in all three
states. The only raw-HTML `none` is the sparkline `fill="none"` SVG attribute — not text.

## 3. Honesty labels on screen — PASS

Read off the rendered PNG, not the source:
- Headline literally reads **`모델 추정 절감`** (= modeled estimate) immediately before the value.
  Sub-line repeats `측정된 벽시계 시간이 아니라 모델 추정치` (not measured wall time, a modeled
  estimate). Row 3 label is `턴 측정시간 대비 모델 추정 절감`. Nothing anywhere presents the
  savings as measured wall time.
- `upper_bound_saved_ms` appears ONLY as a secondary kvrow in the right card, labelled
  **`상한 참고치 (상한, 헤드라인 아님)`** — "upper-bound reference (upper bound, not a headline)".
  It is never a headline in either state.

## 4. Eval bucket separation on screen — PASS

- `eval 단독 웨이브` and `eval 혼합 웨이브` are two SEPARATE kvrows. Their sum (`eval_bucket_waves`)
  is the right card's own headline and is never added to `waves_total` / `joined_calls` — verified
  by the sentinel run: with eval=107/108 the non_eval denominators stayed 104/105/106.
- On-screen exclusion statement present: `eval/코드모드 웨이브는 의도적으로 병렬도 수치에서
  제외하고 별도 집계` (eval/codemode waves are deliberately excluded from the parallelism figures
  and counted separately).
- Pre-existing delegation-batch card `병렬 툴콜링 절감 — 시리얼 실행 반사실` (`parallel_savings`)
  is still present, unchanged, and distinguishable: the new card carries the footnote
  `위 카드의 위임 배치 절감은 동일초 디스패치로 추정한 하한, 이 카드는 툴콜별 실측 시각으로 계산한
  직접 측정치` (the card above is a lower bound inferred from same-second dispatch; this card is a
  direct measurement from per-call observed times).

## 5. No ratio averaging — PASS

Every division inside `build_parallelism`:
```
"multi_share":       n["waves_multi"] / waves_total * 100          if waves_total else 0.0
"calls_per_multi_wave": joined / n["waves_multi"]                   if waves_multi  else 0.0
"modeled_saved_per_session_ms": n["modeled_saved_ms"] / sessions    (sessions>0 guaranteed by gate)
"saved_share_of_turn": n["modeled_saved_ms"] / n["measured_turn_ms"] * 100 if measured else 0.0
```
All numerators and denominators are fleet `sum()` aggregates from the query. There is no
per-session ratio anywhere in the query or the view model, so a mean-of-ratios is structurally
impossible. Every divisor is guarded — no ZeroDivisionError path exists.

## 6. Robustness — MOSTLY PASS (2 crash classes, both pre-existing and non-regressive)

| probe | result |
|---|---|
| `rm parallelism.json` | rc=0, `html written 12559`, placeholder path, no traceback in HTML |
| `rm parallelism_daily.json` | rc=0, `html written 12559` |
| both deleted | rc=0, `html written 12559` |
| `[[5,1,2]]` (3 cols, too few) | rc=0, `html written 12431` — `zip` truncates, missing keys default to 0 |
| 16 cols (too many) | rc=0, `html written 12439` — extras dropped by `zip` |
| `[]` (empty array) | rc=0, placeholder path |
| `[[7,null×12]]` (sessions=7, all metrics null) | rc=0, renders real zeros, no `None` |
| **string where a number belongs** `["7","abc",...]` | **rc=1 `ValueError: could not convert string to float: 'abc'`** |
| **malformed JSON** `{oops` | **rc=1 `json.decoder.JSONDecodeError`** |
| **malformed `parallelism_daily.json`** | **rc=1 `JSONDecodeError`** |

Severity assessment (why this is not the blocker): both crash classes are **pre-existing
whole-module behavior, not introduced by todo 8**. I reproduced identical crashes by corrupting
the untouched `headline.json`:
- `echo 'not json' > headline.json` -> same `JSONDecodeError` (module-wide `json.loads` in
  `build_model`'s dir glob).
- `[["abc",1,2,3]]` -> same `ValueError: could not convert string to float: 'abc'`.

Critically: **no HTML file is written when the build crashes** (verified — `index_unified.html`
absent after the ValueError run), so **no stack trace can ever reach the HTML**. The requirement
"must not print stack traces into the HTML" is satisfied unconditionally. The build simply exits
non-zero, and `run_dashboard.py` fails fast at `fail("build_unified", ...)`.

## 7. Docs accuracy — PASS (every formula checks out against the repo)

| SKILL.md claim | repo source | verdict |
|---|---|---|
| `modeled_wallclock_saved_ms = Σdᵢ − span`, `span = maxEnd − minStart` | `savings-math.ts:modeledWallClockSavedMs` -> `sum(durations) - wave.spanMs`; `wave-assembler.ts:130` `spanMs: maxEnd - minStart` | exact |
| `max(dᵢ)` overstates 4.5x on chained A(0-5)/B(4-9)/C(8-12) | recomputed: Σd=14, span=12 -> saved 2; Σd−max(d)=9; 9/2 = **4.5** | exact |
| `span == max(d)` for true simultaneous batches | stated identically in `savings-math.ts` header comment | exact |
| `savedRoundTrips = Σ max(maxConcurrency−1, 0)`, not `N−1` | `savings-math.ts:savedRoundTrips` -> `Math.max(wave.maxConcurrency - 1, 0)`; `wave-assembler.ts:131` `sweepMaxConcurrency(calls)` | exact |
| `upper_bound_saved_ms = (N−1) × mean(d)` | `savings-math.ts:upperBoundSavedMs` -> `(durations.length - 1) * mean` | exact |
| eval filtering inflates: 1.20s -> 0.70s | `eval-classifier.ts:4` comment states exactly "measured: 1.20s reported as 0.70s"; `eval-classifier.test.ts:38,77-78` uses those literals | exact |
| 8 positional buckets `1,2,3,4,5_8,9_16,17_32,33plus`, `:`-joined, no labels | `eval-classifier.ts:30-31` `WAVE_SIZE_BUCKET_MAXIMA = [1,2,3,4,8,16,32]`, `+1`; `:80` `histogram.join(":")`; test asserts `not.toContain("=")` | exact |
| 64-char truncation; labelled = 69 chars, positional = 39 | `telemetry-core/src/events.ts:125` `value.slice(0, 64)`; worst-case positional `2000:...×8` = **39**; worst-case labelled `1=2000:...:33plus=2000` = **69** | exact |
| `MAX_TRACKED_CALLS = 2000` | `wave-assembler.ts:16` | exact |
| `clock_anomalies` = `endMs < startMs`, monotonicity not assumed | `savings-math.ts:usableDurations` `if (call.endMs < call.startMs) continue` | exact |
| zero-data = one row of nulls, `parallelism_daily` = `[]` | reproduced on live fetch | exact |
| Event schema row + `(8 events)` | `parallelism_summary` row present, all properties listed, count updated 7->8 | correct |
| `parallel_savings` must be labelled a LOWER BOUND, and is not `eval`/tool-call parallelism "which `parallelism_summary` (below) measures directly" (`SKILL.md:114-115`) | doc updated correctly — **but the rendered card copy was NOT**, see DEFECT-1 | doc ok / render stale |
| Height procedure + "measure the TALLEST variant" (2967 empty vs 3021 populated) | present in the render section; my measurements 2974 / 3022 confirm the ordering and the lesson | correct |

No doc statement contradicts the implementation.

## 8. `scripts/run_dashboard.py` window size — the author's flagged risk is FALSE

The task-8 evidence file, Risks item 1, states:

> `scripts/run_dashboard.py` still renders at `--window-size=1080,2150` (line 61) ... The one-shot
> pipeline will silently ship a clipped PNG to Discord.

**This is not true.** Established facts:

```
$ grep -c 2150 ~/.agents/skills/omo-native-telemetry/scripts/run_dashboard.py
0
$ grep -n "window-size" .../run_dashboard.py
68:        f'--force-device-scale-factor=2 --window-size=1080,{height} '
```

`run_dashboard.py:58-62` READS the height out of the generated CSS
(`re.search(r"body\s*\{[^}]*?height:(\d+)px", html)`) and feeds it to Chrome; line 61 is the
`fail("render_height", ...)` branch, not a hardcoded size. End-to-end proof — I ran the real
pipeline:

```
$ python3 run_dashboard.py --data-dir /tmp/vt8-pipeline --no-upload
{ ... "render_height": 3060, "png": "/tmp/vt8-pipeline/dash_unified.png",
  "discord": {"skipped": true} }   EXIT=0
```

**Plain statement: the one-shot Discord pipeline would NOT ship a clipped PNG today.** It renders
at exactly 3060, the same value the template declares.

### Live-edit observed during verification (disclosed, not a defect)

`run_dashboard.py` changed underneath me mid-session: at ~17:53 it was 4388 bytes with regex
`body\{[^}]*?height:(\d+)px`, which does NOT match the emitted CSS (`body { ` has a space) — that
version would have hit `fail("render_height")` and aborted the pipeline before rendering. At
17:56:11 it became 4391 bytes with `body\s*\{...`, which matches and yields 3060. I verified both:

```
old regex body\{      -> None          (pipeline would have exited 1)
new regex body\s*\{   -> 3060          (verified by the live --no-upload run above)
```

The file's current on-disk state is correct. Flagging only because another worker is editing this
skill concurrently and my item-8 verdict is pinned to the 17:56 state (sha1
`45157b5b266c48e79e0c593cf128e7f35cdba363`).

---

## DEFECTS (why not `confirmed`)

### DEFECT-1 — todo 8 ships a card that contradicts the card two rows above it (shipped pixels)

`templates/build_unified.py:188`, in the pre-existing `병렬 실행 × 캐시` card, still renders:

> **일반 툴콜/eval 병렬도는 여전히 미계측 — 아래 절감치는 위임 배치만의 하한**
> ("general tool-call/eval parallelism is still UNINSTRUMENTED — the savings below are a
> delegation-batching-only lower bound")

I cropped and looked at this on the DPR2/3060 render: it sits roughly 600 CSS px directly above
the new `네이티브 툴콜 병렬도 — 실측 스팬 기반` card, which instruments exactly that. One image now
asserts both "tool-call/eval parallelism is not instrumented" and "here is the measured tool-call
parallelism". The author updated the equivalent sentence in `SKILL.md:114-115` (correctly
retargeted to "which `parallelism_summary` (below) measures directly") but left the on-screen
copy stale — the fix was applied to the doc and not to the pixels. This is a one-line copy change
in the same file todo 8 already edited, and it is squarely inside todo 8's scope
("대시보드 카드 + 문서 반영"). Not a data-integrity bug; a credibility bug in the deliverable.

### DEFECT-2 — the task-8 evidence file records a false fact as a shipped risk

Risks item 1 (quoted above) asserts a hardcoded `--window-size=1080,2150` at line 61 and predicts
a clipped Discord PNG. Neither is true of the file as it stands (item 8 above, with the live
pipeline run returning `render_height: 3060`). An evidence file that hands the next engineer a
fabricated follow-up is a defect in the evidence, and it is the one item the brief asked me to
establish as fact. Correcting the Risks section is sufficient.

## What is NOT a defect

- Column mapping: perfect, 13/13, confirmed twice (static + sentinel render).
- `sessions == 0` gate: correct, and the live all-null row exercises it.
- Heights: 3060 is right, independently re-measured, and the populated-state clipping the author
  describes is a real hazard they genuinely caught.
- Honesty labels, eval separation, sum/sum ratios: all correct on screen.
- The two build crashes: pre-existing module behavior, reproduced identically on untouched files,
  and no stack trace ever reaches the HTML.
- `parallelism_daily` fetched but unrendered: dead-ish data, not a defect.

## Commands run (abridged to the load-bearing ones)

```
python3 <paren-aware SELECT splitter> comparing fetch_data.py:69 vs PARALLELISM_COLS   -> 13/13 match
cd .../scripts && python3 fetch_data.py /tmp/vt8-nodata                                -> EXIT=0, 41 json
uv run --with numpy --with polars --with scipy python3 growth_analysis.py /tmp/vt8-nodata -> EXIT=0
cat /tmp/vt8-nodata/parallelism.json  -> [[0,null,null,null,null,null,null,null,null,null,null,null,null]]
cat /tmp/vt8-nodata/parallelism_daily.json -> []
cd .../templates && python3 build_unified.py /tmp/vt8-nodata     -> html written 12559, EXIT=0
                    python3 build_unified.py /tmp/vt8-sentinel   -> html written 12462, EXIT=0
                    python3 build_unified.py /tmp/vt8-synth      -> html written 12477, EXIT=0
Chrome --headless=new --force-device-scale-factor=1 --window-size=1080,4200 (height patched to 4200)
  bottom-up pixel scan -> nodata last row 2973 (bottom 2974); synth last row 3021 (bottom 3022)
Chrome --headless=new --force-device-scale-factor=2 --window-size=1080,3060 (both states + sentinel)
  crops read visually: card top, card bottom, footer, stale-caption region
visible-text regex (?i)\b(none|null|undefined|nan)\b after stripping tags -> 0 hits in all 3 states
robustness matrix: rm / [] / [[5,1,2]] / 16-col / [[7,null*12]] / "abc" / {oops / bad daily
control:   corrupt untouched headline.json the same two ways -> identical crashes (pre-existing)
python3 run_dashboard.py --data-dir /tmp/vt8-pipeline --no-upload -> "render_height": 3060, EXIT=0
grep -c 2150 run_dashboard.py -> 0 ; grep -n window-size -> line 68 uses {height}
repo doc cross-check: savings-math.ts, wave-assembler.ts:16/130/131, eval-classifier.ts:4/30-31/80,
  eval-classifier.test.ts:38/77-78/87-92, telemetry-core/src/events.ts:125
python3 length checks: positional worst case 39 chars, labelled worst case 69 chars
```

## Cleanup receipt

Deleted: `/tmp/vt8-nodata`, `/tmp/vt8-synth`, `/tmp/vt8-sentinel`, `/tmp/vt8-rb`,
`/tmp/vt8-pipeline`, and all `/tmp/vt8-*.png` crops. `ls -d /tmp/vt8*` -> "No such file or
directory". Every headless Chrome invocation was a one-shot `--screenshot` that self-exits;
`pgrep -f headless | wc -l` -> **0**. The one live Chrome (PID 39647) started Fri Aug 14 12:08,
long before this session, and was left alone. No pre-existing `/tmp` entry was touched. No skill
file and no repo file was modified — this verdict file is the only write.
