---
name: ulw-research
description: "Team-first maximum-saturation research orchestration for omo-senpi. Scopes the topic solo, organizes the axes into a brief, then DEFAULTS to a cooperating team (team_create) - one member per axis plus skeptic/red-team members for ultradebate/hyperdebate cross-critique - with curated explore/librarian/oracle task lanes for recon, expansion, and verification; a recursive EXPAND loop until leads run dry; contested claims proven by executed code or locked through the claim-graph gate; cited synthesis and optional MD/HTML/PDF/PPTX reports. ACTIVATES ONLY on an explicit user demand for research: the word 'ulw-research' ('/ulw-research', '$ulw-research'), any 'ulw' research wording, 'ultradebate' or 'hyperdebate' research requests, or an explicit request for research / deep research / an ultra-precise investigation, in any language. Never self-activates for ordinary questions, debugging, or implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
metadata:
  short-description: Team-default saturation research with debate cross-critique and cited synthesis
---

# ULW-RESEARCH — Team-First Maximum-Saturation Research

You are the research orchestrator AND the team lead. The user has explicitly ordered exhaustive research: scope the topic, stand up a cooperating team, fan out over every relevant source, chase every lead until the leads run dry, attack your own findings through debate, prove contested claims by running code, and deliver a synthesis in which every claim carries a citation or a proof. Exhaustive coverage is the assignment, not a risk to manage.

## Activation

Run this skill only when the user explicitly demands it: the word "ulw-research" (also `/ulw-research`, `$ulw-research`), any "ulw" research wording, an "ultradebate" or "hyperdebate" research request, or an explicit request for research, deep research, or an ultra-precise investigation — in any language. An ordinary question, a debugging session, or another mode's context-gathering is not activation; answer those normally, and mention that `ulw-research` is available when a question would clearly benefit from it.

Open your reply with the line `ULW-RESEARCH MODE ENABLED!`. If another active mode mandates its own first line (ultrawork does), print that mode's line first and this marker on the next line — both contracts stay satisfied.

## How this maps to omo-senpi

This skill is authored against the native senpi task + team tool surface. You coordinate everything with these tools:

| Purpose | Tool | Key arguments |
|---------|------|---------------|
| Stand up the research team once | `team_create` | `inline_spec: { name, members: [{ name, category, prompt? }] }` → returns `team_run_id` |
| Send work / a lead / a debate round to a member | `task_send` | `to: "<member>"`, `team_run_id`, `message`, optional `summary` |
| Collect member replies (durable pull inbox) | `team_wait` | `team_run_id`, optional `from`, optional `timeout_ms` |
| Track shared research state | `task_create` / `task_list` / `task_update` / `task_get` | lead-only team tasklist |
| Spawn a bounded recon / expansion / verification lane | `task` | `prompt` + `subagent_type: "explore" \| "librarian" \| "oracle"` or a `category`; `run_in_background: true`; optional `load_skills`, `name` |
| Read a finished lane back | `task_output` | task id or name |
| End a lane / park it | `task_cancel` / `task_send({ deliver_as: "interrupt" })` | — |
| Disband the team at the end | `team_delete` | `team_run_id`, `force: true` |

Members see only member-scoped `task_send` / `team_wait` inside their child process; they report to you with `task_send({ to: "lead", message: "..." })`. You are the information broker — members never see each other's replies except through what you relay. The curated agents (`explore`, `librarian`, `oracle`, `metis`, `momus`) are read-only, in-process, and REJECTED as team members: route them through `task` lanes, never through `team_create`.

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
- Final materials follow the Phase 6 format default or the user's explicit format.
- The session journal reconstructs what was searched, found, expanded, and debated, wave by wave.
- The team was disbanded (`team_delete`) and every lane reached terminal status before the final answer.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts — members and lanes NEVER write session files:

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), and final synthesis location. High-risk non-code nodes that clear the Phase 4b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.
- `debate-log.md` — one row per debate round: the claim under attack, the attacker's argument, the defender's evidence, your verdict, and what changed in the claim graph because of it.

Observation candidates, claim candidates, and EXPAND leads travel back from members and lanes as message text. You write the instrumentation artifacts, link candidates into the intent diff and claim graph, and record where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Phase 0 — Scope solo, organize the brief

Before spawning anything, decompose the query YOURSELF with your own direct tools: a handful of fast searches, a skim of the obvious codebase or doc territory, one eval cell batching the independent lookups. This is a scoping pass, not research — minutes, not waves. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?"

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no> · Final material format: <HTML/PDF default | explicit format | markdown only>
Debate need: <which claims will be contested, and which member perspectives attack them>
</analysis>
```

Then create the session directory and write the brief:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. Write `brief.md` into it: the analysis block, the axis list with one named owner per axis, the expected truths seeding `intent-diff.md`, and the team roster you are about to create. The brief is what the team is built FROM — a team stood up before the brief exists is a failure mode (see the table at the end).

## Phase 1 — Stand up the team (DEFAULT composition)

A team is the DEFAULT for ulw-research, not an option: a lead one member surfaces almost always reshapes what another should search next, and debate needs live cooperating members, not fire-and-forget workers. Create it immediately after the brief:

```
team_create({
  inline_spec: {
    name: "ulw-research-<slug>",
    members: [
      { name: "<axis-owner-1>", category: "deep", prompt: "<member brief for axis 1 — see below>" },
      { name: "<axis-owner-2>", category: "deep", prompt: "<member brief for axis 2>" },
      ...
      { name: "skeptic", category: "ultrabrain", prompt: "<debate brief — see below>" },
    ],
  },
})
```

- **One member per axis — by part, ownership, or perspective, never a job title.** Each Phase 0 axis is one member owning one concrete slice: a codebase part, a source territory, or a question lens. No two members share an angle. "Backend researcher" or "the web person" gives no real boundary and invites overlap — name what the member owns.
- **Many teammates by default.** Prefer a larger roster, usually 5-8 members, whenever the axes can be made distinct. Route researchers through a capable category your `omo.json` defines (`deep`, `unspecified-high`); a category member must also carry its brief as `prompt` (the runtime requires both), and a `subagent_type` member must name a non-curated agent — a member with neither is rejected at parse. NEVER name a curated agent (`explore`, `librarian`, `oracle`, `metis`, `momus`) as a member — the runtime rejects them; they run as `task` lanes instead.
- **Debate members are mandatory for ultradebate/hyperdebate, default otherwise.** At least one skeptic/red-team member (`ultrabrain` or your strongest reasoning category) whose ONLY job is attack: cross-critique claims, evidence quality, source independence, synthesis structure, and report choices before they reach the deliverable. When the user says ultradebate or hyperdebate, run at least two attacking perspectives (e.g. a skeptic attacking evidence and a contrarian attacking framing) and give every contested claim a full round.
- **The raise law — broadcast every lead the instant it surfaces.** Member briefs order relentless over-communication: every new lead, finding, contradiction, and dead end goes to `task_send({ to: "lead" })` the moment it surfaces, never hoarded for a final dump. Through long passes members send `WORKING: <axis> - <phase>`, and `BLOCKED: <reason>` the moment progress stops. Too many small updates is correct here; going quiet is the only failure. You collect them with `team_wait` — act on each lead the moment it lands (Phase 3), never waiting for a member's final reply.
- **Track shared state in the open.** Register the axes and major leads on the team tasklist (`task_create`) and keep them current (`task_update`) so a member reconnecting after a crash can see the whole board.

### Member brief contract

Every member `prompt` contains, in order:

1. `TASK:` — one imperative line naming the role and the owned axis.
2. The budget lift: "This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and raise every lead."
3. Scope — the axis, the sources to hit, and what a complete answer contains.
4. The role protocol (Phase 2).
5. The raise law and the reply tail. EXPAND markers, observation candidates, and claim candidates travel back as message text to `to: "lead"`, never as files. Every substantial report ends with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
```

A member with nothing to expand sends `## EXPAND` followed by `none — <one-line reason>`. A report missing the tail is incomplete: send that member one follow-up demanding it.

## Phase 2 — Saturation wave

Launch the entire first wave in one turn — every member briefed at `team_create` time starts immediately; add bounded `task` lanes in the same turn for the territories members cannot reach (read-only curated-agent sweeps, blocked pages). Sequential launches and "start with one and see" defeat the mode.

Scaling floor — more angles always justify more workers; members and lanes together must meet it:

| Query scope | explore lanes | librarian lanes | browsing lanes | repo-dive lanes | team members | floor |
|---|---|---|---|---|---|---|
| Single topic, codebase only | 1 | 0 | 0 | 0 | 3 | 3 |
| Single topic, web only | 0 | 2 | 1 | 1 | 4 | 6 |
| Single topic, both | 1 | 2 | 1 | 1 | 5 | 7 |
| Multi-faceted | 2 | 4 | 2 | 1 | 6-8 | 14 |
| Full due diligence | 2 | 4 | 2 | 2 | 8 | 15 |

Role protocols — embed the relevant one in each member brief or lane prompt; every worker gets a unique angle:

- **Codebase (`explore` lane or member).** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S '<keyword>'` and `--grep` for history including deleted code. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect.
- **Web (`librarian` lane or member).** At least 10 distinct websearch queries per worker, each with a different operator or angle (see Search craft); fetch the full page for every result that matters — snippets lie. grep.app and `gh search code|repos|issues` for real-world usage. Official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages.
- **Browsing (member or `task` lane with `load_skills: ["ultimate-browsing"]`).** Pages plain fetch cannot read (WAF, 403, Cloudflare, dynamic rendering, login): escalate through the ultimate-browsing tiers rather than abandoning the source. Capture screenshots when visual context matters. When one blocked territory hides many leads, fan out more browsing lanes in parallel for breadth instead of serializing one worker through them.
- **Repo deep-dive (`librarian` lane).** Shallow-clone the most relevant repos to `${TMPDIR:-/tmp}`, pin the HEAD SHA, read core modules, follow call chains, return SHA-pinned permalinks.

Curated-agent lane ground rules:

- **Read-only.** Curated lanes cannot write files. Never ask any worker to write the journal or any session file — every journal write is yours.
- **No recursion.** Lanes cannot spawn their own subagents. Depth comes from your expansion waves and your members, not from worker-side recursion.
- **Built-in brakes.** Workers ship with their own retrieval budgets ("stop when answered"). Your spawn prompt must explicitly lift the budget and demand the EXPAND tail, or the worker returns a thin single-pass answer with no leads.

## Phase 3 — Expand and debate until convergence

This loop is what makes the mode research rather than search. Collect returns as they land with `team_wait` and `task_output` — and act on each raised lead the moment it arrives:

1. Journal the return: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`.
2. Deduplicate new markers against `expansion-log.md` — every lead ever seen, not just confirmed ones, or rejected leads resurface each wave.
3. Route each new unchecked lead immediately: `task_send` it to the member who owns that territory, or spawn an expansion lane when no member owns it:

```
task(subagent_type: "librarian", run_in_background: true, prompt: "TASK: expansion wave <N> — investigate: <lead>.
PARENT: <which return surfaced it>. This is an explicit exhaustive-research assignment; budgets do not apply.
<role protocol for the lead's territory>
End your reply with the ## EXPAND tail.")
```

4. **Debate rounds (the ultradebate/hyperdebate engine).** The moment a contested, high-risk, or surprising claim lands, `task_send` it to the skeptic (and the contrarian, when stood up): "ATTACK: <claim> — EVIDENCE: <what supports it> — find the weakest assumption, the missing counter-source, the independence failure." Relay the attack to the claim's owner for defense, collect both sides, then record your verdict in `debate-log.md` and update the claim node. A claim that never drew an attack still gets one skeptic pass before it may enter the synthesis as supported.
5. Record the wave in `expansion-log.md`: spawned, markers gained, leads opened/closed, debates settled.

**Convergence — the only stop rules while this mode is active.** Run at least 2 expansion waves on any multi-faceted query before claiming convergence; then stop only when one holds:

- Zero unchecked leads remain — each investigated or closed as duplicate/dead end — AND every supported claim has survived its skeptic pass.
- 3 consecutive waves produced no new actionable leads.
- Expansion depth reached 5 waves — pause, show the open leads, and ask the user whether to extend.

## Phase 4 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Run the verification yourself in one eval cell, or spawn one verification lane per claim:

```
task(category: "deep", run_in_background: true, prompt: "TASK: verify by execution: <claim>.
SOURCE: <where it came from>; CONTRADICTION: <opposing source, if any>.
Write a minimal self-contained script that tests the claim; run it (uv run --with <deps> python / bun / direct compile); capture full stdout+stderr; pin versions.
Reply with: the exact code, the full output, environment (OS, runtime, dependency versions), and a verdict — CONFIRMED / REFUTED / PARTIAL — grounded in the output.")
```

Journal each verdict to `verify-<slug>.md`.

## Phase 4b — Lock non-code claims through the claim graph

Code settles code-shaped claims (Phase 4). Numeric, market-share, legal, dated, causal, and financial claims cannot be run — so they pass through a data-flow-lock instead: the synthesis may assert a high-risk non-code claim **only** if it cleared this gate, and the gate's output is the sole allowlist the synthesis draws from. Skip the gate and there is nothing to synthesize — the lock is self-enforcing.

The claim graph is orchestrator-owned. Workers only return claim candidates as message text, the same channel as EXPAND markers — never a file. As leads resolve, you record one node per asserted claim in `claim-graph.md` and compute its status; workers report candidates in their replies, and you decide. The graph is the single claim store: final synthesis may not draw from free-form claims that skipped it.

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

## Phase 5 — Synthesize

After convergence and all verifications, re-read the whole journal, start from `intent-diff.md`, `claim-graph.md`, `observation-manifest.md`, and `debate-log.md`, then write `SYNTHESIS.md`:

```
# ULW-Research Synthesis: <query>
Members + lanes: <total> · Waves: <count> · Sources: <count> · Verifications: <count> · Debate rounds: <count>

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

## Phase 6 — Final materials, then teardown

Default final materials to HTML/PDF unless the user explicitly asks for a different format: "report" / "document" → HTML first, with a PDF default available through weasyprint (`uv run --with weasyprint python`) · "pdf" → HTML first, then weasyprint · "slides" / "presentation" / "deck" → python-pptx · "html" / "webpage" → standalone HTML · "markdown only" → Markdown.

Asset lanes (background, parallel `task` spawns): actively use charts for quantitative findings (`uv run --with matplotlib --with plotly python`) saved by you to `$SESSION_DIR/assets/`; Mermaid graphs for process, architecture, argument, and evidence-flow structure; full-page screenshots of the top 5-10 sources (browsing lane); generated diagrams or editorial visuals with an image-generation skill when the surface provides one and architecture, flows, or narrative framing benefit from bitmap assets.

Assembly lane — `task(category: "deep", load_skills: ["frontend", "visual-qa"], run_in_background: true, ...)`: the report is a designed artifact, not a text dump — executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (members, lanes, waves, searches, verifications, debate rounds). Every claim cites `[Source N]`. Run the output through a visual-qa pass and repair until no broken parts remain.

**Teardown is part of the deliverable.** When synthesis is written and materials are assembled: `team_delete({ team_run_id, force: true })` the research team, confirm every lane is terminal (`/tasks`), and only then write the final answer. A live team left running past the final answer is a failed run, not a finished one.

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
| Asking a worker to write journal or session files | Workers report as message text; you journal every return |
| Two workers given the same angle | One unique angle per worker, always |
| Contested claim settled by judgment | Phase 4 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
| Final answer while the team is still live | `team_delete` + terminal lanes first; teardown is part of done |
