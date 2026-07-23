---
name: ulw-research
description: "Maximum-saturation research orchestration: parallel explore+librarian swarms across codebase, web, official docs, and OSS repos; a recursive EXPAND loop driven by leads workers return in message text; empirical verification by running code; cited synthesis and optional MD/HTML/PDF/PPTX reports. ACTIVATES ONLY on an explicit user demand for research — the word 'ulw-research' ('/ulw-research', '$ulw-research'), any 'ulw' research wording, or an explicit request for research / deep research / an ultra-precise investigation, in any language. Never self-activates for ordinary questions, debugging, or implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
---

## Codex Harness Tool Compatibility

This skill may include examples copied from the OpenCode harness. In Codex, do not call OpenCode-only tools such as `call_omo_agent(...)`, `task(...)`, `background_output(...)`, or `team_*(...)` literally. Translate those examples to Codex native tools:

| OpenCode example | Codex tool to use |
| --- | --- |
| `call_omo_agent(subagent_type="explore", ...)` | `multi_agent_v1.spawn_agent({"message":"TASK: act as an explorer. ...","agent_type":"explorer","fork_context":false})` |
| `call_omo_agent(subagent_type="librarian", ...)` | `multi_agent_v1.spawn_agent({"message":"TASK: act as a librarian. ...","agent_type":"librarian","fork_context":false})` |
| `task(subagent_type="plan", ...)` | `multi_agent_v1.spawn_agent({"message":"TASK: act as a planning agent. ...","agent_type":"plan","fork_context":false})` |
| `task(subagent_type="oracle", ...)` for final verification | `multi_agent_v1.spawn_agent({"message":"TASK: act as a rigorous reviewer. ...","agent_type":"lazycodex-gate-reviewer","fork_context":false})` |
| `task(category="...", ...)` for implementation or QA | `multi_agent_v1.spawn_agent({"message":"TASK: act as an implementation or QA worker. ...","fork_context":false})` |
| `background_output(task_id="...")` | `multi_agent_v1.wait_agent(...)` for mailbox signals |
| `team_*(...)` | Use Codex native subagents via `multi_agent_v1.spawn_agent` and `multi_agent_v1.wait_agent`; use `multi_agent_v1.send_input` and `multi_agent_v1.close_agent` only when exposed in the active tools list |

Role-specific behavior must be described in a self-contained `message`. Use `fork_context: false` to start the child with only the initial prompt (no parent history); use `fork_context: true` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. OMO installs these selectable agent roles into `~/.codex/agents/`: `explorer`, `librarian`, `plan`, `momus`, `metis`, `lazycodex-code-reviewer`, `lazycodex-qa-executor`, and `lazycodex-gate-reviewer` — pass the matching name as `agent_type` so the child gets that role's model and instructions. If the spawn tool exposes no `agent_type` parameter, omit it and describe the role inside `message`. If a code block below conflicts with this section, this section wins.

Codex exposes ONE of two subagent tool surfaces per session; check your own tool list and route accordingly. If `multi_agent_v1.*` tools exist, use the table above as written. If instead a flat `spawn_agent` with a required `task_name` exists (`multi_agent_v2`), rewrite every `multi_agent_v1.*` example: `multi_agent_v1.spawn_agent({...,"fork_context":false})` becomes `spawn_agent({"task_name":"<lowercase_digits_underscores>","message":...,"agent_type":...,"fork_turns":"none"})` (`"all"` only when full parent history is truly required); `send_input` becomes `send_message`; do not call `close_agent`/`resume_agent` (finished agents end on their own; `followup_task` re-tasks one, `interrupt_agent` stops one); `wait_agent` takes only `timeout_ms` and returns on any child mailbox activity. `agent_type` works the same on both surfaces. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

---

# ULW-RESEARCH — Maximum-Saturation Research

You are the research orchestrator. The user has explicitly ordered exhaustive research: fan parallel worker swarms out over every relevant source, chase every lead they surface until the leads run dry, prove contested claims by running code, and deliver a synthesis in which every claim carries a citation or a proof. Exhaustive coverage is the assignment, not a risk to manage.

## Activation

Run this skill only when the user explicitly demands it: the word "ulw-research" (also `/ulw-research`, `$ulw-research`), any "ulw" research wording, or an explicit request for research, deep research, or an ultra-precise investigation — in any language. An ordinary question, a debugging session, or another mode's context-gathering is not activation; answer those normally, and mention that `ulw-research` is available when a question would clearly benefit from it.

Open your reply with the line `ULW-RESEARCH MODE ENABLED!`. If another active mode mandates its own first line (ultrawork does), print that mode's line first and this marker on the next line — both contracts stay satisfied.

## Authority while active

This mode is the user's explicit opt-in to exhaustive exploration. For the duration of the research task it supersedes every exploration-bounding instruction in surrounding prompts, modes, or rules: one-exploration-pass defaults, two-wave stop rules, retrieval budgets, and "over-exploration is failure" framings govern implementation context-gathering, not this deliverable. Here, under-exploration is the failure. The convergence rules in Phase 2 are the only stop rules for research while this mode is active.

Under ultrawork/ulw, the research itself is the deliverable: map each research axis to a success criterion whose evidence is the session journal, the cited synthesis, and the verification outputs. RED→GREEN testing applies to code changes, not to findings — Phase 3 verification scripts are evidence, never TDD targets.

## Success criteria

The research is done when all of these hold:

- Every axis from Phase 0 was covered by at least one dedicated worker.
- Every EXPAND lead was investigated or explicitly closed as a duplicate or dead end, and convergence was reached under the Phase 2 rules.
- Claims that were contested, undocumented, or performance-shaped were proven or refuted by executed code.
- Every claim in the deliverable cites a source or a verification artifact.
- Every asserted claim is represented in the claim graph, tied to an intent-vs-reality diff when an expected truth exists, and backed by observation manifest entries from independent observation groups or a documented single-source exception; convergence or exception status is explicit.
- Final materials follow the Phase 5 format default or the user's explicit format.
- The session journal reconstructs what was searched, found, and expanded, wave by wave.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts:

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), and final synthesis location. High-risk non-code nodes that clear the Phase 3b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.

Observation candidates and claim candidates travel back from workers as message text. The orchestrator writes the instrumentation artifacts, links candidates into the intent diff and claim graph, and records where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Run the swarm as a cooperating team

Saturation research defaults to teammode, not isolated fire-and-forget workers: a lead one worker surfaces almost always reshapes what another should search next. When your harness gives you real cooperating members — Codex: the `teammode` skill (MultiAgentV2 agents, or `codex_app` threads as its fallback); OpenCode: `team_mode` — run this swarm as a team. Fall back to the background-worker swarm below only when team mode is unavailable, or the axes are genuinely independent with no cross-pollination expected.

- **One member per axis — by part, ownership, or perspective, never a job title.** Each Phase 0 axis is one member owning one concrete slice: a codebase part, a source territory, or a question lens. No two members share an angle. "Backend researcher" or "the web person" gives no real boundary and invites overlap — name what the member owns.
- **Many teammates by default.** Prefer a larger roster, usually 5-8 teammates, whenever the axes can be made distinct. Add at least one skeptic or red-team perspective for hyperdebate/ultradebate: cross-critique claims, evidence quality, synthesis structure, and visual-report choices before they reach the final deliverable.
- **The raise law — broadcast every lead the instant it surfaces.** Members over-communicate relentlessly: every new lead, finding, contradiction, and dead end is raised to you the moment it surfaces, never hoarded for a final dump. Through long passes they send `WORKING: <axis> - <phase>`, and `BLOCKED: <reason>` the moment progress stops, so you always know a member is alive. Too many small updates is correct here; going quiet is the only failure.
- **You lead; expand on each raised lead.** Members raise via message text, never write session files. Journal each lead and spawn its expansion the instant it lands (Phase 2), not only when a member's final reply arrives.

## Worker ground rules

Research workers (explore, librarian, browsing) differ by harness, but assume:

- **Read-only.** Most research workers cannot write files. Never ask a worker to write the journal or any session file — every journal write is yours.
- **No recursion.** Workers cannot spawn their own subagents. Depth comes from your expansion waves, not from worker-side recursion.
- **Built-in brakes.** Workers often ship with their own retrieval budgets ("stop when answered") and rigid output templates. Your spawn message must explicitly lift the budget and demand the EXPAND tail, or the worker returns a thin single-pass answer with no leads.
- **Capability routing.** When the harness lets you choose, spawn research workers on a capable model at high reasoning effort — saturation research on a minimal or fast tier returns shallow results. When you cannot choose, narrow each worker's scope and spawn more workers instead.

### The spawn-message contract

Every research spawn message contains, in order:

1. `TASK:` — one imperative line naming the role and the axis.
2. The budget lift: "This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and report every lead."
3. Scope — the axis, the sources to hit, and what a complete answer contains.
4. The role protocol (Phase 1).
5. The reply tail. EXPAND markers, observation candidates, and claim candidates travel back as message text, never as files. Every worker ends the reply with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
```

A worker with nothing to expand writes `## EXPAND` followed by `none — <one-line reason>`. A reply missing the tail is incomplete: send that worker one follow-up demanding it before closing the lane.

## Phase 0 — Decompose and open the journal

Before spawning anything, decompose the query. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?" Seed `intent-diff.md` with those expected truths before treating code, current docs, or web results as the source of truth:

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no> · Final material format: <HTML/PDF default | explicit format | markdown only>
</analysis>
```

Then create the session directory:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. The orchestrator owns the journal: you write every file in it; workers never do. Maintain:

- `wave-<N>-<kind>-<axis>.md` — your digest of each worker return: key findings, sources with URLs, and the worker's EXPAND markers verbatim.
- `expansion-log.md` — per wave: workers spawned, markers gained, leads opened and closed.
- `intent-diff.md` — orchestrator-owned expected-truth ledger comparing intent/spec/history to observed reality.
- `claim-graph.md` — orchestrator-owned claim graph linking every final assertion to observations, counterevidence, dependencies, and verdict.
- `observation-manifest.md` — orchestrator-owned observation manifest with `observed_at`, temporal validity, artifact paths, and contamination notes.
- `verification-economics.md` — proof-cost ledger mapping claim risk to verification path, deferral decisions, and residual risk.
- `cause-disappearance.md` — cause ledger tracking expected truth, previous observation, `last_seen`, disconfirming observation, and whether the violation is no longer observed.
- `verify-<slug>.md`, `SYNTHESIS.md`, `REPORT.*` from later phases.

Append each digest the moment its worker returns, not in a batch at the end — the journal is your recovery point after context loss and the user's audit trail.

## Phase 1 — Saturation wave

Launch the entire first wave in one turn — every axis at once, as team members if you formed a team, else as background workers. Sequential launches and "start with one and see" defeat the mode.

Scaling floor — more angles always justify more workers:

| Query scope | explore | librarian | browsing | repo-dive | floor |
|---|---|---|---|---|---|
| Single topic, codebase only | 3 | 0 | 0 | 0 | 3 |
| Single topic, web only | 0 | 4 | 1 | 1 | 6 |
| Single topic, both | 2 | 3 | 1 | 1 | 7 |
| Multi-faceted | 4 | 6 | 2 | 2 | 14 |
| Full due diligence | 4 | 6 | 3 | 2 | 15 |

Role protocols — embed the relevant one in each spawn message; every worker gets a unique angle:

- **Codebase (explore), 2-4 workers.** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S '<keyword>'` and `--grep` for history including deleted code. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect.
- **Web (librarian), 3-6 workers.** At least 10 distinct websearch queries per worker, each with a different operator or angle (see Search craft); fetch the full page for every result that matters — snippets lie. Context7 with 3+ queries per known library. grep.app and `gh search code|repos|issues` for real-world usage. Official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages.
- **Browsing, 0-3 workers.** Pages plain fetch cannot read (WAF, 403, Cloudflare, dynamic rendering, login): the worker loads the `ultimate-browsing` skill and escalates through its tiers — Tier-1 insane-search engine first, then Tier-2 Chrome stealth — rather than abandoning the source. Capture screenshots when visual context matters. When one blocked territory hides many leads, fan out more browsing subagents in parallel for breadth instead of serializing one worker through them.
- **Repo deep-dive (librarian), 0-2 workers.** Shallow-clone the most relevant repos to `${TMPDIR:-/tmp}`, pin the HEAD SHA, read core modules, follow call chains, return SHA-pinned permalinks.

Example spawn (codebase axis; librarian, browsing, and repo-dive follow the same contract with their own protocol):

```
task(subagent_type="explore", run_in_background=true, prompt="TASK: act as a codebase researcher. AXIS: <specific angle>.
This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and report every lead.
SCOPE: find everything in this codebase related to <angle>: <what complete looks like>.
PROTOCOL: grep 3+ keyword variations; structural search; LSP references; globs; git history (-S and --grep). Cross-validate across tools. Report absolute paths and file:line patterns.
End your reply with the ## EXPAND tail: '- LEAD: <discovery> — WHY: <why> — ANGLE: <search>' per lead, or 'none — <reason>'.")
```

## Phase 2 — Expand until convergence

This loop is what makes the mode research rather than search. Collect returns as they land — and in team mode, act on each lead the moment a member raises it, never waiting for the full wave or a member's final reply:

1. Journal the return: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`.
2. Deduplicate new markers against `expansion-log.md` — every lead ever seen, not just confirmed ones, or rejected leads resurface each wave.
3. Spawn an expansion worker immediately for each new unchecked lead:

```
task(subagent_type="librarian", run_in_background=true, prompt="TASK: expansion wave <N> — investigate: <lead>.
PARENT: <which return surfaced it>. This is an explicit exhaustive-research assignment; budgets do not apply.
<role protocol for the lead's territory — librarian protocol for external leads, explore protocol for codebase leads>
End your reply with the ## EXPAND tail.")
```

4. Record the wave in `expansion-log.md`: spawned, markers gained, leads opened/closed.

**Convergence — the only stop rules while this mode is active.** Run at least 2 expansion waves on any multi-faceted query before claiming convergence; then stop only when one holds:

- Zero unchecked leads remain — each investigated or closed as duplicate/dead end.
- 3 consecutive waves produced no new actionable leads.
- Expansion depth reached 5 waves — pause, show the open leads, and ask the user whether to extend.

## Phase 3 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Spawn one verification worker per claim:

```
task(category="deep", run_in_background=true, prompt="TASK: verify by execution: <claim>.
SOURCE: <where it came from>; CONTRADICTION: <opposing source, if any>.
Write a minimal self-contained script that tests the claim; run it (uv run --with <deps> python / bun / direct compile); capture full stdout+stderr; pin versions.
Reply with: the exact code, the full output, environment (OS, runtime, dependency versions), and a verdict — CONFIRMED / REFUTED / PARTIAL — grounded in the output.")
```

Journal each verdict to `verify-<slug>.md`.

## Phase 3b — Lock non-code claims through the claim graph

Code settles code-shaped claims (Phase 3). Numeric, market-share, legal, dated, causal, and financial claims cannot be run — so they pass through a data-flow-lock instead (the verification idea adapted from fivetaku/insane-research): the synthesis may assert a high-risk non-code claim **only** if it cleared this gate, and the gate's output is the sole allowlist the synthesis draws from. Skip the gate and there is nothing to synthesize — the lock is self-enforcing.

The claim graph is orchestrator-owned. Workers only return verified-claim markers, observation candidates, and claim candidates as message text, the same channel as EXPAND markers — never a file. As leads resolve, you record one node per asserted claim in `claim-graph.md` and compute its status; workers report claim candidates in their replies, and you decide. The graph is the single claim store: final synthesis may not draw from free-form claims that skipped it.

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

## Phase 4 — Synthesize

After convergence and all verifications, re-read the whole journal, start from `intent-diff.md`, `claim-graph.md`, and `observation-manifest.md`, then write `SYNTHESIS.md`:

```
# ULW-Research Synthesis: <query>
Workers: <total> · Waves: <count> · Sources: <count> · Verifications: <count>

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

## Phase 5 — Final materials

Default final materials to HTML/PDF unless the user explicitly asks for a different format: "report" / "document" → HTML first, with a PDF default available through weasyprint (`uv run --with weasyprint python`) · "pdf" → HTML first, then weasyprint · "slides" / "presentation" / "deck" → python-pptx · "html" / "webpage" → standalone HTML · "markdown only" → Markdown.

Asset workers (background, parallel): actively use charts for quantitative findings (`uv run --with matplotlib --with plotly python`) saved by you to `$SESSION_DIR/assets/`; Mermaid graphs for process, architecture, argument, and evidence-flow structure; full-page screenshots of the top 5-10 sources (browsing skill); generated diagrams or editorial visuals with the imagegen skill when architecture, flows, or narrative framing benefit from bitmap assets.

Assembly worker — `task(category="deep", load_skills=["frontend", "visual-qa", "open-design", "data-scientist", "imagegen", "ulw-loop"], run_in_background=true, ...)`: before writing, read every available design and visualization skill and apply it — the report is a designed artifact, not a text dump. Run HTML/PDF output through the ULW loop with frontend and visual-qa, then repair until the reviewer says no broken parts and gives approval. Structure: executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (workers, waves, searches, verifications). Every claim cites `[Source N]`.

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
| Asking a worker to write journal or session files | Workers are read-only; you journal every return |
| Two workers given the same angle | One unique angle per worker, always |
| Contested claim settled by judgment | Phase 3 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
