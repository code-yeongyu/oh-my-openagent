# ulw-research - deliverable phase contract

Read this before the brief is written and again before Phase 6. It replaces the old blocking format question with a contract that never stalls collection: the deliverable is derived from the request and its destination, the requester is asked only what is genuinely missing, and every promise made about the output is tracked in a manifest until it is delivered, skipped, or blocked with a reason.

Every helper named here is one command of the dispatcher:

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" <command> ...
```

`$SKILL_DIR` is the directory of the skill's `SKILL.md`. The helpers are plain `.mjs` files with no dependencies and run under `node` or `bun` on macOS, Linux, and Windows. They never launch a browser. Exit codes: `0` pass, `1` semantic failure (blockers found, a failed verify, a blocked repair), `2` usage or IO error. JSON goes to stdout and a one-line summary to stderr. Always pass `--session-dir "$SESSION_DIR"` explicitly; `SESSION_DIR` in the environment is only a fallback.

## 1. Lanes

The brief names exactly one lane. The lane decides how much the requester is asked, what the design spec starts from, and how strict the gates are.

| Lane | Definition | How to say it to the requester |
| --- | --- | --- |
| `template-strict` | The requester pointed at a document (a prior report, a page, a house template). Its structure, tokens, citation style, and figure standard are copied mechanically and not reinterpreted. | "I will match the document you pointed at: same structure, colors, fonts, and citation style." |
| `template-vibe` | The requester named a register or feeling ("like a consulting deck", "a clean blog post") without a document to copy. The design spec is written from the defaults in section 6 and the register. | "I will write it in that style using the default report design; point me at an example if you want an exact match." |
| `no-format` | Nothing about the shape was said and the destination implies it (a chat answer, a thread post, a quick note). No interview about format. | "I will answer in the shape this destination expects." |
| `edit-existing` | A complete deliverable for this question already exists (section 2). The run edits it in place. It never regenerates it. | "I will update the existing report rather than write a new one." |

## 2. Deliverable state

Before the brief is written, decide the state of any deliverable the request refers to:

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" outcome state --deliverable <path> --session-dir "$SESSION_DIR"
```

| State | Meaning | What it opens |
| --- | --- | --- |
| `none` | No file, or an empty one. | A fresh run in the lane the request implies. |
| `partial` | The file carries a `STATUS: draft` line in its first 5 lines, or its manifest still has a `pending` row. | Resume the on-disk skeleton: keep the sections that exist, fill the missing ones, and never start over. |
| `complete` | The manifest says every promised row is resolved and the file is present and non-empty. | `edit-existing` only. A complete report is never regenerated from scratch. |

## 3. Destination-derived defaults

The request and its destination usually answer the format question already. Derive the defaults first; the interview (section 4) only covers what this table leaves open.

| Request or destination signal | Default format set | Lane | QA tier |
| --- | --- | --- | --- |
| A question answered in chat, with no document asked for | `post` (the answer itself, Markdown) | `no-format` | light |
| A thread, channel, or messenger post | `post` | `no-format` | light |
| A web page URL as the destination, or "blog", "page" | `html` | `template-vibe` | full |
| The words "PDF", "DOCX", "slides", or "LaTeX" in the request | exactly the named formats (`pdf`, `docx`, `slides`, `latex`) | `template-vibe` | full |
| "Report", "document", "write-up" with no format word and no destination | `pdf` + `docx` | `template-vibe` | full |
| A pointed-at document (a file, a URL, a prior report) | the reference's own format | `template-strict` | full |
| A prior report of the same kind in this workspace, not pointed at | that report's format, offered as the Q1 default | `template-vibe` | full |
| A complete existing deliverable for this question (section 2) | its existing format | `edit-existing` | the original's tier |

QA tiers: **light** runs the static gates and one render check of the answer, and records the fidelity gate as `not_run --reason "<why>"` (the reason is required) until Markdown deliverable support ships for it. **Full** runs the static gates, the fidelity gate, the layout gates, visual QA of every page, and the proofread gate (section 7).

## 4. The empty-info interview

The interview has three format questions, asked together through the harness question tool without waiting for the answer; the fidelity questions (below) ride in the same call only when their triggers fire. A question is **skipped** when the request, the destination, a pointed-at document, or a declared memory episode already answers it; when all three are answered, nothing is asked.

- **Q1 - destination and format.** Options in this order: the memory hit (the choice recorded for the most similar prior context, section 5) when there is one; the derived default from section 3; "describe the format in your own words" (free text, which becomes the brief for the design spec); "don't care, you decide" (resolves to the derived default).
- **Q2 - audience and length.** Who reads it, and a length band: `short` (a page or a post), `standard` (a report of about 5 to 12 pages), or `deep` (a full dossier). The derived default is first.
- **Q3 - template lineage.** The pointed-at document, the last report of the same kind, or the clean analyst register (section 6). The derived default is first.

Non-blocking rule: ask, do not wait, and start collection. Write `brief.md` at once with every field and who answered it; the unanswered fields carry their defaults. A late answer is folded in until the assembly lane starts; after that it becomes a re-render request, handled like any other repair.

Recorded fields, under `## Deliverable` in `brief.md`:

```text
lane: template-vibe
state: none
formats: pdf, docx (answered_by: request)
destination: internal review document (answered_by: default)
audience: engineering leads, standard (answered_by: user)
template: clean analyst register (answered_by: default)
format description: none
```

`answered_by` is one of `user`, `default`, `request`. Run `outcome init` (section 9) in the same step, with the formats as the promised list.

### The fidelity fields and the lock

The values below are read by `scripts/fidelity-policy.mjs`, the single registry: `SOURCE_FLOOR_RULES` and `parseSourceFloor()` for the `source floor` forms (`pointedFlag` in source registration reads the same grammar), and `FIDELITY_VALUE_RULES` for `derived numbers`, `languages`, `fallback`, and `meaning check`. `derived numbers` and `fallback` accept only the values in their row below (`FIDELITY_VALUE_RULES.tables`, any case); any other value, a free-text answer included, is a usage error (exit `2`) naming the field and the value, as an unknown `source floor` form is. Map a free-text answer onto a table value before writing it: a partial allowance ("growth rates yes, estimates no") records `derived numbers: none`.

Beside `## Deliverable`, the brief records what the report must stay faithful to, under `## Fidelity`. The fields are inferred first; only `as of`, `meaning check`, `source floor`, and `derived numbers` may be asked, each on its own trigger, in the same question call as Q1-Q3 (at most four questions in that call). The inference rules, the triggers, and the question texts are in `SKILL.md`.

| Field | Values | Default | Read by |
| --- | --- | --- | --- |
| `as of` | `latest at run start, <YYYY-MM-DD>`; one anchor (version, release, tag, commit, date, period); `multiple: <anchor>, <anchor>; rows tagged` | `latest at run start, <run date>` | `fact verify` (`quote_stale_version` when a quoted source's revision is not the anchor) |
| `meaning check` | `on`, `off`, `on; force strong: <scope>` | `on` in the full tier, `off` in the light tier | `fact pairs` (`off` writes `{"skipped": true}`) and the orchestrator's reader lanes |
| `source floor` | `standard`, `primary only`, `pointed only: <list>`, `classes: <list>` | `standard` | `fact fill` and `fact verify` (`source_outside_floor`) |
| `derived numbers` | `allowed`, `none` | `allowed` | `fact fill` and `fact verify` (`derived_not_allowed`) |
| `languages` | `report <lang>; sources <langs>; quotes original`, or `...; quotes original with translation beside` | report in the requester's language; quotes with translation when a source language differs | `fact fill` (whether a translation binds to its quote) |
| `identifier classes` | `none`, or a list of token classes | from the domain of the Phase 0 axes | recorded only: no gate enforces it yet |
| `fallback` | `block-quote`, `omit` | `block-quote` | `fact fill --replace-failed` |

```text
## Fidelity
as of: latest at run start, 2026-10-23 (answered_by: default)
meaning check: on (answered_by: default)
source floor: standard (answered_by: default)
derived numbers: pending (answered_by: pending)
languages: report en; sources en; quotes original (answered_by: default)
identifier classes: version strings, package names, commit ids (answered_by: default)
fallback: block-quote (answered_by: default)
asked: derived numbers
```

Each line is `<field>: <value> (answered_by: user|default|request|pending)`; values carry no parentheses, `pending` goes only with `answered_by: pending`, and `asked:` is an optional history line. A malformed line or a second block is a usage error (exit `2`) naming the line.

**The lock.** The brief is locked when all seven fields are present and none is `pending`. Six stages refuse an unlocked brief with one `fidelity_interview_incomplete` defect (blocker, integrity), exit `1`, and write nothing: `fact fill`, `fact verify`, `fact pairs`, `fact meaning-check`, `fact polish-apply`, `fact polish-diff`. Each reads `--brief`, default `$SESSION_DIR/brief.md`. Collection never waits: `source snapshot`, `fact add`, `fact quote`, `fact derive`, `fact retract`, `fact export`, and `claims index` never read the lock. Provisional defaults are written at brief time, so the lock fires only on a `pending` field still open when the assembly lane is about to start; that one question is then asked again, blocking.

**What fill and verify enforce.** At every `fact fill`, each placeholder's row is checked against the current lock, and `fact verify` checks every `data-fact` element of the edition against it again, so tightening the brief after fill fails the next verify:

- `derived numbers: none` refuses a `derived`, `converted`, or `assumed` row (`derived_not_allowed`): the requester was promised measured values only.
- The source floor is evaluated live against the `meta.json` of every source behind the row (a derived row's sources are its operands' sources): `pointed only: <list>` admits a source whose id (`S4`), URL, or path is in the list; `primary only` admits a source whose declared provenance is `primary` (`source snapshot --provenance primary|secondary`, default `unknown`; `secondary` and `unknown` are refused); `classes: <list>` admits a source whose URL host equals a listed host suffix or ends with `.<suffix>` (`sec.gov`, `go.kr`); `standard` refuses nothing. Under any floor but `standard`, a row resting on no source (an `assumed` row, or a derived row with such an operand) is refused as well: no source of it can be inside the floor. A refused row is `source_outside_floor`. Rows registered while the floor was pending are reclassified the moment it locks or changes. The row's `outside_floor` is the cached result of the last fill, never an input; fill writes it to the ledger even when it refuses.
- `languages` with `quotes original with translation beside` lets a `{{Q7:label}}` be followed by its translation, `<span data-translates="Q7">...</span>` in HTML or `<!-- translates: Q7 -->` and the sentence in Markdown; fill binds it to Q7, and `fact pairs` emits it as a `translation` pair. Under `quotes original` fill does not bind it.
- `fallback: omit` makes `--replace-failed` remove a twice-failed sentence instead of replacing it with an attributed block quote.
- Fill records `brief_sha256` in `<out>.fill-map.json`: the sha256 of the locked block normalized to its seven `field: value` lines in field order (`answered_by` and `asked:` excluded). `fact verify` reads that map (`--fill-map`, else `<report>.fill-map.json` when present) and refuses with `brief_changed` when the hash is not the current block's or the map has none; re-fill, then verify.

**Re-entry.** A session started before this block existed (an `edit-existing` run included) has no `## Fidelity`: run the inference step and write the block with `answered_by: default` before any `fact` command.

## 5. Report-format memory episodes

When the memory tool is present, the requester's report-format choices are kept as an append-only episode log, so a repeat requester is not asked the same question twice. When no memory tool is present, skip this section silently.

- Pointer: `system/human/report-style.md`, projected every session. One line naming the log, plus the generalizations currently in force.
- Episode log: `reference/human-report-style.md`, one line per episode, newest last:

```text
- [YYYY-MM-DD] <destination kind> · <audience> - <format and template chosen, one line> <!-- src: <session-id>; pattern: observed|declared; confidence: low|medium|high -->
```

Qualification (write after delivery, only when one of these holds): `declared` - the requester stated the preference outright ("always PDF only"); `observed` - the requester made the same unsolicited choice on 2 or more runs (read the log first). Record format and template choices only, never report content, subjects, names, or findings. Append; never rewrite an existing line.

Read-time generalization (before the interview): a similar context is one with the same destination kind and audience. Consistent similar episodes supply Q1's first option; a `declared` similar episode skips the question it answers. One session never flips a default: a single `observed` episode that disagrees with the rest changes nothing.

Pruning: keep the log near 15 lines. When it grows past that, prune the oldest episodes that agree with the majority for their context first. Never prune a `declared` episode or a minority episode (the only one recording a different choice for its context). Update the pointer in the same memory commit when a generalization changes.

## 6. design-spec.md

Write `$SESSION_DIR/design-spec.md` the moment the deliverable fields are known, before any asset lane starts. Every asset and assembly lane receives it.

1. When a document was pointed at, extract it first. Do not retype its stylesheet:
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" format-extract <reference.html|reference.md> --out "$SESSION_DIR/design-spec.md"
   node "$SKILL_DIR/scripts/report-tools.mjs" format-extract <https://...> --from-url --out "$SESSION_DIR/design-spec.md"
   ```
   The extractor copies the CSS custom properties (light and dark), font stacks by role, the most-used colors, px breakpoints, the section skeleton, the heading numbering, the citation marker style, the lineage mode, and the figure containers, under the fixed sections `Extracted from`, `Tokens`, `Typography`, `Layout`, `Structure`, `Figures`, `Citations`, `Open questions`. A field it cannot determine reads `TODO: ask`. A PDF reference is unsupported: ask for its HTML or Markdown source.
2. Fill every `TODO: ask` from the interview answers, then from the clean analyst register below. Never guess a value.
3. Apply the binding figure standard and the defaults:
   - Every figure sits in a fixed-size container with a caption; the image scales inside it with contain-fit, its aspect ratio preserved, never stretched, cropped, or spilling out. Every chart carries a title, axis labels, units, and value labels as real text, with deterministic ticks (round values computed from the data range, never left to a renderer's auto-scaling). A chart is plotted only from a `fact export --csv` file saved under `$SESSION_DIR/assets/`, its figure carries `data-chart-source` pointing at that file, and its axis tick labels sit inside one `<g class="ticks" data-tick-step=".." data-tick-min=".." data-tick-max="..">` group, so the fidelity gate can check every value label against the ledger and every tick against the declared grid.
   - One accent color over neutral background, text, and rule tones. Every color in prose, charts, and diagrams is a spec token.
   - For web deliverables, HTML/CSS bars and inline SVG are preferred over image charts, and the page has responsive breakpoints so it reads on a phone, a tablet, and a desktop.
   - Gothic (sans) type only, as a real embedded webfont for the report language; Korean text uses `word-break: keep-all; overflow-wrap: anywhere`.
   - A closing section on how the report was made (method, sources, members and waves, the gates it passed, what verification overturned) and a numbered sources section with access dates.
4. Declare the lineage mode on its own line in the spec:
   - `Lineage: inline` (the analyst default): every unit-bearing number carries `MEASURED`, `ASSUMED`, or `DERIVED` inline or in a `data-lineage` attribute, or a `[S<n>]` citation in the same element. The gate reports an untagged number as a major defect.
   - `Lineage: section` (web and blog register): sources are bracketed source-label links at sentence end (the report language's word for "source"), lineage distinctions live in the figure captions, and every section is cited. The gate reports an untagged number as an advisory minor defect; the section-citation gate carries the weight.

## 7. Delivery gates, in order

Nothing reaches the requester until the gates for its QA tier pass, in this order. Each gate writes its status into the manifest with `outcome gate <gate> <pass|fail|not_run> --session-dir "$SESSION_DIR"`.

1. **Static gates.** `check` on the rendered HTML:
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" check "$SESSION_DIR/report.html" --design-spec "$SESSION_DIR/design-spec.md" > "$SESSION_DIR/defects.json"
   ```
   It checks keep-all, palette tokens, emoji, em dashes in prose (en dashes outside numeric ranges are advisory), heading length and generic headings, unsourced numbers (section 6), figure containers and captions, chart SVG text, a report with no visual at all, images without alt text, Korean serif fonts, sections without citations, the closing section, the sources section, broken local assets, and any `--require-section <regex>` the brief requires. Every code, severity, and fix is in [report-gates.md](report-gates.md).
2. **Fidelity gate.** The fidelity verifier checks every number, quote, and claim binding against the fact ledger and the source snapshots; its codes are the Fidelity Gate table in [report-gates.md](report-gates.md). It runs before layout and visual QA because a content failure would otherwise force an expensive re-render.
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" fact verify "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"   # writes fidelity-defects.json
   ```
   Exit `1` on any blocker or major defect: record `outcome gate fidelity fail`; minors alone exit `0` and are listed. The grammar, the fill step, and the derivations are in section 11; this stage verifies HTML only.
3. **Layout gates.** Print the probe, evaluate it in the rendered page through the browser skill's owned headless engine, save the returned object as `$SESSION_DIR/boxes.json`, and re-run `check` with `--layout "$SESSION_DIR/boxes.json"`. It adds overflow past the container, clipped text, scroll containers, distorted images, and overlapping siblings.
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" layout-probe --json   # .source is one async expression
   ```
4. **Visual QA.** Render the artifact to images (PDF pages to PNG, the HTML in the browser skill's engine at desktop and phone widths) and look at the pixels for what a machine cannot see: composition, hierarchy, page breaks, figure legibility.
5. **Proofread.** A dedicated writing lane proofreads the final text only (grammar, spelling, punctuation, terminology, native register); it never composes or rewrites content and never edits the file. Edits change text only; an edit whose before/after would alter any tag, attribute, comment, or script/style content is rejected, and markup changes go through the full fidelity gates instead. It returns `polish-edits.json` (`[{before, after, reason}]`), which the orchestrator applies edit by edit; a rejected or unlocated edit goes back to the lane with its reason, within the repair budget. The backstop diff, `fact verify` on the polished file, and the meaning readers on the pairs whose sentences polish changed run before the fidelity gate is recorded again. Edits must not span entities (such as &amp; or &lt;) or markup; narrow the edit to the surrounding words instead, and a rejected edit comes back with the reason to act on.
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" fact polish-apply "$SESSION_DIR/report.html" --edits "$SESSION_DIR/polish-edits.json" --out "$SESSION_DIR/report.polished.html" --session-dir "$SESSION_DIR"
   node "$SKILL_DIR/scripts/report-tools.mjs" fact polish-diff --before "$SESSION_DIR/report.html" --after "$SESSION_DIR/report.polished.html" --session-dir "$SESSION_DIR"   # writes polish-defects.json
   node "$SKILL_DIR/scripts/report-tools.mjs" fact pairs "$SESSION_DIR/report.polished.html" --changed-since "$SESSION_DIR/report.html.fill-map.json" --session-dir "$SESSION_DIR"
   ```

**Every reader-facing edition is verified.** The main report, the inline edition (section 9), LaTeX per-section sources, and slide sources are filled by `fact fill` from one placeholder source and each is verified by `fact verify` into its own record; PDF and DOCX are renders of a verified source. A delivered row is recorded with `outcome set <format> delivered --path <file> --verified-by <record>`, where the record's `artifact_sha256` equals the sha256 of the delivered source; a PDF or DOCX adds `--rendered-from <source>` and is matched against that source. In a session with a fact ledger, `outcome verify` refuses a delivered row without a matching record (`edition_unverified`, blocker, integrity). Markdown and LaTeX verification arrive with the Markdown stage; until then `fact verify --format md|tex` exits `2`, and such an edition is recorded `blocked_capability` with that reason rather than delivered unverified.

The light tier runs gate 1 and one render (recorded as `visual`) and records `fidelity`, `layout`, and `proofread` as `not_run` (`fidelity not_run` needs `--reason "<why>"`); `fidelity` stays `not_run` in the light tier until Markdown deliverable support ships for the fidelity verifier. The full tier runs all five.

## 8. Bounded repair loop

After every gate run that produced defects, ask the tracker what to do next:

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" repair decide --state "$SESSION_DIR/repair-state.json" --defects "$SESSION_DIR/defects.json" --defects "$SESSION_DIR/fidelity-defects.json" --artifact-bytes <report bytes> --renders <rendered page count> --session-dir "$SESSION_DIR"
```

`--defects` repeats: every file (a `check` result, a `fact verify` record, or a bare defect array) joins one defect list, so one decision covers both gates.

- `action: repair`: fix the listed defects, re-render, re-run the gate, and ask again.
- `action: deliver`: stop repairing and deliver. `reason` is `clean` or the stop condition that fired; the residual defects are written into the manifest and listed in the closing briefing.
- `action: block` (exit `1`): do not deliver. Either a content-integrity defect remains (`missing_closing_section`, `missing_citation_section`, `broken_asset_reference`, `missing_required_section`, `missing_promised_deliverable`, or a fidelity integrity code: `unresolved_placeholder`, `value_mismatch`, `unit_mismatch`, `quote_not_verbatim`, `claim_status_invalid`, `incompatible_operands`, `pointer_label_mismatch`, `quote_anchor_unresolved`, `unit_duplicated`, `polish_diff_fail`, `fidelity_interview_incomplete`, `derived_not_allowed`, `source_outside_floor`, `brief_changed`, `snapshot_hash_mismatch`, `chart_value_untraceable`, `quote_unbound`, `edition_unverified`), or a stop fired without proof of a usable artifact (`--artifact-bytes` and `--renders`). Tell the requester what blocks delivery and record the affected rows as `failed` with the reason.

**The fidelity barrier is separate from the budget.** A `deliver` decision does not release fidelity defects: `outcome verify` and `outcome finish` use the fidelity gate's `blocksDelivery` predicate over `DEFECT_CODES` (integrity, blocker, or major), never a CLI code list or the row's claimed severity. Unknown codes refuse with `unknown defect code <code>`; known blockers produce `fidelity_unresolved`. Fix the defect and re-verify the edition before delivery. The table and the record schema in `scripts/fidelity-records.mjs` are the spec for the barrier. Every fidelity record carries one envelope (`record_kind`, `artifact_sha256`, `report`, `written_at`, `defects`) plus the fields its kind declares; a record with a missing, unknown, or ill-typed field refuses as malformed (`edition_unverified`). `FIDELITY_RECORDS` has one row per record kind, each rule a column: where its records are, when a delivered session must carry one, the envelope field that binds it to the delivered bytes (`artifact_sha256`), and which defects block. The rows are `fidelity` (`fact verify`, one record per delivered edition, named by `--verified-by`) and `meaning` (`fidelity-meaning-defects.json` from `fact meaning-check`, one per session, required while the locked brief's `meaning check` is `on` or its `## Fidelity` block is malformed; missing: `meaning gate not run`, the same `edition_unverified` refusal, released only by the logged `fidelity not_run` exemption in a session with no ledger or fidelity record). A record whose `artifact_sha256` matches no delivered edition's source bytes refuses as `is for a different edition`, so a meaning record from an earlier draft never passes a rewritten one: rerun `fact pairs` and the readers after every rewrite. A `meaning_drift_confirmed` or `meaning_unverified` in that record holds the barrier like any other major.

**After a dispute.** `--dispute P<n> --reason` records the disagreement in the calibration log; it does not clear the defect, so `fact meaning-check` keeps exiting `1` and the barrier keeps holding by design. Proceed through `repair decide` with `fidelity-meaning-defects.json` among its `--defects` (the dispute stays recorded on that run): the writer changes the sentence (rewrite it from the quote, or `fact fill --replace-failed` for a sentence that failed twice), then rerun `fact pairs` and the readers. There is no path that delivers a disputed `meaning_drift_confirmed` sentence unchanged.

Defaults: 3 repair attempts, a plateau of 2 consecutive attempts that do not improve the (blocker, major, minor) counts compared in that order, and 15 minutes of wall clock from the first decision. A defect set that repeats an earlier attempt exactly stops the loop as an oscillation. When several conditions hold at once the reported reason follows `clean`, `blocking`, `oscillation`, `plateau`, `max_attempts`, `wall_clock`.

## 9. Outcome manifest and closing briefing

`$SESSION_DIR/outcome.json` tracks every promise made about the output, so a promised format is never silently dropped.

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" outcome init --promised pdf,docx --lane template-vibe --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome set pdf delivered --path "$SESSION_DIR/report.pdf" --rendered-from "$SESSION_DIR/report.html" --verified-by "$SESSION_DIR/fidelity-defects.json" --pages 12 --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome set docx blocked_capability --reason "no document converter in this session" --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome render "$SESSION_DIR/renders/page-01.png" --page 1 --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome verify --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome finish --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome briefing --session-dir "$SESSION_DIR"
```

- `init` runs when the brief is written (section 4): one `pending` row per promised format (`pdf`, `docx`, `html`, `md`, `latex`, `slides`, `post`).
- `set` resolves a row: `delivered` (absolute path; bytes are read from disk; pages when paginated), `blocked_capability` (this session cannot produce it), `skipped` (the requester or the lane dropped it), or `failed`. Every status except `delivered` needs `--reason`; `outcome set <format> delivered` records intent permissively, while the required `outcome verify` and `outcome finish` enforce the delivery barrier.
- `verify` runs before delivery and exits `1` while a row is `pending`, a status lacks its reason, a delivered file is missing or empty, a registry blocker remains (`fidelity_unresolved`), or a delivered edition has no matching verify record (`edition_unverified`, section 7). Delivered HTML/PDF/DOCX without any ledger or record also refuse with `fidelity gate not run`; explicitly record `outcome gate fidelity not_run --reason "<text>"` to exempt an unverified edition. With `meaning check: on`, or a malformed `## Fidelity` block (which cannot prove the check off), a delivered session without `fidelity-meaning-defects.json` refuses with `meaning gate not run` under the same rule; a meaning record for bytes no delivered edition has refuses as `is for a different edition`. This choice is logged in `gateHistory` with its timestamp and reason; it never releases an existing ledger requirement, record, or defect, and a subsequent fidelity gate status replaces the exemption.
- `finish` refuses (exit `1`, nothing stamped) while the fidelity barrier holds.
- `finish` stamps the finish time, the elapsed minutes from the session directory's start stamp, and the source and domain counts from `sources-ledger.md`.
- `briefing` prints the closing block from the manifest and the ledger: sources and distinct domains, elapsed minutes, every deliverable with its status, the gate results, the residual defects, and the repair summary. That text is the closing briefing, pasted as printed, never filled in from memory.

### Showing the report inline

When the session has a tool that shows a self-contained HTML page inline in the conversation (`show_html_page` in OmO, `html_render` on hosts that offer it), the requester sees the report there first, after `verify` passes and before the closing briefing. A path to a file the requester has to go and open is not the first thing they read.

- **Which page.** The gated `report.html` itself when the promised deliverable is a self-contained HTML report within the tool's size limit. Otherwise (a PDF, DOCX, LaTeX, or slide deliverable, or an HTML report over the limit) build an inline edition from the same `SYNTHESIS.md` and the same assets: the answer, the headline figures, the reference-compare pairs when the run has them, the key findings with their citations, the numbered sources, and the paths of the promised artifacts. Run `check` on the inline edition like any HTML deliverable.
- **Self-contained.** No network: styles and scripts inline, no remote fonts, no CDN. Pass local images as absolute file paths (the tool inlines them) or as data URIs. Render it once at the reply width and at 390 px before showing it, and pass the measured height. When the session has the `visualize` skill, follow its inline-page constraints.
- **Every tier, and always the report.** A light-tier chat answer with no promised document still ends with an inline page: the answer, its figures, the reference-compare pairs, and the sources. When the thing built is itself a page (an app, a 3D scene, a demo), show it too, but it never stands in for the report page, and a page that only links or redirects to a file is not a report.
- **Not a manifest format.** The inline page never replaces or resolves a promised format; every manifest row still ends `delivered`, `blocked_capability`, `skipped`, or `failed` with its own artifact.
- **No inline tool.** Deliver the artifact paths and the chat summary as before.

## 10. Command reference

Invoke every command as `node "$SKILL_DIR/scripts/report-tools.mjs" <command>`. Exit codes for all of them: `0` pass, `1` semantic failure, `2` usage or IO error.

| Command | Flags | Exit `1` when |
| --- | --- | --- |
| `check <report.html>` | `--design-spec <spec>` (required), `--layout <boxes.json>`, `--require-section <regex>` (repeatable), `--max-defects N` | any blocker defect |
| `layout-probe` | `--cap N` (default 400), `--root <selector>` (default `main, article`), `--json` | never |
| `repair decide` | `--state <file>` and `--defects <json>` (required; repeatable, the files are concatenated), `--artifact-bytes N`, `--renders N`, `--session-dir <dir>`, `--max-attempts N`, `--plateau-limit N`, `--wall-clock-ms N`, `--now <ISO>` | the decision is `block` |
| `outcome init` | `--promised <list>` (required), `--lane <lane>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `outcome set <format> <status>` | `--path <file>`, `--pages N`, `--reason <text>`, `--verified-by <fidelity record>`, `--rendered-from <source>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `outcome gate <gate> <status>` | `--session-dir <dir>`, `--now <ISO>`, `--reason <text>` (required for `fidelity not_run`; logged in `gateHistory`) | never (a missing reason exits `2`) |
| `outcome render <png>` | `--page N` (required), `--session-dir <dir>` | never |
| `outcome state` | `--deliverable <path>` (required), `--session-dir <dir>` | never |
| `outcome verify` | `--session-dir <dir>` | a promise is unresolved, a delivered file is missing or empty, `fidelity_unresolved`, or `edition_unverified` |
| `outcome finish` | `--ledger <file>`, `--session-dir <dir>`, `--now <ISO>` | the fidelity barrier holds (section 8) |
| `outcome briefing` | `--json`, `--ledger <file>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `format-extract <reference>` | `--out <design-spec.md>` (required), `--from-url` | never (an unsupported reference exits `2`) |
| `--help` | `--json` | never |
| `source snapshot` | `--id S<n>` (required), one of `--url <u>`, `--html <file>`, `--text <file>` (with optional `--extractor NAME@VERSION`), `--command '<argv json>' --cwd <dir>`; `--kind page\|command\|document`, `--provenance primary\|secondary` (default `unknown`, read by `source floor: primary only`), `--revision <r>`, `--session-dir <dir>` | the id already holds different content (`snapshot_exists`) |
| `fact add` | `--source S<n>` with `--find <text>` (`--unit-expected <unit>`), or `--table <id> --row <label> --col <label>`, or `--page N --line N`; `--label`, `--entity`, `--valid-at`, `--population`, `--accounting-basis`, `--observation O<n>`, `--json`, `--session-dir <dir>`. Or `--assumed <value> --unit <unit> --rationale <text> --label <label>` | `fact_not_located`, `fact_ambiguous`, `unit_mismatch` (no row written) |
| `fact quote` | `--source S<n> --match <text>` (required), `--label`, `--json`, `--session-dir <dir>` | `fact_not_located`, `fact_ambiguous` |
| `fact retract <id>` | `--reason <text>` (required), `--replacement <id>`, `--session-dir <dir>` | never (an illegal transition exits `2`) |
| `fact export` | `--csv`, `--out <file>`, `--session-dir <dir>` | never |
| `fact fill <src>` | `--out <file>` or `--view`, `--format html\|md\|tex`, `--inline`, `--replace-failed`, `--brief <brief.md>`, `--session-dir <dir>` | `fidelity_interview_incomplete`, `derived_not_allowed`, `source_outside_floor` (section 4), or a fill error: no edition, fill map, or state is written; the ledger's cached `outside_floor` is (section 4). Off-table `derived numbers` or `fallback` exits `2` |
| `fact verify <report>` | `--format html\|md` (from the extension by default), `--sources <dir>`, `--claims <claims.json>`, `--fill-map <file>` (a Markdown edition reads `<report>.fill-map.json` by default), `--brief <brief.md>`, `--out <record>`, `--session-dir <dir>` | `fidelity_interview_incomplete` (no record written), or any blocker or major defect, `brief_changed`, `derived_not_allowed`, and `source_outside_floor` under the current brief included (section 4) |
| `fact pairs <report>` | `--format html\|md`, `--ledger <fact-ledger.json>`, `--claims <claims.json>`, `--changed-since <fill-map.json>` (keep only the pairs whose sentence text is not in the pre-polish artifact that map names, so the readers re-check exactly what polish rewrote; the map must carry `artifact_sha256` and the artifact must still hash to it, otherwise the command exits `2`), `--brief <brief.md>`, `--out <pairs.json>`, `--session-dir <dir>` | `fidelity_interview_incomplete` (with `meaning check: off` it writes `{"skipped": true}` and exits `0`) |
| `fact polish-apply <report.html>` | `--edits <polish-edits.json>` and `--out <report.polished.html>` (both required; a missing flag or a Markdown edition exits `2`), `--format html`, `--ledger <fact-ledger.json>`, `--brief <brief.md>`, `--session-dir <dir>` | `fidelity_interview_incomplete` (nothing written); otherwise never: it exits `0` whenever it wrote the output. Each rejected (`polish_edit_rejected`) or unlocated (`polish_edit_unlocated`) edit leaves its text unchanged and is printed verbatim, one line per rejection, in the summary and in `data.rejected_reasons`; `data` also carries `applied`, `rejected`, `unlocated`, `applied_indexes`, `input_sha256`, `edits_sha256`, and `out_sha256` |
| `fact polish-diff` | `--before <pre-polish.html>` and `--after <polished.html>` (both required; a missing flag exits `2`), `--ledger <fact-ledger.json>`, `--out <record>` (default `$SESSION_DIR/polish-defects.json`), `--brief <brief.md>`, `--session-dir <dir>` | `fidelity_interview_incomplete` (nothing written), or a registry blocker in the diff (majors and minors are reported and exit `0`; a defect code the registry does not know refuses with `unknown defect code <code>`). The record is `{command, status, exitCode, before, artifact, artifact_sha256, defects[], counts}`, with `counts` in contract buckets |
| `fact meaning-check` | `--pairs <pairs.json>` and `--verdicts <file>` (required; repeatable, one per reader tier), `--dispute P<n> --reason <text>`, `--run-id <id>`, `--calibration <file>` (default `fidelity-calibration.jsonl`), `--brief <brief.md>`, `--out <record>` (default `fidelity-meaning-defects.json`), `--session-dir <dir>` | `fidelity_interview_incomplete`, or `meaning_drift_confirmed` (stderr carries one JSON line with the defect and dropped-verdict counts) |
| `fact derive` | `--op <op>` (required) with the operation's operands (section 11), `--unit`, `--to`, `--rationale`, `--disjoint`, `--label`, `--json`, `--session-dir <dir>` | `incompatible_operands` (no row written) |
| `claims index <claim-graph.md>` | `--out <claims.json>` (required) | never (a malformed claim table exits `2`) |

## 11. Fidelity gate

Every number, quotation, and chart value in a reader-facing edition comes from the fact ledger (`$SESSION_DIR/fact-ledger.json`, schema and operations in [fact-ledger.md](fact-ledger.md)), which is built only from source snapshots (`$SESSION_DIR/sources/S<n>/`). Nobody types a value into a report. The commands, in the order a run uses them:

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" source snapshot --id S4 --url https://example.org/bridge --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" fact add --source S4 --find "Span length" --label span_len --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" fact quote --source S4 --match "no earlier than 2027" --label completion --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" fact derive --op convert F1 --to mm --label span_mm --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" claims index "$SESSION_DIR/claim-graph.md" --out "$SESSION_DIR/claims.json"
node "$SKILL_DIR/scripts/report-tools.mjs" fact fill "$SESSION_DIR/report.src.html" --out "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" fact verify "$SESSION_DIR/report.html" --session-dir "$SESSION_DIR"
```

- **Snapshot.** A source directory is immutable: the same id with identical text is a no-op, different text fails with `snapshot_exists`, because ledger rows pin the old hash; use a new id. `--url` fetches with plain fetch (30 s timeout, no browser) and records extractor `tool:source-snapshot@1`. `--html` and `--text` import a capture the browser lane saved and record extractor `model` (lower trust), or the named extractor with `--text --extractor NAME@VERSION`. `--command` runs an argv without a shell, snapshots its stdout, and writes `command.json` with the argv, working directory, exit status, and output hashes.
- **Register.** `fact add` locates one quantity deterministically (`--find`: the first numeral within 80 characters after a unique anchor, in the same sentence; `--table`/`--row`/`--col` by header labels; `--page`/`--line`) and prints the row with 60 characters of source context on each side (`--json` for the full row). `fact quote` stores the whole containing sentence. The row records the source's kind, URL, host, and whether the brief's source floor points at it. A failed locate writes nothing.
- **Write by reference.** Placeholders: `{{F12:span_len}}` (value and unit), `{{F12:span_len:value}}`, `{{F12:span_len:unit}}`, `{{F12:span_len:q}}` (with the source qualifier), `{{Q7:completion}}`, `{{Q7:completion:lead=8}}`, `{{Q7:completion:from="no earlier":to="2027"}}`. The label must equal the row's label.
- **Fill.** `fact fill` is all or nothing: on `pointer_label_mismatch`, `unresolved_placeholder`, `quote_anchor_unresolved`, or `unit_duplicated` it exits `1` and writes nothing. On success it writes the output and `<out>.fill-map.json`. `--view` prints the rendered text without writing; `--inline` builds the inline edition (local stylesheets and scripts inlined, image paths made absolute) from the same source; `--format md` and `--format tex` fill Markdown and LaTeX sources; `--replace-failed` replaces a sentence that failed twice with an attributed block quote of its source.
- **Verify.** `fact verify` writes its record (default `fidelity-defects.json`; `--out` for another edition) with the verified file's `artifact_sha256`, reads `claims.json` and the locked `## Fidelity` block of `brief.md`, and exits `1` on any blocker or major defect; minors alone exit `0`. A Markdown edition (`--format md`, or a `.md` path) is verified with its fill map; a LaTeX edition is verified through its Markdown source, so `--format tex` exits `2`.
- **Meaning.** With `meaning check: on`, `fact pairs` writes the pairs a separate reader session judges, and `fact meaning-check` turns the readers' verdicts into `fidelity-meaning-defects.json` and the calibration log (verdict schema in [fact-ledger.md](fact-ledger.md)). No script calls a model.
- **Export.** `fact export --csv --out "$SESSION_DIR/assets/<chart>.csv"` writes `fact_id,label,plot_value,unit` for every active value row, the only data a chart may plot, and prints `N of M sources snapshotted, by extractor: ...` for the closing briefing.

Derivations are computed in exact rationals from the operands' stored values and rendered at the operands' fewest significant figures; a refused operation exits `1` with `incompatible_operands` and writes no row.

| Operation | Operands | Checks |
| --- | --- | --- |
| `sum` | two or more ids, `--unit` | one unit; summing `%` needs `--disjoint` and `--rationale` |
| `diff` | two ids (minuend, subtrahend) | one unit; a difference of `%` is in `pp` |
| `growth` | `--from <id> --to <id>` | one declared entity, two different `valid_at` periods, a positive start; result in `%` |
| `ratio` | `--num <id> --den <id>`, `--unit` | a non-zero denominator |
| `share` | `--part <id> --whole <id>` | one unit; result in `%` |
| `convert` | one id, `--to <unit>` | a known conversion between the units |
| `expr` | a formula over ids, `+ - * /`, `0`, `1`, `100`, `--unit`, `--rationale` | none (recorded `unchecked`) |

Exit codes: `0` ok; `1` a semantic failure (`fact_not_located`, `fact_ambiguous`, a fill error, `incompatible_operands`, `snapshot_exists`, or a verify record with a blocker or major defect); `2` usage, an unreadable input, or an invalid ledger write.
