## Phase 4 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Run the verification yourself in one eval cell, or spawn one verification lane per claim:

```
task(category: "deep-low", run_in_background: true, prompt: "TASK: verify by execution: <claim>.
SOURCE: <where it came from>; CONTRADICTION: <opposing source, if any>.
Write a minimal self-contained script that tests the claim; run it (uv run --with <deps> python / bun / direct compile); capture full stdout+stderr; pin versions.
Reply with: the exact code, the full output, environment (OS, runtime, dependency versions), and a verdict — CONFIRMED / REFUTED / PARTIAL — grounded in the output.")
```

Journal each verdict to `verify-<slug>.md`.

## Phase 4b — Lock non-code claims through the claim graph

Code settles code-shaped claims (Phase 4). Numeric, market-share, legal, dated, causal, and financial claims cannot be run — so they pass through a data-flow-lock instead: the synthesis may assert a high-risk non-code claim **only** if it cleared this gate, and the gate's output is the sole allowlist the synthesis draws from. Skip the gate and there is nothing to synthesize — the lock is self-enforcing.

The claim graph is orchestrator-owned. Workers only return claim candidates as message text, the same channel as EXPAND markers — never a file (except a mass-research dag node's handoff file). As leads resolve, you record one node per asserted claim in `claim-graph.md` and compute its status; workers report candidates in their replies, and you decide. The graph is the single claim store: final synthesis may not draw from free-form claims that skipped it.

A high-risk claim clears the gate to `verified-claims` only when all hold:

- **>= 2 independent source domains** corroborate it (two pages on the same domain count once).
- **>= 2 independent observation groups** converge on it, unless the graph records why a primary-only source is the correct single-source exception.
- **One counter-search** actively looked for a refutation and did not find a stronger one.
- **A primary source** (the standard, filing, dataset, or first-party doc) backs it, not only secondary commentary.
- **Temporal evidence is explicit**: each supporting observation records `observed_at` and either `valid_at` or `claim_valid_at`, so branch-only, historical, release, and current-runtime claims cannot be conflated.

Anything that fails goes to an `Unresolved` (insufficient evidence) or `Refuted` (counter-search won) annex — abstention is a correct outcome, not a gap to paper over. Record each gate outcome on the claim node itself — risk tier, independent source domains, counter-search result, primary source backing, and status — and mirror the cleared nodes into the `verified-claims` digest section at the top of `claim-graph.md`. Worker reply marker (message text, same channel as EXPAND):

```
## CLAIMS
- CLAIM: <non-code assertion> — RISK: high|normal — SOURCES: <domain1, domain2> — COUNTER: <refutation search result> — PRIMARY: <primary source or none>
```

**The claim table is machine-read.** Keep the nodes of `claim-graph.md` in one Markdown table whose header names `claim_id | statement | risk tier | status` (plus `fact_ids`, the ledger rows the node rests on, and any other node fields as further columns), one row per node: ids `C<n>`, risk `high` or `normal`, status `supported`, `partial`, `refuted`, or `unresolved`. List the nodes that clear the Phase 4b gate under a `## verified-claims` heading as `- C<n>: <statement>`. `node "$SKILL_DIR/scripts/report-tools.mjs" claims index "$SESSION_DIR/claim-graph.md" --out "$SESSION_DIR/claims.json"` indexes it, and the fidelity gate reads `claims.json` to check every `data-claim` binding in the report.

## Phase 5 — Synthesize

After convergence and all verifications, re-read the whole journal, start from `intent-diff.md`, `claim-graph.md`, `observation-manifest.md`, and `debate-log.md`, then write `SYNTHESIS.md`:

```
# ULW-Research Synthesis: <query>
Members + lanes: <total> · Waves: <count> · Excursions: <count> · Sources: <count> (<unique domains> domains) · Verifications: <count> · Debate rounds: <count> · Elapsed: <minutes> min

## Executive summary        — 2-3 paragraphs answering the core question
## Findings by theme        — per theme: consensus, evidence links, key quote (<20 words, attributed), verified yes/no
## Codebase findings        — absolute paths with line references
## Sources (ranked)         — URL, what it contains, reliability, access date
## Verified claims          — code: claim | verdict | verify-<slug>.md · non-code: only rows cleared into verified-claims
## Epistemic instrumentation — intent-vs-reality diff closure, claim graph coverage, observation manifest coverage, independent-observation convergence, verification economics summary, cause-disappearance records
## Debate record            — per contested claim: the attack, the defense, the verdict that survived
## Contradictions           — source A vs source B, resolution with evidence
## Gaps                     — what saturation could not answer · unresolved/refuted claim-graph nodes
## Expansion trace          — per wave: workers → markers; convergence reason
```

`SYNTHESIS.md` is the citation source of truth for final materials: every claim carries inline `[Source N]` citations, and every high-risk non-code claim you assert must be a verified-claims row from Phase 4b. Assert nothing the gate left in the unresolved/refuted annex and nothing the skeptic's attack left standing unanswered.

**Write numbers and quotes by reference.** `SYNTHESIS.md` and every report source carry placeholders, never typed values: `{{F12:span_len}}` renders the row's value and unit, `{{F12:span_len:value}}` or `:unit` one part, `:q` the value with its source qualifier (up to, at least, about); `{{Q7:completion}}` renders the whole quotation, `{{Q7:completion:lead=8}}` its first words, `{{Q7:completion:from="no earlier":to="2027"}}` one span of it. A derived number is computed by the script, never by hand: `fact derive --op sum|diff|growth|ratio|share|convert|expr ...` checks the operands' units, periods, and populations, refuses an incompatible operation, and prints the new row id the placeholder uses. A value nobody measured is registered with `fact add --assumed <value> --unit <unit> --rationale <why> --label <label>` and renders as ASSUMED. Every findings sentence binds to a fact, a quote, a `[S<n>]` citation, or a claim node (`data-claim="C3"`). The refinement-debate team and every reviewer read the rendered text through `node "$SKILL_DIR/scripts/report-tools.mjs" fact fill "$SESSION_DIR/SYNTHESIS.md" --view --session-dir "$SESSION_DIR"`, never the raw placeholders.

**Write the skeleton early and fill it as claims lock.** The moment the brief records the deliverable, create the deliverable file with its section headings and a `STATUS: draft — <n> sections open` line as line 2 (an HTML comment in HTML); that line is the partial-state marker `outcome state` reads, removed only when the deliverable is complete. An interrupted run must leave a partial report on disk, never an empty directory and a lost conversation.

**Keep sourced numbers, assumptions, and derived results visibly apart.** Every quantitative claim carries its lineage: `MEASURED` (a number a source states, cited), `ASSUMED` (a coefficient, distribution, or scope you chose — say why), `DERIVED` (computed from those, showing the formula), plus a sensitivity line whenever the assumption moves the answer. Presenting a derived estimate with the confidence of a measured one is the most damaging thing this mode can ship.

**Search in English, deliver in the user's language.** Retrieval stays English-first (Search craft), but the synthesis and every final material are written in the language the user wrote to you in unless they ask otherwise — and a translated report still quotes its original-language sources verbatim.

## Phase 6 — Final materials, then teardown

The promised formats recorded in `brief.md` and `outcome.json` are binding; `pdf` + `docx` is the default pair only when a document was asked for with no format word and no destination:

| Target | How |
|---|---|
| PDF (default) | Author the report as one self-contained HTML file, then print it headless: `chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=<out.pdf> file://<report.html>`. Embed the `design-spec.md` fonts as real webfonts (CJK included) instead of trusting system fallbacks. `uv run --with weasyprint python` is the fallback renderer. |
| DOCX (default) | `pandoc <report.md> -o <out.docx>`, adding `--reference-doc=<template.docx>` when the user has a house style; `uv run --with python-docx python` when pandoc is unavailable. Charts and Mermaid renders go in as images. |
| LaTeX (.tex + PDF) | Read [references/latex-report.md](latex-report.md) first and follow it end to end: scaffold from its preamble, write per-section `.tex`, compile with the detected engine (XeLaTeX when the report language needs CJK), iterate to a clean multi-pass log, then render page PNGs for the visual-QA gate. |
| Slides / deck | `uv run --with python-pptx python` — one claim per slide, a chart or diagram per claim. |
| Standalone HTML / Markdown | The authored source itself. |

**Every reader-facing edition is filled and verified.** The main report, the inline edition, LaTeX sections, and slide sources are all filled by `fact fill` from the same placeholder source, and each is verified on its own by `fact verify`; PDF and DOCX are renders of a verified source (`pandoc <report.html> -o <out.docx>` when the DOCX comes from the filled HTML). Fill and verify HTML or Markdown sources (`fact verify --format html|md`, with a fill map for Markdown); verify LaTeX through its Markdown source, since direct `--format tex` verification exits 2. Record a delivered edition with `outcome set <format> delivered --path <file> --verified-by <record>`, where `<record>` is the `fact verify` output whose `artifact_sha256` equals the sha256 of the delivered source; a PDF or DOCX adds `--rendered-from <source>` and is matched against that source. `outcome verify` refuses a delivered row without a matching record (`edition_unverified`).

**Write `design-spec.md` the moment the deliverable is recorded — before any asset lane spawns.** When a document was pointed at, extract it instead of retyping its stylesheet: `node "$SKILL_DIR/scripts/report-tools.mjs" format-extract <reference> --out "$SESSION_DIR/design-spec.md"` (`--from-url` for a URL), then fill every `TODO: ask` from the interview answers, never by guessing. It is the one design contract every asset and assembly lane receives: template family (absent a reference, the clean analyst-report register — one accent over neutral tones, generous margins, styled section headings, no emoji, no clipart), palette tokens, body/heading fonts (a real gothic CJK webfont — Pretendard, Noto Sans KR — when the report language needs one, with `word-break: keep-all` for Korean), responsive breakpoints and HTML/CSS charts for web deliverables, the figure standard below, and the lineage mode on its own line: `Lineage: inline` (analyst default: every unit-bearing number tagged MEASURED / ASSUMED / DERIVED or cited in the same element) or `Lineage: section` (web and blog register: every section cited, lineage in the figure captions). The reference's section 6 lists the full defaults. One font family and one palette govern prose, charts, Mermaid, and generated images alike; a diagram rendering in a random default font inside a styled report is a defect, not a style choice.

**The figure standard — binding for every image, chart, and diagram.** Each figure sits in a fixed-size container styled from the spec (border, background, caption); the image scales to fit entirely inside it with its original aspect ratio preserved — object-fit: contain semantics — never stretched, never cropped, never spilling out. Every chart carries a title, axis labels, units, and value labels in the report's language; a bare number the reader cannot name is a defect.

Asset lanes (background, parallel `task` spawns, each fed `design-spec.md`) — visuals are the DEFAULT deliverable of this phase, not garnish the user must ask for; a delivered report without figures is an incomplete run:

- **Charts for every quantitative finding, computed from real data.** Pull the numbers into an actual table first (CSV/JSON under `$SESSION_DIR`), then plot from that table, never from prose. Follow the data-scientist tool doctrine — numpy always, Polars for filtering/sorting/transforms, DuckDB for joins/aggregations/window functions, never pandas — and load the `data-scientist` skill when this session has it: `uv run --with numpy --with polars --with duckdb --with pyarrow --with matplotlib python`. Keep `pyarrow` in that set — the DuckDB-to-Polars handoff (`.pl()`) fails without it, and `.df()` fails without pandas, so hand data across through `.pl()`, never `.df()`. Save to `$SESSION_DIR/assets/`. Plot ONLY from the ledger: export the rows with `node "$SKILL_DIR/scripts/report-tools.mjs" fact export --csv --out "$SESSION_DIR/assets/<chart>.csv" --session-dir "$SESSION_DIR"` and draw from that CSV; every chart figure carries `data-chart-source="assets/<chart>.csv"`, and its axis tick labels sit inside a `<g class="ticks" data-tick-step=".." data-tick-min=".." data-tick-max="..">` group, so the fidelity gate can check every plotted value and tick (the deliverable reference's section 6 tick rule).
- **Mermaid graphs** for process, architecture, argument, timeline, and evidence-flow structure, themed to the spec's fonts and palette. Render each to SVG and confirm the file exists before the document references it.
- **Generated visuals whenever this session has an image-generation skill:** a cover plus a concept illustration per major theme, prompted from the spec's style, palette, and mood — document-styled illustration, never generic stock art dropped into a designed page.
- **Full-page screenshots** of the top 5-10 sources, saved by the web workers while reading, as provenance you can show.

**Every final report is visual — binding.** It carries at least one data visualization of the run's own findings (a chart drawn from the data table, next to the claim it supports), a diagram wherever structure matters, and the topic's own screenshots and video, embedded or linked with attribution; every figure is captioned, sourced, and given alt text. Mermaid for flows, timelines, and relations; generated charts for numbers; image generation only where an illustration genuinely helps; PlotNeuralNet for paper-format reports that describe model architectures. Every asset lane reads [references/report-visualization.md](report-visualization.md) first: which tool fits which finding, the render commands, the quality bar, and the checklist the gates apply. A light-tier post still carries one visual when it reports numbers or structure.

**Visual reproductions are compared against the source — binding.** When the ask is to recreate, reproduce, or rebuild something visual (a clip in 3D, an interface from a screenshot, a figure), real frames or captures from the source are the reference: extract them at the moments that define the source, render the output at the same moments and viewpoints, compose side-by-side pairs, critique every pair by looking at it, fix the largest differences, and compare again within the repair bound. The final pairs, and the first-round pairs in the correction log, go into the report. Procedure: [references/report-visualization.md](report-visualization.md), section 3, Reference compare. A reproduction checked only against itself is unverified.

**Verify the asset manifest before rendering.** List every asset the document references, assert each file exists and is non-empty on disk, and re-render whatever is missing. A document that renders with three broken diagrams is a document you will publish twice.

Assembly lane — `task(category: "deep-low", load_skills: ["frontend", "visual-qa"], run_in_background: true, ...)`: the report is a designed artifact, not a text dump; its prompt carries `design-spec.md`. Use the template the user approved; absent a stronger house style the default skeleton is executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (members, lanes, waves, searches, verifications, debate rounds) → correction log naming what verification overturned. Write it long and specific: every claim cites `[Source N]`, and the sources section lists every source the run actually used rather than a curated few. The assembly lane writes `report.src.html` with placeholders, never typed values; the orchestrator runs `node "$SKILL_DIR/scripts/report-tools.mjs" fact fill "$SESSION_DIR/report.src.html" --out "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"` and gates the filled file. The inline edition for a PDF, DOCX, or oversized HTML deliverable comes from the same source (`fact fill "$SESSION_DIR/report.src.html" --inline --out "$SESSION_DIR/report.inline.html"`, which inlines local stylesheets and makes image paths absolute on the filled output), never from a hand copy.

### The delivery gates — every gate for the QA tier must PASS, in order

Nothing reaches the user until the gates pass. Record each result with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome gate <static|fidelity|layout|visual|proofread> <pass|fail|not_run> --session-dir "$SESSION_DIR"`; a gate this harness does not provide is recorded `not_run --reason "<why>"` (`fidelity not_run` refuses without the reason). A chat or post answer (light tier) runs gate 1 and one render; every paginated or web deliverable runs all five (the reference's sections 3 and 7).

1. **Static gates (always, before anyone looks at pixels).** `node "$SKILL_DIR/scripts/report-tools.mjs" check "$SESSION_DIR/report.html" --design-spec "$SESSION_DIR/design-spec.md" > "$SESSION_DIR/defects.json"`: keep-all, palette tokens, emoji, em dashes, heading length, unsourced numbers, figure containers, chart text, a report with no visual, images without alt text, gothic-only fonts, citations, the closing and sources sections, broken assets. Codes and fixes: [references/report-gates.md](report-gates.md).
2. **Fidelity gate.** `node "$SKILL_DIR/scripts/report-tools.mjs" fact verify "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"` checks every number, quote, chart value, and sentence binding against the ledger, the snapshots, `claims.json`, and the locked `## Fidelity` block of `brief.md`, and writes `$SESSION_DIR/fidelity-defects.json` with the verified file's `artifact_sha256`. Exit `1` on any blocker or major defect: record `outcome gate fidelity fail` and repair; minors alone exit `0` and are listed. Verify every other edition the same way into its own record (`--out "$SESSION_DIR/fidelity-inline.json"`). Codes and fixes: [references/report-gates.md](report-gates.md); grammar: [references/deliverable-phase.md](deliverable-phase.md), Fidelity gate.

**Meaning verifier (a separate session reads every sentence against its source).** When the brief's `meaning check` is `on`, run it after the fidelity gate passes; when it is `off`, `fact pairs` writes `{"skipped": true}` and the step ends there. `node "$SKILL_DIR/scripts/report-tools.mjs" fact pairs "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"` writes `$SESSION_DIR/pairs.json`: one pair per distinct source quote a findings sentence cites, per sentence bound only by `data-claim` (against the claim's statement), and per `data-translates` span, with `force_strong` set where the lexicon or the hedge position says a strong reader must look. Then spawn one reader lane on the cheapest category, `task(category: "quick", ...)`, whose prompt carries ONLY the path of `pairs.json` and the verdict schema, in exactly this text:

```text
TASK: meaning reader, <cheap|strong> tier. Read ONLY the pair file <SESSION_DIR>/<pairs.json or pairs-strong.json> and the verdict schema in this prompt. Do not open, search, or fetch any other file, page, or tool output: not the report, the ledger, the sources, or the claim graph.
For each pair, compare `sentence` with `quote` (with `statement` for a claim pair) and decide whether the sentence says something its source does not.
Write <SESSION_DIR>/meaning-<cheap|strong>.json as {"model_tier": "<cheap|strong>", "verdicts": [...]} with one verdict per pair_id: {"pair_id": "P<n>", "verdict": "ok" or "drift", "drift_kind": ..., "fragment": ..., "source_fragment": ..., "explanation": "<one sentence>"}.
drift_kind is exactly one of: subject_changed, scope_widened, hedge_dropped, certainty_added, causality_added, direction_flipped, population_changed, evidence_grade_raised, other.
fragment is copied verbatim from the sentence and source_fragment verbatim from the quote or statement: the shortest exact substrings that show the drift, never paraphrased, never empty. A verdict whose fragments are not found word for word is discarded.
A sentence that shortens, summarizes, or translates its source without changing subject, scope, certainty, causality, direction, population, or evidence grade is ok. Do not rewrite anything; return verdicts only.
```

Next, write `$SESSION_DIR/pairs-strong.json` (the same file, keeping only the pairs the cheap reader flagged plus every `force_strong` pair) and spawn one reader on the strong category, `task(category: "ultrabrain", ...)`, with the same prompt for the strong tier. Then `node "$SKILL_DIR/scripts/report-tools.mjs" fact meaning-check --pairs "$SESSION_DIR/pairs.json" --verdicts "$SESSION_DIR/meaning-cheap.json" --verdicts "$SESSION_DIR/meaning-strong.json" --edition html --session-dir "$SESSION_DIR"` writes `$SESSION_DIR/fidelity-meaning-defects.html.json`, the meaning record of that edition (repeat `fact pairs` and the readers with `--edition <format>` for every other delivered edition whose source bytes differ): both tiers naming the same `drift_kind` (never `other`) is `meaning_drift_confirmed` (major, exit `1`); one tier alone is `meaning_drift_warn` (minor); a verdict whose fragments are not in the pair is dropped and counted. Repair every confirmed drift by rewriting the sentence from its quote, re-fill, re-verify, and re-read only the changed sentences (`fact pairs ... --changed-since <the new fill map>`); or, when the sentence is right, dispute it with `--dispute P<n> --reason "<why>"`, which keeps the defect for this run and logs the dispute. Pass the record to `repair decide` as one more `--defects` file and list the warnings in the closing briefing. Each flagged pair adds one line to `$SESSION_DIR/fidelity-calibration.jsonl`, whose header records the promotion criterion: `meaning_drift_confirmed` moves from major to an integrity code only after at least 20 runs with disputed-to-confirmed below 10 percent and no more than 2 report-level false blocks in the last 20 runs. These are starting values, changed only with evidence; the scripts never call a model.

3. **Layout gates.** Print the probe with `node "$SKILL_DIR/scripts/report-tools.mjs" layout-probe --json`, evaluate its `source` in the rendered page through the `browser` skill's owned headless engine, save the result as `$SESSION_DIR/boxes.json`, and re-run `check` with `--layout "$SESSION_DIR/boxes.json"` (overflow, clipped text, distorted images, overlapping siblings).
4. **Visual QA.** Render the produced artifact back to images — PDF pages to PNG, the HTML through the browser skill at desktop and phone widths — and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Reading the source markup is not visual QA; inspect the pixels.
5. **Proofread gate — `task(category: "writing", ...)`.** Hand the final text to a dedicated `writing` lane whose only job is language: grammar, spelling, punctuation, terminology consistency, and whether the prose reads NATIVELY in the report's own language (for Korean, natural Korean written by a Korean, not translationese). It proofreads only and never composes, and it never edits the file: it returns `$SESSION_DIR/polish-edits.json`, an array of `{"before": ..., "after": ..., "reason": ...}` where `before` is the exact current text of one or more adjacent sentences. Edits change text only; an edit whose before/after would alter any tag, attribute, comment, or script/style content is rejected, and markup changes go through the full fidelity gates instead. Apply it with `node "$SKILL_DIR/scripts/report-tools.mjs" fact polish-apply "$SESSION_DIR/report.html" --edits "$SESSION_DIR/polish-edits.json" --out "$SESSION_DIR/report.polished.html" --session-dir "$SESSION_DIR"`: each edit is applied alone, and an edit that changes a fact span, a numeral, a link, or a claim id, or drops a hedge or qualifier the source carries, is `polish_edit_rejected` (a `before` not found exactly once is `polish_edit_unlocated`) and leaves its text unchanged. Send the rejected and unlocated edits back to the same lane with their reasons, plus `$SESSION_DIR/polish-defects.json` and the pre-polish `report.html` the backstop compared against, so the worker sees why each edit was refused; it returns either a rewritten sentence or a new edit list, and the repair round re-runs `fact polish-apply` with `"$SESSION_DIR/report.polished.html"` as both input and output, within the repair budget. Then run the backstop `fact polish-diff --before "$SESSION_DIR/report.html" --after "$SESSION_DIR/report.polished.html" --session-dir "$SESSION_DIR"` (exit `1` on `polish_diff_fail`), `fact verify` on `report.polished.html`, and `fact pairs "$SESSION_DIR/report.polished.html" --changed-since "$SESSION_DIR/report.html.fill-map.json" --session-dir "$SESSION_DIR"`, which keeps only the quote and claim pairs whose sentence text changed during polish; run the meaning readers above (cheap, then strong on the flagged pairs) on exactly those pairs and `fact meaning-check` before recording `outcome gate fidelity`. A rewording that keeps every number, hedge, qualifier, and link but swaps who did what to whom therefore still reaches a meaning reader on the delivered text. `report.polished.html` is the report that is delivered. Deliver only on a clean pass — this gate runs BEFORE the first delivery, not after the user finds the typo. Edits must not span entities (such as &amp; or &lt;) or markup; narrow the edit to the surrounding words instead, and a rejected edit comes back with the reason to act on.

**Repair is bounded.** After every gate run that found defects, ask `node "$SKILL_DIR/scripts/report-tools.mjs" repair decide --state "$SESSION_DIR/repair-state.json" --defects "$SESSION_DIR/defects.json" --defects "$SESSION_DIR/fidelity-defects.json" --artifact-bytes <bytes> --renders <pages> --session-dir "$SESSION_DIR"` and obey it: `repair` means fix and re-run; `deliver` means stop and ship with the residual defects the manifest now lists; `block` means a content-integrity defect remains (or there is no usable artifact), so do not deliver: tell the user what blocks it and record the row as `failed` with the reason. Never repair past a stop decision (3 attempts, a 2-attempt plateau, an oscillation, or 15 minutes; the reference's section 8). Fidelity defects ride the same loop (`--defects "$SESSION_DIR/defects.json" --defects "$SESSION_DIR/fidelity-defects.json"`), but a `deliver` decision does not release them: while `fidelity-defects.json` lists `untraceable_number`, `value_mismatch`, `unit_mismatch`, `quote_not_verbatim`, `quote_unbound`, `unbound_sentence`, or `chart_value_untraceable`, `outcome verify` fails with `fidelity_unresolved` and `outcome finish` refuses, even with the repair budget spent. The only ways out are a ledger row, an `assumed` row with its rationale, or removing the sentence.

Then resolve every manifest row (`outcome set <format> delivered --path <file> --verified-by <record>` (plus `--rendered-from <source>` for a PDF or DOCX) or `blocked_capability` / `skipped` / `failed` with `--reason`) and deliver. **Show the report inline first.** When this session has `show_html_page` (or `html_render` on another host), the requester's first view of the result is the report itself, shown in the thread: the gated `report.html` when it fits the tool, otherwise an inline edition built from the same synthesis and assets, with the reference-compare pairs when the run has them (the deliverable reference's section 9, Showing the report inline; load `visualize` for the inline-page constraints). Then give the artifact paths and a compact chat-readable summary of what the report says — the answer in a few sentences, the numbers that matter, and what to look at first. This holds on every tier, a chat answer included, and when the thing built is itself a page (an app, a 3D scene), showing it does not replace the report page. Without an inline page tool, deliver the artifact paths plus that summary. The document is the deliverable; the summary is what gets it read.

### The closing briefing — every run ends with it

The last thing the user reads states, in one compact block, what the answer is made of:

- **The printed block.** `node "$SKILL_DIR/scripts/report-tools.mjs" outcome verify --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome finish --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome briefing --session-dir "$SESSION_DIR"`: sources and distinct domains counted from `sources-ledger.md`, elapsed minutes from the session directory's own timestamp, every promised deliverable with its status, the gate results, the residual defects, and the repair summary. A failing `verify` means the run is not done.
- **Effort.** Members, lanes, waves, excursions, verifications, and debate rounds — the same counters as the `SYNTHESIS.md` header — plus how many sources were primary and how many claims went to the unresolved/refuted annex. `fact export` also prints a coverage line (`N of M sources snapshotted, by extractor: ...`); paste it into the briefing's effort line.

Never ship the artifact without this block, and never fill it from memory — paste the printed block and read the rest off the journal.

**Record the format choice.** After delivery, when the memory tool exists and the run qualifies (the user declared a preference, or made the same unsolicited choice on 2+ runs), append one episode line to `reference/human-report-style.md` in the grammar of the reference's section 5, and update the `system/human/report-style.md` pointer when a generalization changed.

**Teardown is part of the deliverable.** Once the materials are delivered: `team_delete({ team_run_id, force: true })` for every team you stood up, confirm each lane is terminal (`/tasks`), and only then write the final answer. A live team left running past the final answer is a failed run, not a finished one.

## Search craft

English first: run every search in English by default — it is the largest, most authoritative corpus on every engine, GitHub, and documentation site. Add a secondary local-language sweep (1-2 lanes) only after the English sweep, when the topic is inherently local, or when the user asks for sources in a specific language.

Vary operators on every query — same query twice wastes a worker:

| Operator | Example | Use |
|---|---|---|
| `site:` | `site:github.com <topic>` | Restrict to a domain |
| `filetype:` | `filetype:pdf <topic> survey` | Papers, specs |
| `intitle:` / `inurl:` | `intitle:benchmark <topic>` | Targeted pages |
| `"exact"` / `-term` | `"<exact phrase>" -tutorial` | Precision, exclusion |
| `OR` | `<a> OR <b> <topic>` | Coverage |
| `before:` / `after:` | `<topic> after:2025-06-01` | Recency control |

- X search operators: `since:YYYY-MM-DD until:YYYY-MM-DD from:handle filter:links -filter:replies lang:ko`; always phrase time-sensitive queries as latest/recent.

High-yield combinations: official docs (`site:<docs domain>`), GitHub implementations (`site:github.com`), recent discussion (`site:reddit.com OR site:news.ycombinator.com after:<date>`), academic (`site:arxiv.org OR filetype:pdf survey`), changelog hunting (`changelog OR "release notes" <version>`), alternatives (`vs OR alternative OR comparison`).

## Failure modes

| Failure | Correction |
|---|---|
| Standing up the team before the Phase 0 brief exists | Scope solo first; the brief defines the roster — never improvise a team and invent axes afterwards |
| Skipping the team for a solo research pass | The team is the DEFAULT composition; fall back to plain `task` lanes only when team creation itself fails, and say why in the journal |
| Naming a curated agent (`explore`, `librarian`, ...) as a team member | Curated agents are read-only and runtime-rejected as members — they run as `task` lanes; members own axes via their briefs |
| Sequential spawning, or trimming the first wave | All first-wave members and lanes in one turn, scaling floor respected |
| A member hoards leads for one final dump | Raise law — every lead, finding, and dead end broadcast to `to: "lead"` the moment it surfaces |
| Worker reply without the EXPAND tail | One follow-up demanding it; the lane stays open until it lands |
| No skeptic pass on a "supported" claim | Every supported claim survives a debate round first; log it in `debate-log.md` |
| Stopping after wave 1 because "enough was found" | Convergence rules only: 2+ expansion waves, leads run dry, debates settled |
| Obeying a surrounding "stop exploring" rule mid-research | Authority section — those rules do not bind this mode |
| Asking a worker to write journal or session files | Workers report as message text (except a mass-research dag node's handoff file); you journal every return |
| Two workers given the same angle | One unique angle per worker, always |
| A web worker that returned only `fetch`/`curl` text, or a `Collection: browser` run whose workers never opened a tab | Sources are read in the user's browser through the `browser` skill; `webfetch` is for raw files; every web worker carries the skill from the first wave |
| Contested claim settled by judgment | Phase 4 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
| Final answer while the team is still live | `team_delete` + terminal lanes first; teardown is part of done |
| Guessing the deliverable format | Derive it from the request and destination; ask the empty-info interview only for what is still missing, and record `answered_by` for every field |
| Blocking the collection wave on the format question | Ask with `waitForAnswer: false` and start collecting; unanswered fields run on the shown defaults |
| A roster smaller than the runtime maximum | Fill every slot; split the broadest axis until the team is full |
| One category across the whole roster | Mixed tiers by design — cheap breadth, premium attack, `writing` for language |
| Silently re-routing a "quick"/"fast" roster to another tier | Routing words are literal; journal requested -> spawned -> fallback for every slot |
| A member that starts its own research swarm or loads this skill | Members research one axis and report; orchestration is yours alone |
| Expanding on an entity the first wave never disambiguated | Settle canonical identity and first-party source before any later prompt asserts it |
| Batching findings into an end-of-run journal dump | Journal each return as it lands; ulw-loop state is what survives a compaction |
| Ending the run because every worker finished | Reserve the final fifth of the run for synthesis and materials |
| A derived estimate presented as a measured number | MEASURED / ASSUMED / DERIVED lineage on every quantitative claim, plus a sensitivity line |
| A number typed into the report or `SYNTHESIS.md` | Register it (`fact add`) and write `{{F<n>:label}}`; `fact verify` reports a typed number as `untraceable_number`, and `outcome verify` refuses delivery until it is a ledger row, an `assumed` row with its rationale, or gone |
| A filled value edited by hand | Never edit a filled value: fix the ledger row or the placeholder and re-run `fact fill`, then `fact verify` (`value_mismatch`, `unit_mismatch`) |
| A findings sentence bound to nothing | Bind it to a fact, a quote, a `[S<n>]` citation, or a claim node with `data-claim`; an `unbound_sentence` blocks delivery like an untraceable number |
| Delivering before visual QA or before the `writing` proofread gate | The gates are mandatory and ordered; a typo the user finds means the gate did not run |
| Skipping the static gates | `report-tools check` runs before any pixel review; its defects are cheaper than a visual pass |
| Delivering with a pending manifest row | `outcome verify` must pass; every promised format ends `delivered`, `blocked_capability`, `skipped`, or `failed` with a reason |
| Repairing past the tracker's stop decision | `repair decide` owns the budget; `deliver` ships with the residual list, `block` stops delivery |
| Guessing a design-spec value the extractor marked `TODO: ask` | Fill it from the interview answers or the reference's defaults, never by guessing |
| Referencing an asset that is not on disk | Verify the asset manifest before rendering; re-render whatever is missing |
| A figure stretched, cropped, or styled off the report's design language | `design-spec.md` binds every asset: fixed containers, contain-fit with aspect preserved, spec fonts and palette in charts and Mermaid |
| Chasing an interesting find with no ENTER trigger | Excursions need a named trigger; everything else stays a queued lead |
| An excursion that never came back, or drifted into a new mission | EXIT rules are unconditional; depth 3 means promote it to an axis or record it as a gap |
| An excursion whose result was never folded back | Every EXIT writes what it changed in the top-level answer, `none` included, and mirrors into the loop ledger |
| Ending with file paths while `show_html_page` is available | Show the report inline first (the gated `report.html` or its inline edition), then the paths and the summary |
| A visual reproduction checked only against itself | Reference compare: real source frames next to renders at the same moments, a critique per pair, fixes, and the pairs in the report |
| Delivering without the closing briefing | Paste the block `outcome briefing` prints; never compute or recall its numbers by hand |
