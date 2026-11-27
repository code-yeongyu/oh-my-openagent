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

## Failure modes

| Failure | Correction |
|---|---|
| Sequential spawning, or trimming the first wave | All first-wave workers in one turn, background, scaling floor respected |
| A team member hoards leads for one final dump | Raise law — every lead, finding, and dead end broadcast the moment it surfaces |
| Worker reply without the EXPAND tail | One follow-up demanding it; the lane stays open until it lands |
| Stopping after wave 1 because "enough was found" | Convergence rules only: 2+ expansion waves, leads run dry |
| Obeying a surrounding "stop exploring" rule mid-research | Authority section — those rules do not bind this mode |
| Asking a worker to write journal or session files | Workers are read-only (except a mass-research dag node's handoff file); you journal every return |
| Two workers given the same angle | One unique angle per worker, always |
| A web worker that returned only fetched text, or a `Collection: browser` run whose workers never opened a tab | Sources are read in the user's browser through the `browser` skill; `webfetch` is for raw files; every web worker carries the skill from the first wave |
| Contested claim settled by judgment | Phase 3 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
| Guessing the deliverable format | Derive it from the request and destination; ask the empty-info interview only for what is still missing, and record `answered_by` for every field |
| Blocking the collection wave on the format question | Ask non-blocking and start collecting; unanswered fields run on the shown defaults |
| A roster smaller than the harness ceiling | Fill every member slot; split the broadest axis until the team is full |
| One tier across the whole roster | Mixed tiers by design — cheap breadth, premium attack |
| Silently re-routing a "quick"/"fast" instruction | Routing words are literal; journal requested -> spawned -> fallback per slot |
| A worker or member that starts its own research swarm | Members research one axis and report; orchestration is yours alone |
| Expanding on an entity the first wave never disambiguated | Settle canonical identity and first-party source before any later spawn asserts it |
| Batching findings into an end-of-run journal dump | Journal each return as it lands; the journal is what survives a compaction |
| Ending the run because every worker finished | Reserve the final fifth of the run for synthesis and materials |
| A derived estimate presented as a measured number | MEASURED / ASSUMED / DERIVED lineage on every quantitative claim, plus a sensitivity line |
| A number typed into the report or `SYNTHESIS.md` | Register it (`fact add`) and write `{{F<n>:label}}`; `fact verify` reports a typed number as `untraceable_number`, and `outcome verify` refuses delivery until it is a ledger row, an `assumed` row with its rationale, or gone |
| A filled value edited by hand | Never edit a filled value: fix the ledger row or the placeholder and re-run `fact fill`, then `fact verify` (`value_mismatch`, `unit_mismatch`) |
| A findings sentence bound to nothing | Bind it to a fact, a quote, a `[S<n>]` citation, or a claim node with `data-claim`; an `unbound_sentence` blocks delivery like an untraceable number |
| Delivering before the delivery gates pass | Static and layout gates, visual QA on rendered pages, plus the harness's proofread gate — a typo the user finds means a gate did not run |
| Skipping the static gates | `report-tools check` runs before any pixel review; its defects are cheaper than a visual pass |
| Delivering with a pending manifest row | `outcome verify` must pass; every promised format ends `delivered`, `blocked_capability`, `skipped`, or `failed` with a reason |
| Repairing past the tracker's stop decision | `repair decide` owns the budget; `deliver` ships with the residual list, `block` stops delivery |
| Guessing a design-spec value the extractor marked `TODO: ask` | Fill it from the interview answers or the reference's defaults, never by guessing |
| Referencing an asset that is not on disk | Verify the asset manifest before rendering; re-render whatever is missing |
| A figure stretched, cropped, or styled off the report's design language | `design-spec.md` binds every asset: fixed containers, contain-fit with aspect preserved, spec fonts and palette in charts and Mermaid |
| Chasing an interesting find with no ENTER trigger | Excursions need a named trigger; everything else stays a queued lead |
| An excursion that never came back, or drifted into a new mission | EXIT rules are unconditional; depth 3 means promote it to an axis or record it as a gap |
| An excursion whose result was never folded back | Every EXIT writes what it changed in the top-level answer, `none` included, and mirrors into the loop ledger |
| Ending with file paths while an inline HTML page tool is available | Show the report inline first (the gated `report.html` or its inline edition), then the paths and the summary |
| A visual reproduction checked only against itself | Reference compare: real source frames next to renders at the same moments, a critique per pair, fixes, and the pairs in the report |
| Delivering without the closing briefing | Paste the block `outcome briefing` prints; never compute or recall its numbers by hand |
