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

QA tiers: **light** runs the static gates and one render check of the answer. **Full** runs the static gates, the layout gates, visual QA of every page, and the proofread gate (section 7).

## 4. The empty-info interview

The interview has exactly three questions, asked together through the harness question tool without waiting for the answer. A question is **skipped** when the request, the destination, a pointed-at document, or a declared memory episode already answers it; when all three are answered, nothing is asked.

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
   - Every figure sits in a fixed-size container with a caption; the image scales inside it with contain-fit, its aspect ratio preserved, never stretched, cropped, or spilling out. Every chart carries a title, axis labels, units, and value labels as real text, with deterministic ticks (round values computed from the data range, never left to a renderer's auto-scaling).
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
   It checks keep-all, palette tokens, emoji, em dashes in prose (en dashes outside numeric ranges are advisory), heading length and generic headings, unsourced numbers (section 6), figure containers and captions, chart SVG text, Korean serif fonts, sections without citations, the closing section, the sources section, broken local assets, and any `--require-section <regex>` the brief requires. Every code, severity, and fix is in [report-gates.md](report-gates.md).
2. **Layout gates.** Print the probe, evaluate it in the rendered page through the browser skill's owned headless engine, save the returned object as `$SESSION_DIR/boxes.json`, and re-run `check` with `--layout "$SESSION_DIR/boxes.json"`. It adds overflow past the container, clipped text, scroll containers, distorted images, and overlapping siblings.
   ```bash
   node "$SKILL_DIR/scripts/report-tools.mjs" layout-probe --json   # .source is one async expression
   ```
3. **Visual QA.** Render the artifact to images (PDF pages to PNG, the HTML in the browser skill's engine at desktop and phone widths) and look at the pixels for what a machine cannot see: composition, hierarchy, page breaks, figure legibility.
4. **Proofread.** A dedicated writing lane proofreads the final text only (grammar, spelling, punctuation, terminology, native register); it never composes or rewrites content.

The light tier runs gate 1 and one render (recorded as `visual`) and records `layout` and `proofread` as `not_run`. The full tier runs all four.

## 8. Bounded repair loop

After every gate run that produced defects, ask the tracker what to do next:

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" repair decide --state "$SESSION_DIR/repair-state.json" --defects "$SESSION_DIR/defects.json" --artifact-bytes <report bytes> --renders <rendered page count> --session-dir "$SESSION_DIR"
```

- `action: repair`: fix the listed defects, re-render, re-run the gate, and ask again.
- `action: deliver`: stop repairing and deliver. `reason` is `clean` or the stop condition that fired; the residual defects are written into the manifest and listed in the closing briefing.
- `action: block` (exit `1`): do not deliver. Either a content-integrity defect remains (`missing_closing_section`, `missing_citation_section`, `broken_asset_reference`, `missing_required_section`, `missing_promised_deliverable`), or a stop fired without proof of a usable artifact (`--artifact-bytes` and `--renders`). Tell the requester what blocks delivery and record the affected rows as `failed` with the reason.

Defaults: 3 repair attempts, a plateau of 2 consecutive attempts that do not improve the (blocker, major, minor) counts compared in that order, and 15 minutes of wall clock from the first decision. A defect set that repeats an earlier attempt exactly stops the loop as an oscillation. When several conditions hold at once the reported reason follows `clean`, `blocking`, `oscillation`, `plateau`, `max_attempts`, `wall_clock`.

## 9. Outcome manifest and closing briefing

`$SESSION_DIR/outcome.json` tracks every promise made about the output, so a promised format is never silently dropped.

```bash
node "$SKILL_DIR/scripts/report-tools.mjs" outcome init --promised pdf,docx --lane template-vibe --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome set pdf delivered --path "$SESSION_DIR/report.pdf" --pages 12 --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome set docx blocked_capability --reason "no document converter in this session" --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome render "$SESSION_DIR/renders/page-01.png" --page 1 --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome verify --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome finish --session-dir "$SESSION_DIR"
node "$SKILL_DIR/scripts/report-tools.mjs" outcome briefing --session-dir "$SESSION_DIR"
```

- `init` runs when the brief is written (section 4): one `pending` row per promised format (`pdf`, `docx`, `html`, `md`, `latex`, `slides`, `post`).
- `set` resolves a row: `delivered` (absolute path; bytes are read from disk; pages when paginated), `blocked_capability` (this session cannot produce it), `skipped` (the requester or the lane dropped it), or `failed`. Every status except `delivered` needs `--reason`.
- `verify` runs before delivery and exits `1` while a row is `pending`, a status lacks its reason, or a delivered file is missing or empty.
- `finish` stamps the finish time, the elapsed minutes from the session directory's start stamp, and the source and domain counts from `sources-ledger.md`.
- `briefing` prints the closing block from the manifest and the ledger: sources and distinct domains, elapsed minutes, every deliverable with its status, the gate results, the residual defects, and the repair summary. That text is the closing briefing, pasted as printed, never filled in from memory.

## 10. Command reference

Invoke every command as `node "$SKILL_DIR/scripts/report-tools.mjs" <command>`. Exit codes for all of them: `0` pass, `1` semantic failure, `2` usage or IO error.

| Command | Flags | Exit `1` when |
| --- | --- | --- |
| `check <report.html>` | `--design-spec <spec>` (required), `--layout <boxes.json>`, `--require-section <regex>` (repeatable), `--max-defects N` | any blocker defect |
| `layout-probe` | `--cap N` (default 400), `--root <selector>` (default `main, article`), `--json` | never |
| `repair decide` | `--state <file>` and `--defects <json>` (required), `--artifact-bytes N`, `--renders N`, `--session-dir <dir>`, `--max-attempts N`, `--plateau-limit N`, `--wall-clock-ms N`, `--now <ISO>` | the decision is `block` |
| `outcome init` | `--promised <list>` (required), `--lane <lane>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `outcome set <format> <status>` | `--path <file>`, `--pages N`, `--reason <text>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `outcome gate <gate> <status>` | `--session-dir <dir>` | never |
| `outcome render <png>` | `--page N` (required), `--session-dir <dir>` | never |
| `outcome state` | `--deliverable <path>` (required), `--session-dir <dir>` | never |
| `outcome verify` | `--session-dir <dir>` | a promise is unresolved or a delivered file is missing or empty |
| `outcome finish` | `--ledger <file>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `outcome briefing` | `--json`, `--ledger <file>`, `--session-dir <dir>`, `--now <ISO>` | never |
| `format-extract <reference>` | `--out <design-spec.md>` (required), `--from-url` | never (an unsupported reference exits `2`) |
| `--help` | `--json` | never |
