# Fact ledger

`$SESSION_DIR/fact-ledger.json` holds every number and every direct quotation a research run may put in front of a reader. Rows come only from a source snapshot (through a deterministic locator), from a script-computed derivation, or from an explicit assumption with a rationale. A report source never carries a typed value: it carries a placeholder, and `fact fill` renders the row. The validity rules (ids, per-kind columns, the status machine) are in [fact-ledger-grammar.md](fact-ledger-grammar.md); this file is the working guide.

Every command is `node "$SKILL_DIR/scripts/report-tools.mjs" <command> --session-dir "$SESSION_DIR"`; the flags and exit codes are in [deliverable-phase.md](deliverable-phase.md), sections 10 and 11.

## Files

| Path | Written by | Holds |
| --- | --- | --- |
| `sources/S<n>/text.txt` | `source snapshot` | the extracted text the locators read (one line per block; pages joined by a form feed); `sha256` covers this file |
| `sources/S<n>/source.html` | `source snapshot` (page sources) | the captured page, read by the table locator |
| `sources/S<n>/meta.json` | `source snapshot` | `source_id`, `url`, `observed_at`, `sha256`, `extractor`, `revision`, `kind`, `provenance` |
| `sources/S<n>/sentences.jsonl`, `acronyms.json` | `source snapshot` | the sentence index (`S<n>:s<k>`) and the acronym table the fidelity gate reads |
| `sources/S<n>/command.json` | `source snapshot --command` | argv, working directory, exit status, stdout and stderr hashes |
| `fact-ledger.json` | `fact add`, `fact quote`, `fact derive`, `fact retract` | `{ schemaVersion: 1, rows, events }` |
| `claims.json` | `claims index` | the claim table and the `verified-claims` membership |
| `fidelity-defects.json` | `fact verify` | the verify record: the fidelity envelope (`record_kind: "fidelity"`, `artifact_sha256`, `report`, `written_at`, `defects`) plus `command`, `status`, `exitCode`, `format`, `counts`, `gatesRun` |
| `fidelity-meaning-defects.<format>.json` | `fact meaning-check --edition <format>` | one delivered edition's meaning record (without `--edition`, the legacy session record `fidelity-meaning-defects.json`): the fidelity envelope (`record_kind: "meaning"`) plus the run fields under Meaning verdicts |

A source directory is immutable. Snapshotting the same id again with the same text is a no-op; different text fails with `snapshot_exists`, because rows pin the snapshot hash. `--replace` swaps in a corrected capture under the same id only while no active row cites it (otherwise `snapshot_pinned`, listing the rows); the replacement drops the old `source.html`, `conversion.json` and `command.json`.

HTML snapshotting (`--html`, `--url`) probes its own conversion and writes `sources/S<n>/conversion.json` through `writeFidelityRecord` (the `source_conversion` envelope with `conversion_altered_numbers`, `lost`, `raw_count`, `converted_count`); `source snapshot` prints the altered list. `fact add` and `fact quote` refuse a located value, or a number in its sentence, that the list names (`conversion_altered_number`, no row written): write a verified text of the source, run `source snapshot --id S<n> --text <verified.txt> --replace`, and add from it. Numbers are compared with one grouped-number grammar (a 1-3 digit lead, 3-digit groups with one separator type, no digit after the last group; a lone period group such as `1.234` is a decimal). A cell, row, list-item, block or line break never joins digits, digits from a link target, image source, alt text or title cover a converted number only inside Markdown link or image syntax, a converter's line-start list marker (`1. `, `2) `, `(3) `) is exempt only when the source has an `<ol>` item with that number and the markers do not outnumber the `<ol>` items (lazy `1. 1. 1.` numbering passes), a numeric reference label (`[x][1]` with its `[1]: url`) is link syntax, a footnote definition (`[^1]: text`) exempts only its label and its text stays prose, and a space-grouped number a hard wrap split over one line break is read whole when the source holds it whole and not both halves (raw `12 345 and 12 and 345` wrapped inside `12 345` reports both halves). A `-` or U+2212 after a single letter (`x-5`) or an exponent (`1e-5`) is a sign; after an identifier such as `cite_note-7` or `UTF-8` it is not. Markdown markup never decides a sign: emphasis, code, strike, link or image closers before a dash are skipped, read with the CommonMark inline grammar (titles, parentheses inside a target, reference endings and backslash-escaped closers included: `**2019**-2023` and `[1990](/wiki/1990 "1990")-2000` are ranges, `*UTF*-8` an identifier), and an opener between a sign and its digits (`-**5**`) keeps the sign. Named character references (`&minus;`, `&thinsp;`, `&numsp;`) are decoded on both sides with one table, so a verbatim copy probes clean. Raw inline HTML a converter leaves in its Markdown (pandoc's gfm writer keeps `<sup>`, `<sub>`, sized `<img>`, `<span>`, `<br>`) is read with the same tag reader as the raw side: `<sup>`, `<sub>` and break tags are boundaries, any other tag or comment is dropped with its attributes. A reference definition's title may sit alone on the next line. `source probe-conversion <raw-file> <converted-file>` runs the same probe on your own conversion; `lost` is a warning only.

### Conversion probe scope

The probe guarantees these converter outputs: CommonMark links and images (inline, reference and autolink forms, titles, balanced parentheses, backslash escapes), emphasis, strike, code spans and lists; the tag set the html-lite tokenizer reads (`<sup>`, `<sub>`, the block and break tags as boundaries, every other tag and comment dropped); and the named-entity table in `scripts/entities.mjs` plus decimal and hex numeric references. A number the converter left unchanged inside this scope is not reported as altered.

#### Declared out of scope

- Custom converter syntaxes: shortcodes (`{{< figure src="chart-2019.png" >}}`), attribute blocks (`![x](i.png){width=640}`).
- MathJax and LaTeX (`$\frac{3}{4}$`, `\(\sqrt[3]{8}\)`).
- Non-CommonMark tables: AsciiDoc table attributes (`[cols="1,3"]`), and a spanning cell repeated once per column.
- Footnote extensions beyond pandoc's, such as numbered back-reference titles (`"Jump back to footnote 2 in the text"`).
- A reference definition whose destination sits on the next line, a legacy reference without its semicolon (`&nbsp`), a numeric reference padded past 6 hex or 7 decimal digits, and a converter that writes the text's `&` unescaped where it spells a reference.

Anything outside the guaranteed scope gets no allowance: every digit such a construct adds or reshapes is reported as altered (the safe direction: `fact add` refuses the number, it is never silently accepted). Recover with a verified text: `source snapshot --id S<n> --text <verified.txt> --replace`, then add from it. The probe's class table in the source repository has a row per example above that asserts the altered report, so the boundary is tested.

## Row fields

| Field | Meaning |
| --- | --- |
| `fact_id` | `F<n>` for a value, `Q<n>` for a quotation; assigned by the writer |
| `kind` | `measured` (located in a snapshot), `quote`, `derived`, `converted`, or `assumed` |
| `label` | the name a placeholder must repeat exactly (`[a-z0-9_-]`, up to 32 characters) |
| `value`, `unit`, `exact` | the decimal value as written, its normalized unit, and the exact rational the arithmetic uses |
| `raw`, `quote`, `value_span` | the source's own characters for the value, the whole containing sentence or cell, and where `raw` sits inside `quote` |
| `qualifier` | a bounding word the source puts on the value: `upper_inclusive` (up to, at most), `lower_inclusive` (at least), `approximate` (about), `near` (nearly), `lower_exclusive` (over, more than), `upper_exclusive` (under, less than) |
| `source_id`, `snapshot_sha256`, `sentence_id` | the snapshot the row was read from, its hash at that moment, and the sentence id |
| `locator` | where `quote` sits in `text.txt` (`artifact`, `line`, `page`, `char_start`, `char_end`, and `table`, `row_label`, `col_label` for a table cell), plus the source's `source_kind`, `url`, `host`, and `pointed` (whether the brief's source floor names it) |
| `extracted_by` | the snapshot's extractor: `tool:source-snapshot@1` (fetched or executed by the script), `model` (a capture the browser lane imported; lower trust), or `extractor:<name>@<version>`; `fact-derive` for a derivation |
| `observed_at`, `valid_at` | when the row was registered, and the period the value describes (`--valid-at`) |
| `entity`, `population`, `accounting_basis`, `observation_id` | declarations the derivations check (`--entity`, `--population`, `--accounting-basis`, `--observation O<n>`) |
| `operation`, `operands`, `derived_from`, `formula`, `factor`, `render` | for a derived or converted row: what was computed from which rows, and the rendered text |
| `rationale` | why an assumed value was chosen (required for `assumed`), or why an `expr` derivation is sound |
| `status` | `active`, `retracted`, or `superseded`; rows are never deleted, and each change appends an event |

## Locators

| Flags | Resolves |
| --- | --- |
| `--find "<anchor>"` | one normalized anchor occurrence, then the first numeral starting within 80 characters after it, in the same sentence; `--unit-expected` checks the unit |
| `--table <id or caption> --row <label> --col <label>` | the cell by header labels, never by index; duplicate labels fail |
| `--page N --line N` | exactly one numeral on that line of an extracted document |
| `--match "<words>"` (`fact quote`) | the unique sentence containing the words; the whole sentence is stored, so a later partial quote cannot drop its hedge |

A locator that finds nothing returns `fact_not_located`, more than one candidate `fact_ambiguous`, and nothing is written. Read the printed row and its 60 characters of context on each side before using it; a wrong row is retracted, never edited.

## Meaning verdicts

`ingestVerdicts(pairs, verdictFiles, options)` (`scripts/meaning-check.mjs`) folds the meaning readers' verdict files over the pairs of `extractPairs` and returns four lists:

| Field | Holds |
| --- | --- |
| `defects` | one `meaning_drift_confirmed` (both tiers named the same kind, never `other`) or `meaning_drift_warn` (one tier) per flagged pair, in pair order; the fragment comes from the verdict whose kind is reported |
| `dropped` | every verdict that was not accepted, with its file, pair, tier, and reason (unknown pair, invalid tier or verdict, unknown or empty drift kind, a fragment missing from the sentence or the source) |
| `unverified` | every pair no reader judged (`no_verdict`) and every `force_strong` pair no strong reader judged (`no_strong_verdict`), in pair order; a dropped verdict does not count as read |
| `calibrationLines` | one JSON line per flagged pair, appended to `fidelity-calibration.jsonl` when `calibrationPath` is given |

Coverage is fail-closed. A consumer treats a non-empty `unverified` list as blocking: those pairs were never read, so an empty `defects` list does not mean the report is clean. An unreadable verdict path or invalid JSON raises a `TypeError` naming the file, which the CLI maps to exit code 2.

`fact meaning-check` writes these lists into the edition's meaning record (`fidelity-meaning-defects.<format>.json` with `--edition <format>`, else `fidelity-meaning-defects.json`) through the one fidelity record writer (`writeFidelityRecord` in `scripts/fidelity-records.mjs`). The record is the envelope every fidelity record carries, `record_kind` (`meaning`), `artifact_sha256` and `report` (copied from `pairs.json`, so the record names the edition the readers judged), `written_at`, and `defects` (the folded defects plus one `meaning_unverified` per unread pair), followed by the run fields `command`, `status`, `exitCode`, `run_id`, `pairs_sha256`, `counts`, `dropped`, `unverified`, `calibration_path`, `calibration_written`, `calibration_replaced`, and `promotion_eligibility`. Any other field makes the record malformed. A pairs file without `artifact_sha256` and `report` exits 2 before anything is written. The delivery barrier binds each delivered edition to its own record (else any edition meaning record for the same bytes, else the legacy file) and refuses that edition when its source bytes do not hash to the record's `artifact_sha256`, so a rewrite needs a fresh `fact pairs` and reader run for that edition.

## Operations

- `fact add --source S<n> <locator> --label <label>` registers a measured row; `fact add --assumed <value> --unit <unit> --rationale <why> --label <label>` registers an assumption.
- `fact quote --source S<n> --match "<words>" --label <label>` registers a quotation.
- `fact derive --op <sum|diff|growth|ratio|share|convert|expr> ...` computes a new row from active rows and prints its id; the placeholder uses that id. Operands go by position for sum, diff, and convert (`--to <unit>`), as `--from/--to`, `--part/--whole`, or `--num/--den` for growth, share, and ratio, and as one formula argument for expr. Every op except convert declares its result unit with `--unit <unit>` (`--unit null` for dimensionless); a `%` sum also needs `--disjoint --reference <denominator> --rationale <why>`. The unit rules are in `unit-rules.md`.
- `fact retract <id> --reason <why>` retires a row; `--replacement <id>` marks it superseded by another active row. Rows that depend on a retired row fail at fill time.
- `fact export --csv --out <file>` writes `fact_id,label,plot_value,unit` for every active value row: the only data a chart may plot.
- `fact fill <src> --out <file>` renders every placeholder from the ledger; `fact verify <file>` checks the edition against the ledger, snapshots, and claim index. A `:value` placeholder keeps its unit in metadata: verify checks the unit written right after the value (with or without a space, a Korean particle allowed: `{{F1:span_len:value}} m`, `{{F3:rate_yoy:value}}%`), a currency sign right before it, its `:unit` element, and the header of its visual table column. The unit after the value is read through inline markup, line breaks and parentheses (`{{F1:span_len:value}} <b>m</b>`, `{{F1:span_len:value}}<br>m`, `{{F1:span_len:value}} (m)`), with a Korean particle or qualifier glued on; a qualifier word on its own (the Korean qualifiers such as chogwa "over" or jeongdo "about", or `or more`) is never read as a unit, and an English unit alias that is also an ordinary word (`won`, `second`, `pound`) counts only as the row's own unit or beside a currency sign or column header of its kind (`$320 pounds` blocks). The longest unit the words after the value spell is the one read, so a longer unit that starts with the row's unit is never taken for it (`12 % p`, `12 percent points` and the spaced Korean percent-point spellings are `%p`, not `%`); English words join only as a spaced alias (`percentage points`), so `m in` stays `m`. Fill records the mode and the unit bound to each value (after it, as its currency sign, or in its column header) in the fill map as `unit_bound`, and verify reads that map for HTML too, so deleting `data-fact-mode`, or replacing or deleting a bound unit, still blocks. A conflicting unit blocks with `unit_mismatch`; no recognizable unit warns with `unit_unbound`. `outcome set <format> delivered` records intent; `outcome verify` and `outcome finish` enforce delivery.
- `fact pairs <file>` writes `pairs.json` for the meaning readers; `fact meaning-check --pairs pairs.json --verdicts <file> ...` ingests their verdicts.

## Meaning command

`pairs.json` is `{ schemaVersion, skipped, report, format, artifact_sha256, pairs_sha256, counts, verdict_schema, pairs }`. `verdict_schema` is the machine-read verdict contract (the allowed `model_tier`, `verdict`, and `drift_kind` values and the required fields), built from the registries in `meaning-check.mjs`; hand it to the reader with the pairs. Each pair has `pair_id` (`P<n>` in document order), `kind` (`quote`, `claim`, or `translation`), `sentence_key`, `sentence`, `source_lang`, `report_lang`, `force_strong`, and either `fact_ids` with `quote` or `claim_id` with `statement`.

A reader writes one verdict file per tier: `{ "model_tier": "cheap" | "strong", "verdicts": [...] }` (a bare array works when each verdict names its own `model_tier`). One verdict per pair:

| Field | Value |
| --- | --- |
| `pair_id` | a `pair_id` from `pairs.json`; any other id is dropped (`unknown_pair`) |
| `verdict` | `ok` or `drift` |
| `drift_kind` | for `drift`, exactly one of `subject_changed`, `scope_widened`, `hedge_dropped`, `certainty_added`, `causality_added`, `direction_flipped`, `population_changed`, `evidence_grade_raised`, `other` |
| `fragment` | for `drift`, a non-empty verbatim substring of the pair's `sentence` (whitespace-normalized) |
| `source_fragment` | for `drift`, a non-empty verbatim substring of the pair's `quote` or `statement` |
| `explanation` | one sentence, for the briefing; never read by the scripts |

A verdict that breaks any rule is dropped and listed in the record's `dropped` with its reason; it never becomes a defect. Both tiers naming the same `drift_kind` other than `other` on one pair is `meaning_drift_confirmed` (major); one tier, or two tiers that disagree, is `meaning_drift_warn` (minor). `--dispute P<n> --reason` keeps the defect and marks its calibration line `disputed`; the command still exits `1`, and the way forward is the repair loop described in deliverable-phase.md ("After a dispute"). A `{"skipped": true}` pairs file is accepted only when the locked brief says `meaning check: off`; with the check on (`meaning_check_required`) or no locked block (`fidelity_interview_incomplete`) it exits `1`. Every entry of `unverified` becomes one `meaning_unverified` defect (major), so a pair no reader judged fails the command (exit 1) through the same registry policy as any other defect. A malformed `pairs.json` or an unreadable verdict file exits 2.

`fidelity-calibration.jsonl` starts with a header line `{ "header": true, "promotion": ... }` holding the promotion criterion, then per run one run line `{ "run": true, run_id, pairs_sha256, flagged }` (written even when nothing was flagged, so `min_runs` counts real runs) and one line per flagged pair: `kind`, `pair_id`, `tiers`, `drift_kind`, `confirmed`, `disputed`, `reason`, `run_id`, `pairs_sha256`. The run id (`--run-id`, or a hash of the pairs and verdict files only, never the dispute) keys the run: rerunning the same inputs, with or without `--dispute`, replaces that run's lines in place, and a dispute recorded earlier carries forward to the rewritten lines. A corrupt log line exits `2` naming `<path>:<line>`. The record's `promotion_eligibility` evaluates the criterion over the log, counting report-level false blocks over the last `false_block_window` runs.
