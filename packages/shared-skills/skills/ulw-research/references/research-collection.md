## Phase 0 — Decompose and open the journal

Before spawning anything, decompose the query. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?" Seed `intent-diff.md` with those expected truths before treating code, current docs, or web results as the source of truth:

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Collection: <search-only | browser> · Verification likely: <yes/no>
Scale: <axis count, source territories, target document length> · Precision demand: <what a wrong claim costs here> → lifecycle: <single team | research team then refinement team>
</analysis>
```

`Collection` is `search-only` only when a result snippet settles every axis (a date, a version, a spec value); anything that needs reading a source is `browser`.

Then create the session directory:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. The orchestrator owns the journal: you write every file in it; workers never do (a mass-research dag node writes only its own `waves/<run-key>/<node-id>.md` handoff file, which carries its EXPAND tail and claim candidates; you journal from it). Maintain:

- `brief.md` — the analysis block, the axis list, the expected truths, and the `## Deliverable` record from the interview below (lane, state, formats, each field with `answered_by`).
- `sources-ledger.md` — one line per source the moment it is read: `[S<n>] <url> — <what it is>`. The closing briefing counts sources and domains from this file.
- `sources/` and `fact-ledger.json` — one directory per source snapshot and the ledger built from them. The snapshot and locator contract (raw bytes, converted-only sources, byte locators, `source refresh`) is defined once, in [fact-ledger.md](fact-ledger.md#snapshot-and-locator-contract); every number and quotation reaches the report through a ledger placeholder.
- `wave-<N>-<kind>-<axis>.md` — your digest of each worker return: key findings, sources with URLs, and the worker's EXPAND markers verbatim.
- `expansion-log.md` — per wave: workers spawned, markers gained, leads opened and closed.
- `excursion-log.md` — one ENTER row and one EXIT row per excursion: `excursion_id`, parent claim or axis, ENTER trigger, depth, workers spent, the EXIT rule that closed it, what it changed in the top-level answer (`none` is a valid, required answer), and the ulw-loop steer/evidence id it was mirrored into.
- `intent-diff.md` — orchestrator-owned expected-truth ledger comparing intent/spec/history to observed reality.
- `claim-graph.md` — orchestrator-owned claim graph linking every final assertion to observations, counterevidence, dependencies, and verdict.
- `observation-manifest.md` — orchestrator-owned observation manifest with `observed_at`, temporal validity, artifact paths, and contamination notes.
- `verification-economics.md` — proof-cost ledger mapping claim risk to verification path, deferral decisions, and residual risk.
- `cause-disappearance.md` — cause ledger tracking expected truth, previous observation, `last_seen`, disconfirming observation, and whether the violation is no longer observed.
- `verify-<slug>.md`, `SYNTHESIS.md`, `REPORT.*` from later phases.

Append each digest the moment its worker returns, not in a batch at the end — the journal is your recovery point after context loss and the user's audit trail.

### Run it as a loop, and journal in real time

ulw-loop is ON by default for this mode: when the `ulw-loop` skill is available, register the research axes as loop goals so the run has durable state and survives a compaction. The run's start clock is `outcome.json` `startedAt`, which `outcome init` records once: from `--started-at <ISO>` when you pass it, else from this directory's timestamp name — the closing briefing is computed from it, so create the directory once and never rename it. From that point every finding, source, quote, number, and lead is written into `$SESSION_DIR` **the instant it lands** — never held in the conversation for an end-of-run dump. After any context loss, re-read the brief and the journal before doing anything else, then resume from the open wave.

### Deliverable lane, format, and the empty-info interview

Never block collection on the shape of the deliverable, and never guess it either. Read [references/deliverable-phase.md](deliverable-phase.md) sections 1-6 before writing the brief, then:

1. **Derive first.** Name the lane (`template-strict`, `template-vibe`, `no-format`, `edit-existing`) and the promised formats from the request and its destination (the reference's section 3). When the request refers to an existing deliverable, decide its state with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome state --deliverable <path> --session-dir "$SESSION_DIR"`: `partial` resumes the skeleton on disk, `complete` means edit-existing and never a regenerated report. `$SKILL_DIR` is this skill's own directory, the folder containing this SKILL.md.
2. **Read the requester's format memory** with the memory tool when the harness exposes one: the pointer `system/human/report-style.md`, then `reference/human-report-style.md`; take the choice recorded for the most similar context (same destination kind and audience) as the first option.
3. **Ask only what is still missing**: at most the reference's three questions (destination and format, audience and length, template lineage) in one call to the harness question tool (`ask_user_question` or `request_user_input`), non-blocking where the harness supports it, each with its default first, a free-text "describe the format" path, and "don't care, you decide". Collection starts without waiting; a late answer is folded in until the assembly worker starts, and after that it becomes a re-render request.
4. **Settle source fidelity in the same step.** Seven fields under `## Fidelity` in `brief.md` say what the report must stay faithful to; the reference's section 4 lists each field's values and default. Infer every field before asking anything; an explicit word in the request decides a field (`answered_by: request`), the destination, the sources, and the Phase 0 axes supply the rest (`answered_by: default`):
   - `as of`: a version, release, tag, commit, date, quarter, "as of", "current", or "latest" in the request decides it; a pointed-at repository anchors on its HEAD or tag at run start, pointed-at documents on their own revisions, and a comparison of two anchors records `multiple: <a>, <b>; rows tagged`. Default `latest at run start, <run date>`, the date of the `$SESSION_DIR` timestamp. Ask when the topic is version-bound or time-sensitive (software, APIs, standards, prices, rates, rankings, laws, programs, schedules) and nothing names an anchor; a stable topic takes the default silently.
   - `meaning check`: the QA tier decides (full: `on`, light: `off`); a chat answer on a legal, medical, financial, procurement, or public-facing question with no speed word is `on`. Ask when two explicit signals disagree: a document deliverable under a literal "quick" or "fast", or a light-tier answer that carries both a speed word and a precision demand; `on` goes first.
   - `source floor`: "official docs only", "peer-reviewed only", "SEC filings" give `primary only` or `classes: <host suffixes>`; "from these only" gives `pointed only: <source ids, URLs, or paths>`; pointed-at sources with no restricting word are seeds, not a floor. Default `standard`. Ask when a restricting phrase sits beside an open-ended question whose answer lives outside that floor. Declare each source's provenance when you snapshot it (`source snapshot --provenance primary|secondary`, by the Phase 3b primary-source rule); `primary only` refuses every source not declared `primary`.
   - `derived numbers`: "compare", "growth", "share", "estimate" give `allowed`; "only the sources' own numbers", "no estimates" give `none`. Default `allowed`. Ask when both kinds of phrase share one request. Record only `allowed` or `none` (any other value stops `fact fill` and `fact verify` with a usage error); a partial or free-text answer records `none`.
   - `languages` (never asked): the report in the user's language or the one they named; sources `en`, plus the user's language for a local topic, plus the pointed-at documents' languages; quotes `original` when every source language equals the report language, else `original with translation beside`.
   - `identifier classes` (never asked): from the Phase 0 axes' domain (software: version strings, package names, commit ids; finance: tickers, filing ids, fiscal periods; law: statute, article, and case numbers; science: gene names, DOIs, trial ids), else `none`. It is recorded only; no gate enforces it yet.
   - `fallback` (never asked): `block-quote`, or `omit` on "drop anything you cannot verify"; no other value is accepted.

   Ask nothing when the request, the destination, and the sources decide every field. Otherwise ask only the fields whose trigger fired, in the same question-tool call as the format questions (`ask_user_question` or `request_user_input`), non-blocking where the harness supports it, each with its default first, a free-text path, and "don't care, you decide" (it resolves to the first option, recorded `answered_by: user`). At most four questions ride in that call: `pending` fidelity fields first, then format Q1, Q2, Q3, then `as of`, `meaning check`, `source floor`, `derived numbers`; a question that loses its slot runs on its default and is named, with that default, in the reply that opens collection. When each reading of a field would make part of the request undeliverable, record it `pending` with no default. Collection starts regardless: `source snapshot`, `fact add`, `fact quote`, `fact derive`, `fact retract`, and `fact export` keep working while answers are pending; only the six reader-facing commands (`fact fill`, `fact verify`, `fact pairs`, `fact meaning-check`, `fact polish-apply`, `fact polish-diff`) and the assembly lane wait for the lock, and those commands exit 1 with `fidelity_interview_incomplete` while a field is `pending` or missing. When the assembly lane is about to start, a field still awaiting its answer keeps its default; a `pending` field is asked once more, blocking this time.
5. **Record it.** Write `## Deliverable` into `brief.md` (lane, state, formats, destination, audience, template, format description, each with `answered_by: user|default|request`) plus `## Fidelity` (the block below), and open the manifest in the same step: `node "$SKILL_DIR/scripts/report-tools.mjs" outcome init --promised <formats> --lane <lane> --session-dir "$SESSION_DIR"`. When the ask is to recreate, reproduce, or rebuild something visual, add `Reference compare: required` with the source (URL or file) and the moments to compare; the comparison runs on every round of the build, not only at the end.

#### The fidelity questions

Ask them in the user's language, translating these English texts faithfully and keeping the option order; `<run date>` is the `$SESSION_DIR` date.

- **`as of`**, header `As of`: "Which version or date must the facts hold for? Sources are snapshotted and quoted against that anchor."
  1. `Latest as of today, <run date>` - The state published at the run's start; anything older is flagged as stale.
  2. `Other: a named version, release, or date` - Type it (v3.2, 2026-Q3, a commit or tag). Every quote and number is checked against sources valid at that anchor.
  3. `Don't care, you decide` - Resolves to option 1.
- **`meaning check`**, header `Drift check`: "Numbers and quotes are always script-checked against source snapshots. Should every explanatory sentence also be read against its source quote by a separate reader? Slower and more tokens; it catches widened scope and dropped hedges."
  1. `On` - Every sentence is paired with its source and read; confirmed drift is rewritten from the quote or listed in the briefing.
  2. `Off (faster)` - Script checks only: numbers, units, quotes, qualifiers, bindings. A paraphrase that shifts meaning is not read.
  3. `Other: where to focus` - Type it ("the financial sections", "anything about the competitor"); those pairs go to the strongest reader.
  4. `Don't care, you decide` - Resolves to option 1.
- **`source floor`**, header `Sources`: "Which sources may back a statement of fact?"
  1. `Standard: primary source required for high-risk claims` - Numeric, legal, financial, dated, and causal claims need a primary source plus two independent domains; other claims may cite attributed secondary sources.
  2. `Primary only` - Every fact traces to a first-party source (standard, filing, dataset, official doc); commentary appears only as attributed opinion.
  3. `Only the sources I pointed at` - Ledger rows come from the named files and URLs only; anything else is context, not evidence.
  4. `Other: name the source classes` - Type it ("peer-reviewed only", "no vendor blogs").
  5. `Don't care, you decide` - Resolves to option 1.
- **`derived numbers`**, header `Derived`: "May the report state numbers no source states (sums, growth rates, shares, unit conversions, estimates)?"
  1. `Yes, computed by script and labeled DERIVED` - Each one names its operation and input rows; inputs are checked for unit, period, and population compatibility; an estimate carries its assumptions.
  2. `No, sourced numbers only` - Every number is a MEASURED ledger value; comparisons are stated in words or shown side by side.
  3. `Other: describe` - Type it ("growth rates yes, estimates no"). A partial allowance is recorded as `none`, and the reply that opens collection says so.
  4. `Don't care, you decide` - Resolves to option 1.

#### The `## Fidelity` block

Write it in the same step as `## Deliverable`, provisional defaults included, one line per field with its `answered_by`, plus an `asked:` line naming the fidelity questions sent:

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

Values carry no parentheses; `pending` goes only with `answered_by: pending`. When an answer lands, rewrite that one line with `answered_by: user` and leave `asked:` as history; a late answer after `fact fill` is a re-render: fill again, then verify.

**Re-entry.** An `edit-existing` session, or any session created before this block existed, has no `## Fidelity`. Before any `fact` command, run the inference step above and write the block with `answered_by: default` on every field. `claims index` on a free-form `claim-graph.md` (no claim table) returns `{claims: [], errors: [...]}`, exits 2, and writes no `claims.json`; run `fact verify` without it, and the gate reports each unbound sentence as `unbound_sentence` (major) instead of blocking.

**Calibration.** `fact meaning-check` appends one line per flagged pair to `--calibration` (default `$SESSION_DIR/fidelity-calibration.jsonl`). After each run, also append that run's new lines to the workspace-level `.omo/ulw-research/fidelity-calibration.jsonl`; promotion of `meaning_drift_confirmed` is decided from that log.

Phase 5 opens by turning the recorded fields into `design-spec.md`.

## Phase 1 — Saturation wave

**When the user asked for MASS research, the wave is sized by the topic's angles, not by the roster ceiling.** "mass ulw research", "mulw research", "ulw mass research" — in any language — order over-collection that a team of 8 cannot produce. Where the harness has a dependency-graph surface (the `mass-ulw` skill and its `references/planning.md`), run collection through it instead: 60+ angles covering every angle the topic has, routed across the whole difficulty ladder — mechanical sweeps and per-item harvest batches on the cheapest tier, judgment-shaped angles a step up, cross-territory angles a step above that, and the deepest tier reserved for genuinely hairy contradictions. Define each angle as a harvest -> expand -> verify chain before the run starts, each stage reading the previous stage's handoff file; open leads re-enter as new chains in each cluster of angles the moment that cluster settles, and the synthesis reduces through per-cluster architect-tier slice reducers into ONE architect-tier reducer (the strongest reasoning tier substitutes wherever no architect tier exists). Absent that surface, run the same per-angle chains with background workers, pasting each worker's reply into its angle's next-stage prompt the moment it reports. Everything else in this skill still binds: the deliverable interview, the journal, the claim graph, the convergence rules, and the delivery gates.

Otherwise launch the entire first wave in one turn — every axis at once, as team members if you formed a team, else as background workers. Sequential launches and "start with one and see" defeat the mode.

Scaling floor — more angles always justify more workers:

| Query scope | explore | web | repo-dive | floor |
|---|---|---|---|---|
| Single topic, codebase only | 3 | 0 | 0 | 3 |
| Single topic, web only | 0 | 5 | 1 | 6 |
| Single topic, both | 2 | 4 | 1 | 7 |
| Multi-faceted | 4 | 8 | 2 | 14 |
| Full due diligence | 4 | 9 | 2 | 15 |

**Disambiguate before you expand.** When the topic names something that could resolve several ways — a product, a person, a codename, a version — the first wave settles WHICH entity before any worker researches its history, benchmarks, or controversies: canonical name, first-party URL or account, whether it exists in the claimed category, and a confidence line. An unresolved entity never becomes a premise in a later wave's spawn message; that is exactly how a run starts inventing facts about something that does not exist.

Role protocols — embed the relevant one in each spawn message; every worker gets a unique angle:

- **Codebase (explore), 2-4 workers.** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S '<keyword>'` and `--grep` for history including deleted code. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect.
- **Web, 3-9 workers, every one loaded with the `browser` skill.** Search with 10+ websearch queries per worker, each with a different operator or angle (see Search craft); a result is a candidate, not a source. Read every candidate in the user's browser through the `browser` skill's attached engine: one named session per worker, one tab per source, several tabs open side by side while sources are compared — `session.tabCreate` / `tabSelect` / `tabClose` where the harness has a JS eval kernel, `bsk tab create --url <url>` / `tab select <id>` / `tab close <id>` / `tab list` on the CLI — the page scrolled to its end, a full-page screenshot of each top source saved as provenance, the tab closed once reported. A browser on another machine is reached through the `browser` skill's remote reference or a user-level skill that bridges to it, never replaced by a local headless one. `webfetch` is for raw files only: PDF, JSON, feeds, sitemaps. A host the browser cannot open (WAF, bot score, 403) goes to `ultimate-browsing`, whose provenance travels with the claim: a `snapshot` result cites its `snapshot_timestamp` and is never stated as the live page; a `proxy` result is `untrusted` until a second independent route agrees. Context7 with 3+ queries per known library; grep.app and `gh search code|repos|issues` for real-world usage; official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages. A worker whose sources are all fetched text has searched, not read.
- **Repo deep-dive (librarian), 0-2 workers.** Shallow-clone the most relevant repos to `${TMPDIR:-/tmp}`, pin the HEAD SHA, read core modules, follow call chains, return SHA-pinned permalinks.

Example spawn (codebase axis; web and repo-dive follow the same contract with their own protocol):

```
task(subagent_type="explore", run_in_background=true, prompt="TASK: act as a codebase researcher. AXIS: <specific angle>.
This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and report every lead.
SCOPE: find everything in this codebase related to <angle>: <what complete looks like>.
PROTOCOL: grep 3+ keyword variations; structural search; LSP references; globs; git history (-S and --grep). Cross-validate across tools. Report absolute paths and file:line patterns.
End your reply with the ## EXPAND tail: '- LEAD: <discovery> — WHY: <why> — ANGLE: <search>' per lead, or 'none — <reason>'.")
```

## Phase 2 — Expand until convergence

This loop is what makes the mode research rather than search. Collect returns as they land — and in team mode, act on each lead the moment a member raises it, never waiting for the full wave or a member's final reply:

1. Journal the return the moment it lands, never at the end of the wave: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`, appending each new source, quote, and number to the observation manifest in the same beat — after a compaction the journal, not your memory, is the state. Snapshot each source the moment it is read (`node "$SKILL_DIR/scripts/report-tools.mjs" source snapshot --id S<n> --url <url> --session-dir "$SESSION_DIR"`; a page read in the browser is saved and imported with `--html <file>`, recorded as lower-trust `model` extraction), then register every number and quote you will use from that snapshot: `fact add --source S<n> --find "<anchor text>" --label <label>` (or `--table <id> --row <label> --col <label>`, or `--page <n> --line <n>`) and `fact quote --source S<n> --match "<words>" --label <label>`. Read the printed row and its 60 characters of source context before using it; a wrong row is retracted (`fact retract F<n> --reason <why>`), never edited. The observation's quote or line anchor in the manifest is that fact id.
2. Deduplicate new markers against `expansion-log.md` — every lead ever seen, not just confirmed ones, or rejected leads resurface each wave.
3. Spawn an expansion worker immediately for each new unchecked lead:

```
task(category="deep-low", load_skills=["browser"], run_in_background=true, prompt="TASK: expansion wave <N> — investigate: <lead>.
PARENT: <which return surfaced it>. This is an explicit exhaustive-research assignment; budgets do not apply.
<role protocol for the lead's territory — web protocol for external leads, explore protocol for codebase leads>
End your reply with the ## EXPAND tail.")
```

### Excursions — dive deep on a new find, then surface back out

The Phase 0 core question is the fixed goal of the run and never drifts. An excursion is a BOUNDED detour off the wave plan to chase something a return surfaced — you go deep, settle it, and come back up to the question you were hired to answer.

**ENTER (dive) only on a trigger.** One of these must hold, and you name which one:

1. The find contradicts a claim already locked in `claim-graph.md`.
2. It would change the final answer or a recommendation if it turned out to be true.
3. It exposes a source territory no axis owns, so nobody else will ever reach it.
4. The user's steering points at it — their words are the trigger, quoted verbatim.

Interest alone is not a trigger. Anything without one stays a queued lead in `expansion-log.md`, and the wave plan continues.

**Budget the dive before you take it.** State the worker count and the probe count for this level in the ENTER row. An excursion may spawn at most ONE nested sub-excursion; a third level means the thing has become its own research question — surface immediately and either promote it to a real axis with its own worker or record it as an out-of-scope gap in `SYNTHESIS.md`. When the `ulw-loop` skill is driving the run, a promotion is `omo-agent-toolkit ulw-loop steer --kind add_subgoal --title "<axis>" --objective "<what it must answer>" --evidence "<what surfaced it>" --rationale "<why the plan changes>"`.

**EXIT (surface) the moment any of these holds** — you do not need all of them:

- The ENTER trigger is resolved: the claim is confirmed, refuted, or its dependency is closed.
- Two consecutive probes changed nothing in the parent answer.
- The finding stops moving any claim's status — diminishing return is an exit, not a reason to push harder.
- The level's stated budget is spent.

**Fold back on the way out.** Every EXIT writes one line saying what the excursion changed in the top-level answer, and `none — <reason>` is a legitimate, required outcome; an excursion whose result is silently dropped is a lost run. Update the parent claim node or axis digest with the result, then mirror the whole excursion into the loop ledger — `omo-agent-toolkit ulw-loop steer --kind annotate_ledger --evidence "<what the excursion observed>" --rationale "<what it changed, or none>"`, and `omo-agent-toolkit ulw-loop record-evidence --goal-id <id> --criterion-id <id> --status pass|fail|blocked --evidence "<artifact>"` when it settled a criterion. After a compaction, `omo-agent-toolkit ulw-loop status --json` plus `excursion-log.md` tell you which excursions are still open.

**Anti-drift.** After every EXIT, re-read the core question in the journal and confirm the run still answers it. Three consecutive excursions that changed nothing end excursions for the run: converge on what you have.

4. Record the wave in `expansion-log.md`: spawned, markers gained, leads opened/closed.
5. **Relay the user's steering to everyone.** When the user changes scope, cadence, target sources, language, or format mid-run, broadcast it to every live worker and member immediately and record the exact wording in `expansion-log.md`. Steering only you saw silently splits the swarm's assignment from the user's actual ask.

**Convergence — the only stop rules while this mode is active.** Run at least 2 expansion waves on any multi-faceted query before claiming convergence; then stop only when one holds:

- Zero unchecked leads remain — each investigated or closed as duplicate/dead end.
- 3 consecutive waves produced no new actionable leads.
- Expansion depth reached 5 waves — pause, show the open leads, and ask the user whether to extend.

**Never end the run on a worker's completion.** Workers finishing is not the deliverable; your synthesis is. Reserve the last fifth of the run's context and time for Phases 4-5 and stop opening waves the moment that reserve is threatened. A converged answer with two open leads beats nine finished workers and no report.
