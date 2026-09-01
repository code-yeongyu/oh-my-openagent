# Adversarial verification — todo 8 REPAIR (independent re-verify)

**Verifier session**: st_01a009d7 (parent 01a00933-a889-7889-b272-c711e52d2530, depth 1)
**Date**: 2026-08-16
**Mode**: read-only on all files under verification. No skill file, template, script or repo file
was modified. Only this verdict file was written inside the repo worktree.

```
AdversarialVerify
verdict: confirmed
evidence: see "Commands run" below — every claim re-derived first-hand, not read from the transcript
repro: n/a (no defect found; the two residual observations in "Non-blocking observations" are
       documentation-only and already recorded in the author's own risk list)
confidence: 0.92
```

---

## 1. The contradiction, checked in PIXELS

Rendered BOTH states myself from a fresh fetch (not the author's scratch dirs, which were deleted).

```
$ cd ~/.agents/skills/omo-native-telemetry/scripts && python3 fetch_data.py /tmp/av8-data
  ... 41 json files, real 0m7.911s, FETCH_EXIT=0
$ cat /tmp/av8-data/parallelism.json
[[0, null, null, null, null, null, null, null, null, null, null, null, null]]
$ cat /tmp/av8-data/parallelism_daily.json
[]
$ uv run --with numpy --with polars --with scipy python3 growth_analysis.py /tmp/av8-data
  PARALLEL x CACHE (users delegs>=3, n=433): rho=0.197 p=4e-05 | cache 87.0% vs 82.7%
  OK growth_stats.json written                                     GROWTH_EXIT=0
```

Synthetic populated payload injected into `/tmp/av8-synth` (my own, same shape as the author's:
412 sessions, 9,134 round trips, 4.812e6 ms modeled, 51,204/7,318 waves, 21,940 joined,
1,842/963 eval, 217/4/38 quality, 7.15e7 ms measured turn, 1.94e7 ms upper bound).

```
$ cd ~/.agents/skills/omo-native-telemetry/templates
$ python3 build_unified.py /tmp/av8-data    -> html written 12604
$ python3 build_unified.py /tmp/av8-synth   -> html written 12522

$ grep -c "미계측" /tmp/av8-data/index_unified.html /tmp/av8-synth/index_unified.html
/tmp/av8-data/index_unified.html:0
/tmp/av8-synth/index_unified.html:0

$ grep -rn "미계측" ~/.agents/skills/omo-native-telemetry/ (excluding __pycache__)
(no matches, exit 1)
$ grep -c "미계측" templates/build_unified.py
0
```

`미계측` is gone from the template, from SKILL.md, and from BOTH rendered HTMLs. **Verified
independently — not taken from the transcript.**

### Crops I actually viewed

| Path | What I read in the pixels |
|---|---|
| `~/.agents/skills/omo-native-telemetry/.qa/verify-t8-repair/contradiction_data.png` (CSS y 1330–2440, no-data) | All THREE cards in one frame. **병렬 실행 × 캐시** footnote reads verbatim: "이 카드의 병렬도는 위임 배치 비율 대리치 · 바로 아래 절감치도 위임 배치만의 하한이고, 일반 툴콜/eval 병렬도는 맨 아래 실측 스팬 카드에서 직접 측정". Below it **병렬 툴콜링 절감 — 시리얼 실행 반사실** (라운드트립 30,178회 절감 · 프리픽스 3.6B 토큰 회피). Below that **네이티브 툴콜 병렬도 — 실측 스팬 기반**, headline "모델 추정 절감 수집 대기" in STONE, footnote "위 카드의 위임 배치 절감은 동일초 디스패치로 추정한 하한, 이 카드는 툴콜별 실측 시각으로 계산한 직접 측정치". **No 미계측 anywhere. No statement contradicts another.** PASS |
| `.qa/verify-t8-repair/contradiction_synth.png` (same band, populated) | Identical corrected footnote on the cache card. New card headline wraps to two lines: "모델 추정 절감 **1.3시간** · 라운드트립 9,134회". Rows: 다중 콜 웨이브 비율 14% · 7,318/51,204개; 다중 웨이브당 합류 콜 3.00개 · 총 21,940콜; 턴 측정시간 대비 모델 추정 절감 6.7% · 측정 턴 19.9시간. Right card: eval 단독 1,842개 / eval 혼합 963개 as SEPARATE rows, "상한 참고치 (상한, 헤드라인 아님) 5.4시간" as a kvrow (never a headline), 미완결/시계이상/드롭 217 · 4 · 38. PASS |
| `.qa/verify-t8-repair/bottom_data.png` (bottom 800 CSS px, no-data) | Final `.g3` row fully drawn (모델 라우팅 custom 94% / 스킬 로드 TOP 5 / 행동 시그널 + 강도 상관). Footer BOTH lines complete: "리프트 = Fisher exact + RR 95% CI + BH-FDR (전항목 q<0.001) · 상관 = Spearman(heavy-tail) · Gini = 턴 1+ 유저 기준 · 런치 코호트" / "상관관계이며 인과 아님 · 비용 및 custom 라우팅 수치는 과대 가능 · omo 실시간 집계". Clear canvas below. No clipping. PASS |
| `.qa/verify-t8-repair/bottom_synth.png` (bottom 800 CSS px, populated — the TALLER state) | Same footer, both lines complete, clear space below. This is the state with only ~31px slack and it does NOT clip. PASS |

**Result: the contradiction is genuinely gone in pixels, in both states.**

## 2. The nuance survived — three claims still distinguishable

Read off the rendered image, not the source:

| Claim | Where it appears on screen | Wording |
|---|---|---|
| **PROXY** | 병렬 실행 × 캐시 footnote | "이 카드의 병렬도는 위임 배치 비율 **대리치**" |
| **LOWER BOUND** | same footnote + new card footnote | "바로 아래 절감치도 위임 배치만의 **하한**" / "위 카드의 위임 배치 절감은 동일초 디스패치로 추정한 **하한**" |
| **DIRECT MEASUREMENT** | same footnote + new card footnote | "일반 툴콜/eval 병렬도는 맨 아래 실측 스팬 카드에서 **직접 측정**" / "이 카드는 툴콜별 실측 시각으로 계산한 **직접 측정치**" |

The three are stated with three different Korean terms (대리치 / 하한 / 직접 측정치) and the two
footnotes cross-reference each other in opposite directions, so a reader landing on either card
learns the same hierarchy. **Nothing was flattened into a vague sentence.** The author did NOT buy
the fix by deleting accuracy. SKILL.md carries the same three-way distinction in prose
(lines 94-96 proxy, line 114 "Always label this a LOWER BOUND", lines 116-118 "the DIRECT
measurement counterpart ... not a proxy"). PASS

## 3. Heights, measured independently

The CSS is `height:3060px; overflow:hidden`, so an oversized window alone does NOT reveal
overflow — I first rewrote the probe HTML to `height:4200px; overflow:visible` (probe copies only,
originals untouched), then rendered at DPR 1 and scanned rows from the bottom for the last row
differing from the canvas background `(245,244,237)`.

```
$ CHROME --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1080,4200 --screenshot=/tmp/av8-probe-{data,synth}.png \
    "file:///tmp/av8-{data,synth}/probe_unified.html"

data:  image 1080x4200 bg=(245,244,237) last_non_bg_row=2988 content_bottom=2989
synth: image 1080x4200 bg=(245,244,237) last_non_bg_row=3036 content_bottom=3037
```

| State | Author claimed | I measured | Match |
|---|---|---|---|
| no-data | 2988 | **2988** (last non-bg row) | exact |
| populated | 3036 | **3036** (last non-bg row) | exact |

Final shipped renders at `body{height}:3060`, DPR 2, scanned:

```
data  (2160x6120): DPR2 last_non_bg=5962 -> CSS 2981.5, margin 78.5 CSS px
synth (2160x6120): DPR2 last_non_bg=6058 -> CSS 3029.5, margin 30.5 CSS px
```

Author claimed 79.0 / 31.0; I get 78.5 / 30.5 — a half-pixel of scan granularity apart, i.e. the
same measurement. **3060 clears the taller (populated) state with 24 rows of slack.** CONFIRMED.

### Is ~31px slack adequate? — stress-tested rather than guessed

Rather than opine, I forced the headline to grow:

```
# 10-digit round trips
headline: 모델 추정 절감 <i>1.3시간</i> · 라운드트립 9,876,543,210회
extreme-long-number state: content_bottom=3037  (3060 slack = 23)

# absurd magnitudes on every field at once
headline: 모델 추정 절감 <i>277,777.8시간</i> · 라운드트립 9,876,543,210회
          eval 버킷 <i>222,222,221개</i>
sub:      non_eval 웨이브 999,999,999개 · 세션 999,999개 · 세션당 16.7분 · ...
absurd-max state: content_bottom=3037  (3060 slack = 23)
```

Both extremes land at **3037**, one pixel above the realistic populated state. The headline is
capped at two wrapped lines by the card width and `hms()` compresses any duration to at most
`{n,.1f}시간`, so no achievable data value adds a third line.

Cost of a hypothetical third headline line, measured by forcibly injecting extra headline text:

```
3-line headline: content_bottom=3085  vs 3060 -> CLIPS by 25
```

**Plain answer to the question asked**: a longer real *headline* cannot clip it — the data path
cannot produce one, as the two extreme-value renders show. A longer *copy edit* to the headline or
sub-line (a human adding ~a line of text) WOULD clip by ~25px. So the 31px slack is adequate against
data variation and thin against future copy edits. That is precisely risk #2 in the author's own
evidence file, which points the next editor at the re-measure procedure. Acceptable, not a defect.

## 4. `run_dashboard.py` — first-hand

```
$ shasum -a 1 ~/.agents/skills/omo-native-telemetry/scripts/run_dashboard.py
45157b5b266c48e79e0c593cf128e7f35cdba363  run_dashboard.py     # matches the pinned sha1
   (re-checked after all my runs: still 45157b5b266c48e79e0c593cf128e7f35cdba363 — untouched)

$ grep -c "2150" run_dashboard.py
0

$ grep -n "window-size\|height" run_dashboard.py
59:    m = re.search(r"body\s*\{[^}]*?height:(\d+)px", html)
61:        fail("render_height", 1, f"no body height found in {datadir}/index_unified.html")
62:    height = int(m.group(1))
63:    out["render_height"] = height
68:        f'--force-device-scale-factor=2 --window-size=1080,{height} '
```

Lines 55-70 read directly: the HTML is read at line 58, the height regex-parsed at **line 59**,
`fail()` raised at 60-61 when unparseable (no silent fallback constant), assigned at 62, exported at
63, and interpolated into the Chrome `--window-size` at **line 68**. Exactly as claimed.

Live pipeline, upload disabled:

```
$ python3 run_dashboard.py --data-dir /tmp/av8-pipe --no-upload
{
  "data_dir": "/tmp/av8-pipe",
  "channel": "1492525609778417834",
  "ts": "2026-08-16T18:19:10+0900",
  "queries": 41,
  "stats": { "n_users": 683, "gini": 0.743, "top10_share": 57.8,
             "parallel_cache_rho": 0.198, "parallel_cache_p": 3e-05,
             "lift_top": {"label": "턴 50+ 실행", "rr": 2.3, "ret_did": 88.1, "ret_not": 38.4} },
  "render_height": 3060,
  "png": "/tmp/av8-pipe/dash_unified.png",
  "discord": { "skipped": true }
}
PIPELINE_EXIT=0

$ sips -g pixelWidth -g pixelHeight /tmp/av8-pipe/dash_unified.png
  pixelWidth: 2160
  pixelHeight: 6120        # 3060 x 2 (DPR 2) — matches CSS, not the stale 2150 (would be 4300)
```

**`"render_height": 3060`, EXIT=0, sha1 unchanged.** CONFIRMED first-hand.

## 5. Evidence honesty

`task-8.md` risk #1 is `~~struck through~~` and annotated IN PLACE, not deleted. The annotation
reads "**RESOLVED — no longer a risk.** The defect was real when this file was first written. It
was handed to a separate lane, fixed there, and verified..." and ends "Recorded rather than deleted
so the history stays honest." The stated sequence (found -> real at the time -> separate lane ->
fixed -> verified) matches what I independently confirmed in §4. The original text of the finding
(including the wrong-at-the-time `--window-size=1080,2150` and the "silently ship a clipped PNG"
consequence) is still legible under the strikethrough. Nothing was quietly erased. PASS

## 6. No collateral damage (prior verification's data path still holds)

```
$ # column mapping, derived by parsing the actual query in fetch_data.py, not by reading prose
query columns: 13
  0 sessions          4 waves_multi      8 incomplete_calls   12 upper_bound_saved_ms_ref
  1 saved_round_trips 5 joined_calls     9 clock_anomalies
  2 modeled_saved_ms  6 eval_only_waves  10 dropped_calls
  3 waves_total       7 mixed_waves      11 measured_turn_ms
PARALLELISM_COLS: 13
MATCH: True
```

13/13, in exact order, positionally identical to `unified_model.PARALLELISM_COLS`.

```
$ grep -io "none\|null\|nan\|undefined" /tmp/av8-{data,synth}/index_unified.html | sort | uniq -c
   1 none      (each file)
$ grep -o '.\{30\}none.\{30\}' ...
 633.5,76.2 640.0,76.9" fill="none" stroke="#141413" stroke-widt
```

The sole hit in each file is the sparkline SVG's `fill="none"` attribute — not rendered text. Zero
`None`/`null`/`NaN` glyphs in the crops I viewed.

Honesty labels still on screen (read from `contradiction_synth.png`):
- headline labelled a model estimate: "**모델 추정** 절감 1.3시간" + sub-line "측정된 벽시계
  시간이 아니라 **모델 추정치**" + row 3 "턴 측정시간 대비 **모델 추정** 절감";
- upper bound never a headline: rendered only as a kvrow "**상한 참고치 (상한, 헤드라인 아님)**
  5.4시간" in the secondary card;
- eval buckets separate rows: "eval 단독 웨이브 1,842개" and "eval 혼합 웨이브 963개" as their own
  kvrows, never folded into `waves_total` (51,204) or `joined_calls` (21,940).

Repo untouched throughout: `git status --short` in the worktree returns EMPTY before and after all
runs (this verdict file is the only addition, written last).

## Non-blocking observations (NOT blockers, recorded for accuracy)

1. **SKILL.md:199 carries stale illustrative numbers.** It reads "the unified parallelism card:
   2967px empty vs 3021px populated" — those are the pre-reopen figures (and don't match even the
   pre-reopen 2974/3022 in the evidence table). The *normative* content of that bullet — "populated
   is taller than empty, so measure the TALLEST variant" — remains true (2988 < 3036), and the
   shipped constant at line 194 ("unified is now 3060") is correct. It is an illustrative example
   of a rule, not a value anything reads. Documentation nit only; does not affect any render.
2. **~31px populated slack is thin against future copy edits**, though not against data (§3).
   Already recorded as risk #2 in the author's evidence with the re-measure procedure pointed at
   the next editor.

Neither observation is a defect in the repair under verification, so neither blocks.

## Cleanup receipt

Deleted (all created by this session):
`/tmp/av8-data`, `/tmp/av8-synth`, `/tmp/av8-long`, `/tmp/av8-max`, `/tmp/av8-pipe`,
`/tmp/av8-crops`, and the probe PNGs `/tmp/av8-probe-data.png`, `/tmp/av8-probe-synth.png`,
`/tmp/av8-probe-long.png`, `/tmp/av8-probe-max.png`, `/tmp/av8-probe-3line.png`.
All pre-existing `/tmp` entries left untouched.

Retained deliberately, OUTSIDE both `/tmp` and the git repo:
`~/.agents/skills/omo-native-telemetry/.qa/verify-t8-repair/` — the four crops referenced above, so
the paths in this verdict resolve. This is a QA artifact directory; no skill file, template, or
script was created or modified.

Headless Chrome: every invocation was a one-shot `--screenshot` run that exits on its own, plus the
`--no-upload` pipeline. A `pgrep -f "Google Chrome.*headless"` sweep after cleanup returns nothing.
The user's pre-existing interactive Chrome (pid 39647, non-headless, started before this session)
was left alone.

## Verdict

**confirmed.** Both reopened defects on todo 8 are genuinely and completely repaired:

1. The `미계측` contradiction is gone from the template, from SKILL.md, and from both rendered
   HTMLs — verified by my own grep on my own renders, and READ in two crops spanning all three
   cards. The three cards' statements are mutually consistent AND the proxy / lower-bound / direct-
   measurement nuance is preserved with three distinct terms, not flattened.
2. `run_dashboard.py` is confirmed untouched at sha1 `45157b5b266c48e79e0c593cf128e7f35cdba363`,
   has zero occurrences of `2150`, parses the height at line 59, passes it at line 68, and a live
   `--no-upload` run reports `"render_height": 3060` with EXIT=0 and a 2160x6120 PNG.
3. Heights reproduce EXACTLY (2988 / 3036), 3060 clears the taller state, and the thin 31px
   populated slack survives every achievable data extreme I could construct.
4. The evidence file annotates rather than erases the stale risk, and states the true sequence.
5. No collateral damage: 13/13 column mapping, zero rendered `None`/`null`, honesty labels intact
   on screen, eval buckets still separate rows, repo untouched.
