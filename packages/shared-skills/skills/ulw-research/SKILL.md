---
name: ulw-research
description: "Maximum-saturation research orchestration: ALWAYS proposes the final materials first (PDF+DOCX default), then parallel explore+librarian swarms across codebase, web, official docs, and OSS repos — max-roster teammode when the harness has it — with live journaling, a recursive EXPAND loop driven by leads workers return in message text, empirical verification by running code, and a cited synthesis with charts/Mermaid/assets behind a mandatory visual-QA gate. ACTIVATES ONLY on an explicit user demand for research — the word 'ulw-research' ('/ulw-research', '$ulw-research'), any 'ulw' research wording, 'ultradebate' or 'hyperdebate' research requests, or an explicit request for research / deep research / an ultra-precise investigation, in any language. Never self-activates for ordinary questions, debugging, or implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
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
- The format-proposal gate was asked and answered BEFORE the first wave, and the final materials match that answer.
- The delivered artifact passed every delivery gate for this harness: visual QA on the rendered pages always, plus the proofread pass where the harness provides one (Phase 5).
- Every excursion opened during the run was closed by an EXIT rule, folded back into the claim or axis that triggered it, and recorded in both `excursion-log.md` and the ulw-loop ledger.
- The delivery message carries the closing briefing: how many sources the answer rests on (total + unique domains) and how many minutes the run took.
- The session journal reconstructs what was searched, found, and expanded, wave by wave, and it was written in real time rather than reconstructed at the end.

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
- **Always the maximum roster.** The team is not sized by taste: fill every member slot your harness allows (OpenCode `team_mode` caps members at 8; Codex teammode has its own ceiling) on every run. If you can only name five axes, split the broadest one — by source territory, by time window, by perspective — until the roster is full. A half-empty team is a half-covered topic.
- **Compose deliberately across everything you can spawn.** Before writing the roster, enumerate what this session actually has — every delegation tier the harness or config defines and every spawnable role — and give each slot the cheapest tier that can do ITS job: broad recon on fast tiers, contested analysis on deep tiers, attack lanes on the strongest reasoning tier. Mixed tiers by design, never one tier across the whole board.
- **Routing words from the user are literal.** "quick", "fast", "deep", "all quick", "max parallel" — in any language — are hard instructions, not mood. Route exactly as asked and journal `requested tier -> spawned worker -> fallback reason` for every slot. Silently promoting a "quick" roster to a heavier tier is a defect, and so is dropping to a cheaper one without saying why.
- **Debate members are mandatory for ultradebate/hyperdebate, default otherwise.** At least one skeptic or red-team perspective attacks claims, evidence quality, source independence, synthesis structure, and report choices before they reach the deliverable. When the user says ultradebate or hyperdebate, run at least two attacking perspectives and give every contested claim a full round.

**One team, or a sequence — decided by scale and precision.** One team is the floor, not the ceiling. When the brief shows 6+ axes, several source territories, or a long final document — or a wrong claim is expensive (legal, medical, financial, procurement, public-facing) — run the research team to convergence, disband it, and stand up a REFINEMENT team from your strongest reasoning tiers whose only job is to attack and sharpen the synthesis before the document is written. A fresh premium team reading a finished journal reasons better than the same researchers grading their own homework. Build each team from a written brief and disband it before the next one starts; never leave two research teams live at once.
- **The raise law — broadcast every lead the instant it surfaces.** Members over-communicate relentlessly: every new lead, finding, contradiction, and dead end is raised to you the moment it surfaces, never hoarded for a final dump. Through long passes they send `WORKING: <axis> - <phase>`, and `BLOCKED: <reason>` the moment progress stops, so you always know a member is alive. Too many small updates is correct here; going quiet is the only failure.
- **You lead; expand on each raised lead.** Members raise via message text, never write session files. Journal each lead and spawn its expansion the instant it lands (Phase 2), not only when a member's final reply arrives.

## Worker ground rules

Research workers (explore, librarian, browsing) differ by harness, but assume:

- **Read-only.** Most research workers cannot write files. Never ask a worker to write the journal or any session file — every journal write is yours.
- **No recursion — workers AND members.** Workers cannot spawn their own subagents, and team members must not re-orchestrate: a member researches its axis and reports; it never stands up its own team, loads this skill, or fans out a research swarm of its own. Depth comes from YOUR expansion waves. Say so in every spawn message — a member that starts its own research protocol burns the run's budget on duplicated orchestration and returns nothing you can cite.
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
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no>
Scale: <axis count, source territories, target document length> · Precision demand: <what a wrong claim costs here> → lifecycle: <single team | research team then refinement team>
</analysis>
```

Then create the session directory:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. The orchestrator owns the journal: you write every file in it; workers never do. Maintain:

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

ulw-loop is ON by default for this mode: when the `ulw-loop` skill is available, register the research axes as loop goals so the run has durable state and survives a compaction. The session directory's timestamp is the run's start clock — the closing briefing is computed from it, so create it once and never rename it. From that point every finding, source, quote, number, and lead is written into `$SESSION_DIR` **the instant it lands** — never held in the conversation for an end-of-run dump. After any context loss, re-read the brief and the journal before doing anything else, then resume from the open wave.

### Format-proposal gate — ALWAYS ask, before the first wave

Never guess the shape of the deliverable. After the decomposition and before spawning wave 1, propose the final materials and WAIT for the user's answer:

- **Default pair: PDF + DOCX.** Offer both as the baseline for any report/document request.
- Name the alternatives that actually fit THIS domain — slides for a briefing, standalone HTML for a living page, Markdown for a working note, several at once when the audience differs.
- Propose the TEMPLATE too, chosen from the domain and the user's own context: section skeleton, citation style, length target, language, and any house style they have used before. A prior document the user points at is the strongest template signal — read it and mirror its structure and tagging.
- Ask once, compactly: proposed format + proposed template + what each option costs. Then stop and wait. Guessing here wastes the entire assembly pass.

Record the answer in the journal; Phase 5 opens by turning it into `design-spec.md`.

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

**Disambiguate before you expand.** When the topic names something that could resolve several ways — a product, a person, a codename, a version — the first wave settles WHICH entity before any worker researches its history, benchmarks, or controversies: canonical name, first-party URL or account, whether it exists in the claimed category, and a confidence line. An unresolved entity never becomes a premise in a later wave's spawn message; that is exactly how a run starts inventing facts about something that does not exist.

Role protocols — embed the relevant one in each spawn message; every worker gets a unique angle:

- **Codebase (explore), 2-4 workers.** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S '<keyword>'` and `--grep` for history including deleted code. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect.
- **Web (librarian), 3-6 workers.** At least 10 distinct websearch queries per worker, each with a different operator or angle (see Search craft); fetch the full page for every result that matters — snippets lie. Context7 with 3+ queries per known library. grep.app and `gh search code|repos|issues` for real-world usage. Official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages.
- **Browsing, 0-3 workers.** Pages plain fetch cannot read (WAF, 403, Cloudflare, dynamic rendering, login): the worker loads the `ultimate-browsing` skill and escalates through its tiers — Tier-1 insane-search engine first (including its Phase-2.5 archive surrogates), then Tier-2 Chrome stealth — rather than abandoning the source. Capture screenshots when visual context matters. **Provenance is part of the claim**: when a source came back with `provenance` of `snapshot` (an archive copy), cite it with its `snapshot_timestamp` and never state it as the current live page; content from a `proxy` route is `untrusted` and needs a second independent route before any claim rests on it. When one blocked territory hides many leads, fan out more browsing subagents in parallel for breadth instead of serializing one worker through them.
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

1. Journal the return the moment it lands, never at the end of the wave: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`, appending each new source, quote, and number to the observation manifest in the same beat — after a compaction the journal, not your memory, is the state.
2. Deduplicate new markers against `expansion-log.md` — every lead ever seen, not just confirmed ones, or rejected leads resurface each wave.
3. Spawn an expansion worker immediately for each new unchecked lead:

```
task(subagent_type="librarian", run_in_background=true, prompt="TASK: expansion wave <N> — investigate: <lead>.
PARENT: <which return surfaced it>. This is an explicit exhaustive-research assignment; budgets do not apply.
<role protocol for the lead's territory — librarian protocol for external leads, explore protocol for codebase leads>
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

**Write the skeleton early and fill it as claims lock.** The moment the format gate is answered, create the deliverable file with its approved section headings and a `STATUS: draft — <n> sections open` line at the top. An interrupted run must leave a partial report on disk, never an empty directory and a lost conversation.

**Keep sourced numbers, assumptions, and derived results visibly apart.** Every quantitative claim carries its lineage: `MEASURED` (a number a source states, cited), `ASSUMED` (a coefficient, distribution, or scope you chose — say why), `DERIVED` (computed from those, showing the formula), plus a sensitivity line whenever the assumption moves the answer. Presenting a derived estimate with the confidence of a measured one is the most damaging thing this mode can ship.

**Search in English, deliver in the user's language.** Retrieval stays English-first (Search craft), but the synthesis and every final material are written in the language the user wrote to you in unless they ask otherwise — and a translated report still quotes its original-language sources verbatim.

## Phase 5 — Final materials

The format answered at the Phase 0 gate is binding. Absent an explicit user override, render **both PDF and DOCX**:

| Target | How |
|---|---|
| PDF (default) | Author the report as one self-contained HTML file, then print it headless: `chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=<out.pdf> file://<report.html>`. Embed the `design-spec.md` fonts as real webfonts (CJK included) instead of trusting system fallbacks. `uv run --with weasyprint python` is the fallback renderer. |
| DOCX (default) | `pandoc <report.md> -o <out.docx>`, adding `--reference-doc=<template.docx>` when the user has a house style; `uv run --with python-docx python` when pandoc is unavailable. Charts and Mermaid renders go in as images. |
| Slides / deck | `uv run --with python-pptx python` — one claim per slide, a chart or diagram per claim. |
| Standalone HTML / Markdown | The authored source itself. |

**Write `design-spec.md` the moment the format gate is answered — before any asset worker spawns.** It is the one design contract every asset and assembly worker receives: template family (a document the user pointed at is the strongest signal — mirror its structure and register; absent one, default to the clean analyst-report register — restrained accent palette, generous margins, styled section headings, no emoji, no clipart), accent palette, body/heading fonts (a real CJK webfont — Pretendard, Noto Sans KR — when the report language needs one), and the figure standard below. One font family and one palette govern prose, charts, Mermaid, and generated images alike; a diagram rendering in a random default font inside a styled report is a defect, not a style choice.

**The figure standard — binding for every image, chart, and diagram.** Each figure sits in a fixed-size container styled from the spec (border, background, caption); the image scales to fit entirely inside it with its original aspect ratio preserved — object-fit: contain semantics — never stretched, never cropped, never spilling out. Every chart carries a title, axis labels, units, and value labels in the report's language; a bare number the reader cannot name is a defect.

Asset workers (background, parallel, each fed `design-spec.md`) — visuals are the DEFAULT deliverable of this phase, not garnish the user must ask for; a delivered report without figures is an incomplete run:

- **Charts for every quantitative finding, computed from real data.** Pull the numbers into an actual table first (CSV/JSON under `$SESSION_DIR`), then plot from that table, never from prose. Follow the data-scientist tool doctrine — numpy always, Polars for filtering/sorting/transforms, DuckDB for joins/aggregations/window functions, never pandas — and load the `data-scientist` skill when this session has it: `uv run --with numpy --with polars --with duckdb --with pyarrow --with matplotlib python`. Keep `pyarrow` in that set — the DuckDB-to-Polars handoff (`.pl()`) fails without it, and `.df()` fails without pandas, so hand data across through `.pl()`, never `.df()`. Save to `$SESSION_DIR/assets/`.
- **Mermaid graphs** for process, architecture, argument, timeline, and evidence-flow structure, themed to the spec's fonts and palette. Render each to SVG and confirm the file exists before the document references it.
- **Generated visuals through the imagegen skill whenever the session has it:** a cover plus a concept illustration per major theme, prompted from the spec's style, palette, and mood — document-styled illustration, never generic stock art dropped into a designed page.
- **Full-page screenshots** of the top 5-10 sources (browsing worker) as provenance you can show.

**Verify the asset manifest before rendering.** List every asset the document references, assert each file exists and is non-empty on disk, and re-render whatever is missing. A document that renders with three broken diagrams is a document you will publish twice.

Assembly worker — `task(category="deep", load_skills=["frontend", "visual-qa", "open-design", "data-scientist", "imagegen", "ulw-loop"], run_in_background=true, ...)`: before writing, read every available design and visualization skill and apply it — the report is a designed artifact, not a text dump; the worker's prompt carries `design-spec.md`. Use the template the user approved; absent a stronger house style the default skeleton is executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (workers, waves, searches, verifications, debate rounds) → correction log naming what verification overturned. Write it long and specific: every claim cites `[Source N]`, and the sources section lists every source the run actually used rather than a curated few.

### The delivery gates — every gate must PASS, in order

Nothing reaches the user until the gates pass:

1. **Visual QA (always).** Render the produced artifact back to images — PDF pages to PNG, the HTML in a real browser — and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Fix and re-render until the pages are clean. Reading the source markup is not visual QA; inspect the pixels.
2. **Proofread gate — `task(category="writing", ...)`.** Hand the final text to a dedicated `writing` worker whose only job is language: grammar, spelling, punctuation, terminology consistency, and whether the prose reads NATIVELY in the report's own language. It returns a defect list; fix every item and re-run the gate on the delta. Deliver only on a clean pass — this gate runs BEFORE the first delivery, not after the user finds the typo.

Then deliver: the artifact plus a compact chat-readable summary of what it says — the answer in a few sentences, the numbers that matter, and what to look at first. The document is the deliverable; the summary is what gets it read.

### The closing briefing — every run ends with it

The last thing the user reads states, in one compact block, what the answer is made of:

- **Sources.** How many sources the answer rests on and how many distinct domains they come from, counted from the journal's source ledger, not estimated. Name how many were primary sources and how many claims went to the unresolved/refuted annex.
- **Effort.** Workers, waves, excursions, and verifications — the same counters as the `SYNTHESIS.md` header.
- **Elapsed time, always.** Minutes from the run's start to delivery, derived from the session directory's own timestamp so it cannot be guessed: `python3 -c "import datetime,os,sys; s=datetime.datetime.strptime(os.path.basename(sys.argv[1]),'%Y%m%d-%H%M%S'); print(round((datetime.datetime.now()-s).total_seconds()/60))" "$SESSION_DIR"`.

Never ship the artifact without this block, and never fill it from memory — every number in it is read off the journal.
 If you stood up a team, disband it and confirm every worker is terminal before the final answer.

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
| Guessing the deliverable format instead of asking | The format gate is unconditional: propose PDF+DOCX plus the domain-fitting alternatives and the template, then wait before wave 1 |
| A roster smaller than the harness ceiling | Fill every member slot; split the broadest axis until the team is full |
| One tier across the whole roster | Mixed tiers by design — cheap breadth, premium attack |
| Silently re-routing a "quick"/"fast" instruction | Routing words are literal; journal requested -> spawned -> fallback per slot |
| A worker or member that starts its own research swarm | Members research one axis and report; orchestration is yours alone |
| Expanding on an entity the first wave never disambiguated | Settle canonical identity and first-party source before any later spawn asserts it |
| Batching findings into an end-of-run journal dump | Journal each return as it lands; the journal is what survives a compaction |
| Ending the run because every worker finished | Reserve the final fifth of the run for synthesis and materials |
| A derived estimate presented as a measured number | MEASURED / ASSUMED / DERIVED lineage on every quantitative claim, plus a sensitivity line |
| Delivering before the delivery gates pass | Visual QA on rendered pages always, plus the harness's proofread gate — a typo the user finds means a gate did not run |
| Referencing an asset that is not on disk | Verify the asset manifest before rendering; re-render whatever is missing |
| A figure stretched, cropped, or styled off the report's design language | `design-spec.md` binds every asset: fixed containers, contain-fit with aspect preserved, spec fonts and palette in charts and Mermaid |
| Chasing an interesting find with no ENTER trigger | Excursions need a named trigger; everything else stays a queued lead |
| An excursion that never came back, or drifted into a new mission | EXIT rules are unconditional; depth 3 means promote it to an axis or record it as a gap |
| An excursion whose result was never folded back | Every EXIT writes what it changed in the top-level answer, `none` included, and mirrors into the loop ledger |
| Delivering without the closing briefing | Source count, unique domains, and elapsed minutes are read off the journal and stated every time |
