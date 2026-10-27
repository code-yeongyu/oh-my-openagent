## Phase 1 — Saturation wave

`source snapshot --html` and `--url` probe their own conversion and print the numbers it altered (a footnote digit glued onto a value, a merged table cell); `fact add` then refuses those numbers with `conversion_altered_number`, so write a verified text of that source and replace the snapshot with `source snapshot --id S<n> --text <verified.txt> --replace` (refused while an active row cites the id: retract those rows first or use a new id), then add the fact from it. When you convert a document yourself, run `node "$SKILL_DIR/scripts/report-tools.mjs" source probe-conversion <raw-file> <converted-file>` and snapshot a verified `--text` instead before adding any number it lists as `altered`; `lost` is a warning only.

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

## Phase 3 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Spawn one verification worker per claim:

```
task(category="deep-low", run_in_background=true, prompt="TASK: verify by execution: <claim>.
SOURCE: <where it came from>; CONTRADICTION: <opposing source, if any>.
Write a minimal self-contained script that tests the claim; run it (uv run --with <deps> python / bun / direct compile); capture full stdout+stderr; pin versions.
Reply with: the exact code, the full output, environment (OS, runtime, dependency versions), and a verdict — CONFIRMED / REFUTED / PARTIAL — grounded in the output.")
```

Journal each verdict to `verify-<slug>.md`.

## Phase 3b — Lock non-code claims through the claim graph

Code settles code-shaped claims (Phase 3). Numeric, market-share, legal, dated, causal, and financial claims cannot be run — so they pass through a data-flow-lock instead (the verification idea adapted from fivetaku/insane-research): the synthesis may assert a high-risk non-code claim **only** if it cleared this gate, and the gate's output is the sole allowlist the synthesis draws from. Skip the gate and there is nothing to synthesize — the lock is self-enforcing.

The claim graph is orchestrator-owned. Workers only return verified-claim markers, observation candidates, and claim candidates as message text, the same channel as EXPAND markers — never a file (except a mass-research dag node's handoff file). As leads resolve, you record one node per asserted claim in `claim-graph.md` and compute its status; workers report claim candidates in their replies, and you decide. The graph is the single claim store: final synthesis may not draw from free-form claims that skipped it.

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

**The claim table is machine-read.** Keep the nodes of `claim-graph.md` in one Markdown table whose header names `claim_id | statement | risk tier | status` (plus `fact_ids`, the ledger rows the node rests on, and any other node fields as further columns), one row per node: ids `C<n>`, risk `high` or `normal`, status `supported`, `partial`, `refuted`, or `unresolved`. List the nodes that clear the Phase 3b gate under a `## verified-claims` heading as `- C<n>: <statement>`. `node "$SKILL_DIR/scripts/report-tools.mjs" claims index "$SESSION_DIR/claim-graph.md" --out "$SESSION_DIR/claims.json"` indexes it, and the fidelity gate reads `claims.json` to check every `data-claim` binding in the report.

## Phase 4 — Synthesize

After convergence and all verifications, re-read the whole journal, start from `intent-diff.md`, `claim-graph.md`, and `observation-manifest.md`, then write `SYNTHESIS.md`:

```
# ULW-Research Synthesis: <query>
Workers: <total> · Waves: <count> · Excursions: <count> · Sources: <count> (<unique domains> domains) · Verifications: <count> · Elapsed: <minutes> min

## Executive summary        — 2-3 paragraphs answering the core question
## Findings by theme        — per theme: consensus, evidence links, key quote (<20 words, attributed), verified yes/no
## Codebase findings        — absolute paths with line references
## Sources (ranked)         — URL, what it contains, reliability, access date
## Verified claims          — code: claim | verdict | verify-<slug>.md · non-code: only rows cleared into verified-claims
## Epistemic instrumentation — intent-vs-reality diff closure, claim graph coverage, observation manifest coverage, independent-observation convergence, verification economics summary, cause-disappearance records
## Contradictions           — source A vs source B, resolution with evidence
## Gaps                     — what saturation could not answer · unresolved/refuted claim-graph nodes
## Expansion trace          — per wave: workers → markers; convergence reason
```

`SYNTHESIS.md` is the citation source of truth for final materials: every claim carries inline `[Source N]` citations, and every high-risk non-code claim you assert must be a verified-claims row from Phase 3b. Assert nothing the gate left in the unresolved/refuted annex.

**Write numbers and quotes by reference.** `SYNTHESIS.md` and every report source carry placeholders, never typed values: `{{F12:span_len}}` renders the row's value and unit, `{{F12:span_len:value}}` or `:unit` one part, `:q` the value with its source qualifier (up to, at least, about); `{{Q7:completion}}` renders the whole quotation, `{{Q7:completion:lead=8}}` its first words, `{{Q7:completion:from="no earlier":to="2027"}}` one span of it. A derived number is computed by the script, never by hand: `fact derive --op sum|diff|growth|ratio|share|convert|expr ...` checks the operands' units, periods, and populations, refuses an incompatible operation, and prints the new row id the placeholder uses. A value nobody measured is registered with `fact add --assumed <value> --unit <unit> --rationale <why> --label <label>` and renders as ASSUMED. Every findings sentence binds to a fact, a quote, a `[S<n>]` citation, or a claim node (`data-claim="C3"`). Reviewers and the refinement team read the rendered text through `node "$SKILL_DIR/scripts/report-tools.mjs" fact fill "$SESSION_DIR/SYNTHESIS.md" --view --session-dir "$SESSION_DIR"`, never the raw placeholders.

**Write the skeleton early and fill it as claims lock.** The moment the brief records the deliverable, create the deliverable file with its section headings and a `STATUS: draft — <n> sections open` line as line 2 (an HTML comment in HTML); that line is the partial-state marker `outcome state` reads, removed only when the deliverable is complete. An interrupted run must leave a partial report on disk, never an empty directory and a lost conversation.

**Keep sourced numbers, assumptions, and derived results visibly apart.** Every quantitative claim carries its lineage: `MEASURED` (a number a source states, cited), `ASSUMED` (a coefficient, distribution, or scope you chose — say why), `DERIVED` (computed from those, showing the formula), plus a sensitivity line whenever the assumption moves the answer. Presenting a derived estimate with the confidence of a measured one is the most damaging thing this mode can ship.

**Search in English, deliver in the user's language.** Retrieval stays English-first (Search craft), but the synthesis and every final material are written in the language the user wrote to you in unless they ask otherwise — and a translated report still quotes its original-language sources verbatim.

## Search craft

English first: run every search in English by default — it is the largest, most authoritative corpus on every engine, GitHub, and documentation site. Add a secondary local-language sweep (1-2 librarians) only after the English sweep, when the topic is inherently local, or when the user asks for sources in a specific language.

Vary operators on every query — same query twice wastes a worker:

| Operator | Example | Use |
|---|---|---|
| `site:` | `site:github.com <topic>` | Restrict to a domain |
| `filetype:` | `filetype:pdf <topic> survey` | Papers, specs |
| `intitle:` / `inurl:` | `intitle:benchmark <topic>` | Targeted pages |
| `"exact"` / `-term` | `"<exact phrase>" -tutorial` | Precision, exclusion |
| `OR` | `<a> OR <b> <topic>` | Coverage |
| `before:` / `after:` | `<topic> after:2025-06-01` | Recency control |

High-yield combinations: official docs (`site:<docs domain>`), GitHub implementations (`site:github.com`), recent discussion (`site:reddit.com OR site:news.ycombinator.com after:<date>`), academic (`site:arxiv.org OR filetype:pdf survey`), changelog hunting (`changelog OR "release notes" <version>`), alternatives (`vs OR alternative OR comparison`).
