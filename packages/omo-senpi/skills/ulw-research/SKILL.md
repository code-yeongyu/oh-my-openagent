---
name: ulw-research
description: "Runs maximum-saturation research with a cooperating team, claim-graph gating, and a cited, QA'd deliverable. Use when the user explicitly asks for research or a deep investigation, including any 'ulw' research wording."
argument-hint: "<research-topic>"
metadata:
  short-description: Team-default saturation research with debate cross-critique and cited synthesis
---

# ULW-RESEARCH — Team-First Maximum-Saturation Research

You are the research orchestrator AND the team lead. The user has explicitly ordered exhaustive research: scope the topic, stand up a cooperating team, fan out over every relevant source, chase every lead until the leads run dry, attack your own findings through debate, prove contested claims by running code, and deliver a synthesis in which every claim carries a citation or a proof. Exhaustive coverage is the assignment, not a risk to manage.

## Activation

Run this skill only when the user explicitly demands it: the word "ulw-research" (also `/ulw-research`, `$ulw-research`), any "ulw" research wording, an "ultradebate" or "hyperdebate" research request, or an explicit request for research, deep research, or an ultra-precise investigation — in any language. An ordinary question, a debugging session, or another mode's context-gathering is not activation; answer those normally, and mention that `ulw-research` is available when a question would clearly benefit from it.

Open your reply with the line `ULW-RESEARCH MODE ENABLED!`. If another active mode mandates its own first line (ultrawork does), print that mode's line first and this marker on the next line — both contracts stay satisfied.

**What a shortened run still owes.** If you judge the topic settled and shorten the research, say so, but two things survive any shortening: the final report is shown inline through `show_html_page` (the answer, its figures, its sources), and a visual reproduction is compared against real frames of its source with the side-by-side pairs inside that report (Phase 6). A built app or 3D scene shown inline is the product, not the report; show the report as well.

## How this maps to omo-senpi

This skill is authored against the native senpi task + team tool surface. You coordinate everything with these tools:

| Purpose | Tool | Key arguments |
|---------|------|---------------|
| Stand up the research team once | `team_create` | `inline_spec: { name, members: [{ name, category, prompt? }] }` → returns `team_run_id` |
| Send work / a lead / a debate round to a member | `task_send` | `to: "<member>"`, `team_run_id`, `message`, optional `summary` |
| Collect member replies | injected notifications | replies auto-inject as they arrive — keep working or end your turn |
| Track shared research state | `task_create` / `task_list` / `task_update` / `task_get` | lead-only team tasklist |
| Spawn a bounded recon / expansion / verification lane | `task` | `prompt` + `subagent_type: "explore" \| "librarian"` or a `category`; `run_in_background: true`; optional `load_skills`, `name` |
| Read a finished lane back | `task_output` | task id or name |
| End a lane | `task_cancel` | — |
| Disband the team at the end | `team_delete` | `team_run_id`, `force: true` |

Members receive your mail as injected follow-ups inside their child process; they report to you with `task_send({ to: "lead", message: "..." })`. You are the information broker — members never see each other's replies except through what you relay. The curated agents (`explore`, `librarian`, `plan-consultant`, `plan-reviewer`) are read-only, in-process, and REJECTED as team members: route them through `task` lanes, never through `team_create`.

## Authority while active

This mode is the user's explicit opt-in to exhaustive exploration. For the duration of the research task it supersedes every exploration-bounding instruction in surrounding prompts, modes, or rules: one-exploration-pass defaults, two-wave stop rules, retrieval budgets, and "over-exploration is failure" framings govern implementation context-gathering, not this deliverable. Here, under-exploration is the failure. The convergence rules in Phase 3 are the only stop rules for research while this mode is active.

Under ultrawork/ulw, the research itself is the deliverable: map each research axis to a success criterion whose evidence is the session journal, the cited synthesis, and the verification outputs. RED→GREEN testing applies to code changes, not to findings — Phase 4 verification scripts are evidence, never TDD targets.

## Success criteria

The research is done when all of these hold:

- Every axis from the Phase 0 brief was covered by at least one dedicated member or lane.
- Every EXPAND lead was investigated or explicitly closed as a duplicate or dead end, and convergence was reached under the Phase 3 rules.
- Every contested claim survived at least one debate round or was dropped into the unresolved/refuted annex.
- Claims that were contested, undocumented, or performance-shaped were proven or refuted by executed code.
- Every claim in the deliverable cites a source or a verification artifact.
- Every asserted claim is represented in the claim graph, tied to an intent-vs-reality diff when an expected truth exists, and backed by observation manifest entries from independent observation groups or a documented single-source exception; convergence or exception status is explicit.
- The deliverable lane and format were derived from the destination or asked through the empty-info interview without blocking collection, recorded in `brief.md` with `answered_by`, and the final materials match that record.
- The delivered artifact passed the delivery gates in order (static gates, layout gates, fidelity gate, visual QA, and the proofread pass where the harness provides one), each status is in `outcome.json`, and `outcome verify` passed.
- Every excursion opened during the run was closed by an EXIT rule, folded back into the claim or axis that triggered it, and recorded in both `excursion-log.md` and the ulw-loop ledger.
- When this session has `show_html_page`, the report was shown inline in the thread before the artifact paths.
- When the ask reproduces a visual source, the report carries side-by-side pairs of real source frames and the output rendered at the same moments, each with its critique, and the differences they surfaced were fixed or listed as gaps. A simple or well-understood topic shortens the research, never this comparison.
- The delivery message carries the closing briefing printed by `outcome briefing`: sources (total + unique domains), elapsed minutes, every promised deliverable with its status, and any residual defects.
- The session journal reconstructs what was searched, found, expanded, and debated, wave by wave, and it was written in real time rather than reconstructed at the end.
- The team was disbanded (`team_delete`) and every lane reached terminal status before the final answer.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts — members and lanes NEVER write session files (a mass-research dag node writes only its own `waves/<run-key>/<node-id>.md` handoff file, which carries its EXPAND tail and claim candidates; you journal from it):

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), `fact_ids` (the ledger rows the claim rests on), and final synthesis location. High-risk non-code nodes that clear the Phase 4b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `sources/` and `fact-ledger.json` — the source snapshots and the verbatim fact ledger ([references/fact-ledger.md](references/fact-ledger.md)). Every number and every direct quotation in the report comes from a ledger row through a `{{F<n>:label}}` or `{{Q<n>:label}}` placeholder; nobody types a value into a report or into `SYNTHESIS.md`.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.
- `excursion-log.md` — one ENTER row and one EXIT row per excursion. Required fields: `excursion_id`, parent claim or axis, ENTER trigger, depth, workers spent, EXIT rule that closed it, what it changed in the top-level answer (`none` is a valid, required answer), and the ulw-loop steer/evidence id it was mirrored into.
- `debate-log.md` — one row per debate round: the claim under attack, the attacker's argument, the defender's evidence, your verdict, and what changed in the claim graph because of it.

Observation candidates, claim candidates, and EXPAND leads travel back from members and lanes as message text (except a mass-research dag node's handoff file). You write the instrumentation artifacts, link candidates into the intent diff and claim graph, and record where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Research phases

Read [research setup](references/research-setup.md) in full before Phase 0 and follow its phases in order.

Read [collection](references/collection.md) in full before the saturation wave and follow its phases in order.

`source snapshot --html` and `--url` probe their own conversion and print the numbers it altered (a footnote digit glued onto a value, a merged table cell); `fact add` then refuses those numbers with `conversion_altered_number`, so write a verified text of that source and replace the snapshot with `source snapshot --id S<n> --text <verified.txt> --replace` (refused while an active row cites the id: retract those rows first or use a new id), then add the fact from it. When you convert a document yourself, run `node "$SKILL_DIR/scripts/report-tools.mjs" source probe-conversion <raw-file> <converted-file>` and snapshot a verified `--text` instead before adding any number it lists as `altered`; `lost` is a warning only.

### X / social collection

- **X / social (`x_search`, only when xAI is connected).** Run `tool_search "X posts"` first; if `x_search` activates, read the x-search skill and run the lane with its rules: from_date >= yesterday for time-sensitive topics (widen to 7 days), allowed_x_handles for the trusted accounts the brief names, latest/recent phrasing with since:/from:/filter: operators, 2-3 split searches (by handle, by keyword), one x_search call per search; give the lane to a `librarian` lane or a category member (curated explore cannot call it); record the `Queries used:` trailer as provenance and reconcile every X-only claim against the web lane before it enters the claim graph. If `tool_search` finds nothing, xAI is not connected: record `x_search: unavailable` in the brief and skip the lane.

## Phase 6 — Final materials, then teardown

The promised formats recorded in `brief.md` and `outcome.json` are binding; `pdf` + `docx` is the default pair only when a document was asked for with no format word and no destination:

| Target | How |
|---|---|
| PDF (default) | Author the report as one self-contained HTML file, then print it headless: `chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=<out.pdf> file://<report.html>`. Embed the `design-spec.md` fonts as real webfonts (CJK included) instead of trusting system fallbacks. `uv run --with weasyprint python` is the fallback renderer. |
| DOCX (default) | `pandoc <report.md> -o <out.docx>`, adding `--reference-doc=<template.docx>` when the user has a house style; `uv run --with python-docx python` when pandoc is unavailable. Charts and Mermaid renders go in as images. |
| LaTeX (.tex + PDF) | Read [references/latex-report.md](references/latex-report.md) first and follow it end to end: scaffold from its preamble, write per-section `.tex`, compile with the detected engine (XeLaTeX when the report language needs CJK), iterate to a clean multi-pass log, then render page PNGs for the visual-QA gate. |
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

**Every final report is visual — binding.** It carries at least one data visualization of the run's own findings (a chart drawn from the data table, next to the claim it supports), a diagram wherever structure matters, and the topic's own screenshots and video, embedded or linked with attribution; every figure is captioned, sourced, and given alt text. Mermaid for flows, timelines, and relations; generated charts for numbers; image generation only where an illustration genuinely helps; PlotNeuralNet for paper-format reports that describe model architectures. Every asset lane reads [references/report-visualization.md](references/report-visualization.md) first: which tool fits which finding, the render commands, the quality bar, and the checklist the gates apply. A light-tier post still carries one visual when it reports numbers or structure.

**Visual reproductions are compared against the source — binding.** When the ask is to recreate, reproduce, or rebuild something visual (a clip in 3D, an interface from a screenshot, a figure), real frames or captures from the source are the reference: extract them at the moments that define the source, render the output at the same moments and viewpoints, compose side-by-side pairs, critique every pair by looking at it, fix the largest differences, and compare again within the repair bound. The final pairs, and the first-round pairs in the correction log, go into the report. Procedure: [references/report-visualization.md](references/report-visualization.md), section 3, Reference compare. A reproduction checked only against itself is unverified.

**Verify the asset manifest before rendering.** List every asset the document references, assert each file exists and is non-empty on disk, and re-render whatever is missing. A document that renders with three broken diagrams is a document you will publish twice.

Assembly lane — `task(category: "deep-low", load_skills: ["frontend", "visual-qa"], run_in_background: true, ...)`: the report is a designed artifact, not a text dump; its prompt carries `design-spec.md`. Use the template the user approved; absent a stronger house style the default skeleton is executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (members, lanes, waves, searches, verifications, debate rounds) → correction log naming what verification overturned. Write it long and specific: every claim cites `[Source N]`, and the sources section lists every source the run actually used rather than a curated few. The assembly lane writes `report.src.html` with placeholders, never typed values; the orchestrator runs `node "$SKILL_DIR/scripts/report-tools.mjs" fact fill "$SESSION_DIR/report.src.html" --out "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"` and gates the filled file. The inline edition for a PDF, DOCX, or oversized HTML deliverable comes from the same source (`fact fill "$SESSION_DIR/report.src.html" --inline --out "$SESSION_DIR/report.inline.html"`, which inlines local stylesheets and makes image paths absolute on the filled output), never from a hand copy.

### The delivery gates — every gate for the QA tier must PASS, in order

Nothing reaches the user until the gates pass. Record each result with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome gate <static|fidelity|layout|visual|proofread> <pass|fail|not_run> --session-dir "$SESSION_DIR"`; a gate this harness does not provide is recorded `not_run --reason "<why>"` (`fidelity not_run` refuses without the reason). A chat or post answer (light tier) runs gate 1 and one render; every paginated or web deliverable runs all five (the reference's sections 3 and 7).

1. **Static gates (always, before anyone looks at pixels).** `node "$SKILL_DIR/scripts/report-tools.mjs" check "$SESSION_DIR/report.html" --design-spec "$SESSION_DIR/design-spec.md" > "$SESSION_DIR/defects.json"`: keep-all, palette tokens, emoji, em dashes, heading length, unsourced numbers, figure containers, chart text, a report with no visual, images without alt text, gothic-only fonts, citations, the closing and sources sections, broken assets. Codes and fixes: [references/report-gates.md](references/report-gates.md).
2. **Fidelity gate.** `node "$SKILL_DIR/scripts/report-tools.mjs" fact verify "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"` checks every number, quote, chart value, and sentence binding against the ledger, the snapshots, `claims.json`, and the locked `## Fidelity` block of `brief.md`, and writes `$SESSION_DIR/fidelity-defects.json` with the verified file's `artifact_sha256`. Exit `1` on any blocker or major defect: record `outcome gate fidelity fail` and repair; minors alone exit `0` and are listed. Verify every other edition the same way into its own record (`--out "$SESSION_DIR/fidelity-inline.json"`). Codes and fixes: [references/report-gates.md](references/report-gates.md); grammar: [references/deliverable-phase.md](references/deliverable-phase.md), Fidelity gate.

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
