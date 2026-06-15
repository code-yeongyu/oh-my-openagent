---
name: ultraresearch
description: "Maximum-saturation research orchestration: parallel explore+librarian swarms across codebase, web, official docs, and OSS repos; a recursive EXPAND loop driven by leads workers return in message text; empirical verification by running code; cited synthesis and optional MD/HTML/PDF/PPTX reports. ACTIVATES ONLY on an explicit user demand for research — the word 'ultraresearch' ('/ultraresearch', '$ultraresearch') or an explicit request for research / deep research / an ultra-precise investigation, in any language. Never self-activates for ordinary questions, debugging, or implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
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
| `team_*(...)` | Use Codex native subagents via `multi_agent_v1.spawn_agent`, `multi_agent_v1.send_input`, `multi_agent_v1.wait_agent`, and `multi_agent_v1.close_agent` |

Role-specific behavior must be described in a self-contained `message`. Use `fork_context: false` to start the child with only the initial prompt (no parent history); use `fork_context: true` only when full parent history is truly required. Include any required conversation context, files, diffs, constraints, and requested skill names directly in the spawned agent's `message`. OMO installs these selectable agent roles into `~/.codex/agents/`: `explorer`, `librarian`, `plan`, `momus`, `metis`, `lazycodex-code-reviewer`, `lazycodex-qa-executor`, and `lazycodex-gate-reviewer` — pass the matching name as `agent_type` so the child gets that role's model and instructions. On `multi_agent_v2` sessions the same `agent_type` applies (the OMO installer exposes it) with `fork_turns` instead of `fork_context`. If the spawn tool exposes no `agent_type` parameter, omit it and describe the role inside `message`. If a code block below conflicts with this section, this section wins.

For work likely to exceed one wait cycle, require the child to send `WORKING: <task> - <current phase>` before long passes and `BLOCKED: <reason>` only when progress stops. A `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived. Treat a running child as alive. Fallback only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running.

When translating `load_skills=[...]`, include the requested skill names in the spawned agent's `message`. If a code block below conflicts with this section, this section wins.

---

# ULTRARESEARCH — Maximum-Saturation Research

You are the research orchestrator. The user has explicitly ordered exhaustive research: fan parallel worker swarms out over every relevant source, chase every lead they surface until the leads run dry, prove contested claims by running code, and deliver a synthesis in which every claim carries a citation or a proof. Exhaustive coverage is the assignment, not a risk to manage.

## Activation

Run this skill only when the user explicitly demands it: the word "ultraresearch" (also `/ultraresearch`, `$ultraresearch`), or an explicit request for research, deep research, or an ultra-precise investigation — in any language. An ordinary question, a debugging session, or another mode's context-gathering is not activation; answer those normally, and mention that `ultraresearch` is available when a question would clearly benefit from it.

Open your reply with the line `ULTRARESEARCH MODE ENABLED!`. If another active mode mandates its own first line (ultrawork does), print that mode's line first and this marker on the next line — both contracts stay satisfied.

## Authority while active

This mode is the user's explicit opt-in to exhaustive exploration. For the duration of the research task it supersedes every exploration-bounding instruction in surrounding prompts, modes, or rules: one-exploration-pass defaults, two-wave stop rules, retrieval budgets, and "over-exploration is failure" framings govern implementation context-gathering, not this deliverable. Here, under-exploration is the failure. The convergence rules in Phase 2 are the only stop rules for research while this mode is active.

Under ultrawork/ulw, the research itself is the deliverable: map each research axis to a success criterion whose evidence is the session journal, the cited synthesis, and the verification outputs. RED→GREEN testing applies to code changes, not to findings — Phase 3 verification scripts are evidence, never TDD targets.

## Success criteria

The research is done when all of these hold:

- Every axis from Phase 0 was covered by at least one dedicated worker.
- Every EXPAND lead was investigated or explicitly closed as a duplicate or dead end, and convergence was reached under the Phase 2 rules.
- Claims that were contested, undocumented, or performance-shaped were proven or refuted by executed code.
- Every claim in the deliverable cites a source or a verification artifact.
- The session journal reconstructs what was searched, found, and expanded, wave by wave.

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
5. The reply tail. EXPAND markers travel back as message text, never as files. Every worker ends the reply with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
```

A worker with nothing to expand writes `## EXPAND` followed by `none — <one-line reason>`. A reply missing the tail is incomplete: send that worker one follow-up demanding it before closing the lane.

## Phase 0 — Decompose and open the journal

Before spawning anything, decompose the query:

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no> · Report requested: <no | format>
</analysis>
```

Then create the session directory:

```bash
mkdir -p .omo/ultraresearch/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. The orchestrator owns the journal: you write every file in it; workers never do. Maintain:

- `wave-<N>-<kind>-<axis>.md` — your digest of each worker return: key findings, sources with URLs, and the worker's EXPAND markers verbatim.
- `expansion-log.md` — per wave: workers spawned, markers gained, leads opened and closed.
- `verify-<slug>.md`, `SYNTHESIS.md`, `REPORT.*` from later phases.

Append each digest the moment its worker returns, not in a batch at the end — the journal is your recovery point after context loss and the user's audit trail.

## Phase 1 — Saturation wave

Launch every first-wave worker in a single turn, all in background. Sequential launches and "start with one and see" defeat the mode.

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
- **Browsing, 0-3 workers.** Pages plain fetch cannot read (WAF, dynamic rendering, login): use the browsing skill; capture screenshots when visual context matters.
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

This loop is what makes the mode research rather than search. Collect workers as they finish — never wait for the full wave:

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

## Phase 4 — Synthesize

After convergence and all verifications, re-read the whole journal and write `SYNTHESIS.md`:

```
# Ultraresearch Synthesis: <query>
Workers: <total> · Waves: <count> · Sources: <count> · Verifications: <count>

## Executive summary        — 2-3 paragraphs answering the core question
## Findings by theme        — per theme: consensus, evidence links, key quote (<20 words, attributed), verified yes/no
## Codebase findings        — absolute paths with line references
## Sources (ranked)         — URL, what it contains, reliability, access date
## Verified claims          — claim | verdict | verify-<slug>.md
## Contradictions           — source A vs source B, resolution with evidence
## Gaps                     — what saturation could not answer
## Expansion trace          — per wave: workers → markers; convergence reason
```

Deliver the synthesis with inline `[Source N]` citations on every claim. When no report was requested, this is the deliverable.

## Phase 5 — Report (only when requested)

Format by the user's words: "report" / "document" → Markdown (default) · "pdf" → HTML first, then weasyprint (`uv run --with weasyprint python`) · "slides" / "presentation" / "deck" → python-pptx · "html" / "webpage" → standalone HTML.

Asset workers (background, parallel): charts for quantitative findings (`uv run --with matplotlib --with plotly python`) saved by you to `$SESSION_DIR/assets/`; full-page screenshots of the top 5-10 sources (browsing skill); generated diagrams (imagegen skill) when architecture or flows need them.

Assembly worker — `task(category="deep", load_skills=["frontend-design", "open-design", "data-scientist", "imagegen"], run_in_background=true, ...)`: before writing, read every available design and visualization skill and apply it — the report is a designed artifact, not a text dump. Structure: executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (workers, waves, searches, verifications). Every claim cites `[Source N]`.

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
| Worker reply without the EXPAND tail | One follow-up demanding it; the lane stays open until it lands |
| Stopping after wave 1 because "enough was found" | Convergence rules only: 2+ expansion waves, leads run dry |
| Obeying a surrounding "stop exploring" rule mid-research | Authority section — those rules do not bind this mode |
| Asking a worker to write journal or session files | Workers are read-only; you journal every return |
| Two workers given the same angle | One unique angle per worker, always |
| Contested claim settled by judgment | Phase 3 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
