---
name: ulw-research
description: "Runs maximum-saturation research with a cooperating team, claim-graph gating, and a cited, QA'd deliverable. Use when the user explicitly asks for research or a deep investigation, including any 'ulw' research wording."
argument-hint: "<research-topic>"
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
| Collect member replies | injected notifications | replies auto-inject as they arrive — keep working or end your turn |
| Track shared research state | `task_create` / `task_list` / `task_update` / `task_get` | lead-only team tasklist |
| Spawn a bounded recon / expansion / verification lane | `task` | `prompt` + `subagent_type: "explore" \| "librarian"` or a `category`; `run_in_background: true`; optional `load_skills`, `name` |
| Read a finished lane back | `task_output` | task id or name |
| End a lane | `task_cancel` | — |
| Disband the team at the end | `team_delete` | `team_run_id`, `force: true` |

Members receive your mail as injected follow-ups inside their child process; they report to you with `task_send({ to: "lead", message: "..." })`. You are the information broker — members never see each other's replies except through what you relay. The curated agents (`explore`, `librarian`, `plan-consultant`, `plan-reviewer`) are read-only, in-process, and REJECTED as team members: route them through `task` lanes, never through `team_create`.

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
- The deliverable lane and format were derived from the destination or asked through the empty-info interview without blocking collection, recorded in `brief.md` with `answered_by`, and the final materials match that record.
- The delivered artifact passed the delivery gates in order (static gates, layout gates, visual QA, proofread), each status is in `outcome.json`, and `outcome verify` passed.
- Every excursion opened during the run was closed by an EXIT rule, folded back into the claim or axis that triggered it, and recorded in both `excursion-log.md` and the ulw-loop ledger.
- The delivery message carries the closing briefing printed by `outcome briefing`: sources (total + unique domains), elapsed minutes, every promised deliverable with its status, and any residual defects.
- The session journal reconstructs what was searched, found, expanded, and debated, wave by wave, and it was written in real time rather than reconstructed at the end.
- The team was disbanded (`team_delete`) and every lane reached terminal status before the final answer.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts — members and lanes NEVER write session files:

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), and final synthesis location. High-risk non-code nodes that clear the Phase 4b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.
- `excursion-log.md` — one ENTER row and one EXIT row per excursion. Required fields: `excursion_id`, parent claim or axis, ENTER trigger, depth, workers spent, EXIT rule that closed it, what it changed in the top-level answer (`none` is a valid, required answer), and the ulw-loop steer/evidence id it was mirrored into.
- `debate-log.md` — one row per debate round: the claim under attack, the attacker's argument, the defender's evidence, your verdict, and what changed in the claim graph because of it.

Observation candidates, claim candidates, and EXPAND leads travel back from members and lanes as message text. You write the instrumentation artifacts, link candidates into the intent diff and claim graph, and record where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Phase 0 — Scope solo, organize the brief

Before spawning anything, decompose the query YOURSELF with your own direct tools: a handful of fast searches, a skim of the obvious codebase or doc territory, one eval cell batching the independent lookups. This is a scoping pass, not research — minutes, not waves. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?"

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no> · X/social signal: <yes/no>
Scale: <axis count, source territories, target document length> · Precision demand: <what a wrong claim costs here> → lifecycle: <single team | research team then refinement-debate team>
Debate need: <which claims will be contested, and which member perspectives attack them>
</analysis>
```

Then create the session directory and write the brief:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. Write `brief.md` into it: the analysis block, the axis list with one named owner per axis, the expected truths seeding `intent-diff.md`, and the team roster you are about to create. The brief is what the team is built FROM — a team stood up before the brief exists is a failure mode (see the table at the end).

### Run it as a loop, and journal in real time

ulw-loop is ON by default for this mode: register the research axes as loop goals from a JS eval cell (import the SDK once, const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`), then `agentToolkit.createGoals({ brief })`, then `create_goal` from the returned handoff) so the run has durable state and survives a compaction. The session directory's timestamp is the run's start clock — the closing briefing is computed from it, so create it once and never rename it. From that point every finding, source, quote, number, and lead is written into `$SESSION_DIR` **the instant it lands** — never held in the conversation for an end-of-run dump. After any context loss, re-read the brief, the journal, and `agentToolkit.status()` (re-import the SDK if the kernel restarted) before doing anything else, then resume from the open wave.

### Deliverable lane, format, and the empty-info interview

Never block collection on the shape of the deliverable, and never guess it either. Read [references/deliverable-phase.md](references/deliverable-phase.md) sections 1-6 before writing the brief, then:

1. **Derive first.** Name the lane (`template-strict`, `template-vibe`, `no-format`, `edit-existing`) and the promised formats from the request and its destination (the reference's section 3). When the request refers to an existing deliverable, decide its state with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome state --deliverable <path> --session-dir "$SESSION_DIR"`: `partial` resumes the skeleton on disk, `complete` means edit-existing and never a regenerated report. `$SKILL_DIR` is this skill's own directory, the folder containing this SKILL.md.
2. **Read the requester's format memory** when the memory tool exists: `read` the projected pointer `system/human/report-style.md`, then `reference/human-report-style.md`, and take the choice recorded for the most similar context (same destination kind and audience) as the first option.
3. **Ask only what is still missing**: at most the reference's three questions (destination and format, audience and length, template lineage) in one `ask_user_question` call with `waitForAnswer: false`, each with its default first, a free-text "describe the format" path, and "don't care, you decide". Collection starts without waiting; a late answer is folded in until the assembly lane starts, and after that it becomes a re-render request.
4. **Record it.** Write `## Deliverable` into `brief.md` (lane, state, formats, destination, audience, template, format description, each with `answered_by: user|default|request`) and open the manifest in the same step: `node "$SKILL_DIR/scripts/report-tools.mjs" outcome init --promised <formats> --lane <lane> --session-dir "$SESSION_DIR"`.

Phase 6 opens by turning the recorded fields into `design-spec.md`.

## Phase 1 — Stand up the team (DEFAULT composition)

**When the user asked for MASS research, the team is not the collection surface.** "mass ulw research", "mulw research", "ulw mass research" — in any language — order over-collection that 8 member slots cannot produce. Read `mass-ulw`'s `references/planning.md` and run collection as chained dags at its mass scale: a 60+ node opening wave covering every angle the topic has, routed across `quick` / `unspecified-low` / `unspecified-high` / `deep-low` in one graph, each wave's EXPAND leads defining the next wave's nodes until convergence, and a synthesis that reduces through several parallel `architect` nodes into one `architect` reducer (`ultrabrain` substitutes when the config has no `architect` category). Everything else in this skill still binds: the deliverable interview, the journal, the claim graph, the convergence rules, and the delivery gates. Keep a small team alongside the graph for the debate rounds of Phase 3 — attack is conversation, and dag nodes do not talk.

Otherwise a team is the DEFAULT for ulw-research, not an option: a lead one member surfaces almost always reshapes what another should search next, and debate needs live cooperating members, not fire-and-forget workers. Create it immediately after the brief:

```
team_create({
  inline_spec: {
    name: "ulw-research-<slug>",
    members: [
      { name: "<axis-owner-1>", category: "deep-low", prompt: "<member brief for axis 1 — see below>" },
      { name: "<axis-owner-2>", category: "deep-low", prompt: "<member brief for axis 2>" },
      ...
      { name: "skeptic", category: "ultrabrain", prompt: "<debate brief — see below>" },
    ],
  },
})
```

- **One member per axis — by part, ownership, or perspective, never a job title.** Each Phase 0 axis is one member owning one concrete slice: a codebase part, a source territory, or a question lens. No two members share an angle. "Backend researcher" or "the web person" gives no real boundary and invites overlap — name what the member owns.
- **Always the maximum roster.** The team is not sized by taste: fill every member slot the runtime allows (8) on every run. If you can only name five axes, split the broadest one — by source territory, by time window, by perspective — until the roster is full. A half-empty team is a half-covered topic.
- **Compose deliberately across the whole category surface.** Before writing the roster, enumerate what this session actually has: every category your `omo.json` defines (`quick`, `unspecified-low`, `unspecified-high`, `deep`, `ultrabrain`, `architect`, `writing`, `artistry`, ...) and every non-curated `subagent_type`. Give each slot the cheapest tier that can do ITS job — broad recon on the fast tiers, contested analysis on `deep`/`unspecified-high`, attack lanes on `ultrabrain`, language work on `writing`. Mixed tiers by design, never one tier across the whole board. A category member must also carry its brief as `prompt` (the runtime requires both), and a `subagent_type` member must name a non-curated agent — a member with neither is rejected at parse. NEVER name a curated agent (`explore`, `librarian`, `plan-consultant`, `plan-reviewer`) as a member — the runtime rejects them; they run as `task` lanes instead.
- **Routing words from the user are literal.** "quick", "fast", "deep", "모두 quick으로", "최대 병렬" are hard instructions, not mood. Route exactly as asked and journal `requested tier -> spawned category -> fallback reason` for every slot. Silently promoting a "quick" roster to a heavier tier is a defect, and so is dropping to a cheaper one without saying why.
- **Debate members are mandatory for ultradebate/hyperdebate, default otherwise.** At least one skeptic/red-team member (`ultrabrain` or your strongest reasoning category) whose ONLY job is attack: cross-critique claims, evidence quality, source independence, synthesis structure, and report choices before they reach the deliverable. When the user says ultradebate or hyperdebate, run at least two attacking perspectives (e.g. a skeptic attacking evidence and a contrarian attacking framing) and give every contested claim a full round.
- **The raise law — broadcast every lead the instant it surfaces.** Member briefs order relentless over-communication: every new lead, finding, contradiction, and dead end goes to `task_send({ to: "lead" })` the moment it surfaces, never hoarded for a final dump. Through long passes members send `WORKING: <axis> - <phase>`, and `BLOCKED: <reason>` the moment progress stops. Too many small updates is correct here; going quiet is the only failure. They arrive as injected notifications — act on each lead the moment it lands (Phase 3), never holding out for a member's final reply.
- **Track shared state in the open.** Register the axes and major leads on the team tasklist (`task_create`) and keep them current (`task_update`) so a member reconnecting after a crash can see the whole board.

### Team lifecycle — one team, or a sequence, decided by scale and precision

One team is the floor, not the ceiling. Decide from the brief at Phase 0, and re-decide when the topic grows:

| Signal | Lifecycle |
|---|---|
| One deliverable, one domain, ordinary stakes | ONE team: research, debate, and synthesis in place. |
| 6+ axes, several source territories, or a long final document | Research team first. Once its axes converge, `team_delete` it and stand up a REFINEMENT team of your strongest categories (`ultrabrain`, `architect`, `deep`) whose only job is to attack and sharpen the synthesis before a word of the document is written. |
| A wrong claim is expensive (legal, medical, financial, procurement, public-facing) or the user asked for ultradebate/hyperdebate on the CONCLUSIONS | The same split, plus a dedicated writing pass: the refinement team hands a locked claim set to the assembly lane, and nothing enters the document that the refinement round did not survive. |

Sequencing beats stuffing — a fresh premium team reading a finished journal reasons better than the same researchers grading their own homework. Build each team from a written brief, run its round, and disband it before the next one starts; never leave two research teams live at once.

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

| Query scope | explore lanes | librarian lanes | browsing lanes | repo-dive lanes | X lanes | team members | floor |
|---|---|---|---|---|---|---|---|
| Single topic, codebase only | 1 | 0 | 0 | 0 | 0 or 1 | 8 | 9 (+1) |
| Single topic, web only | 0 | 2 | 1 | 1 | 0 or 1 | 8 | 12 (+1) |
| Single topic, both | 1 | 2 | 1 | 1 | 0 or 1 | 8 | 13 (+1) |
| Multi-faceted | 2 | 4 | 2 | 1 | 0 or 1 | 8 | 17 (+1) |
| Full due diligence | 2 | 4 | 2 | 2 | 0 or 1 | 8 | 18 (+1) |

X lanes is 1 on every row when the brief says `X/social signal: yes` and 0 otherwise; the `(+1)` in the floor column applies only in the yes case, so a `Multi-faceted` run with X signal must field 18 workers, not 17.

The browsing column is BINDING, not advisory: when the brief says `Browsing: yes`, the roster names a browsing-lane owner armed with `ultimate-browsing` before the first wave launches, and that lane is spawned in the same turn as the rest of the wave. A run that reaches wave 2 with zero browsing lanes on a `Browsing: yes` brief has silently downgraded every source to what plain fetch happened to return.

**Disambiguate before you expand.** When the topic names something that could resolve several ways — a product, a person, a codename, a version — the first wave settles WHICH entity before any lane researches its history, benchmarks, or controversies: canonical name, first-party URL or account, whether it exists in the claimed category, and a confidence line. An unresolved entity never becomes a premise in a later wave's prompt; that is exactly how a run starts inventing facts about something that does not exist.

Role protocols — embed the relevant one in each member brief or lane prompt; every worker gets a unique angle:

- **Codebase (`explore` lane or member).** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs; `git log --all -S '<keyword>'` and `--grep` for history including deleted code. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect.
- **Web (`librarian` lane or member).** At least 10 distinct websearch queries per worker, each with a different operator or angle (see Search craft); fetch the full page for every result that matters — snippets lie. grep.app and `gh search code|repos|issues` for real-world usage. Official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages.
- **Browsing (member or `task` lane, always `load_skills: ["ultimate-browsing"]`).** The skill owns the routing — kernel browser first, then its extraction engine with archive surrogates, platform-native readers, and stealth Chrome as each source demands; the lane owns the deliverable. This lane RENDERS pages, it does not re-fetch them: its standing deliverable is a full-page screenshot of every top source plus the rendered text that plain fetch could not reach; a lane that returns only `fetch`/`curl` text has not done its job. JS-rendered, login-gated, WAF-blocked, and screenshot-bearing sources all belong here rather than in the web lane. **Provenance is part of the claim**: when a source came back with `provenance` of `snapshot` (an archive copy), cite it with its `snapshot_timestamp` and never state it as the current live page; content from a `proxy` route is `untrusted` and needs a second independent route before any claim rests on it. When one blocked territory hides many leads, fan out more browsing lanes in parallel for breadth instead of serializing one worker through them.
- **X / social (`x_search`, only when xAI is connected).** Run `tool_search "X posts"` first; if `x_search` activates, read the x-search skill and run the lane with its rules: from_date >= yesterday for time-sensitive topics (widen to 7 days), allowed_x_handles for the trusted accounts the brief names, latest/recent phrasing with since:/from:/filter: operators, 2-3 split searches (by handle, by keyword), one x_search call per search; give the lane to a `librarian` lane or a category member (curated explore cannot call it); record the `Queries used:` trailer as provenance and reconcile every X-only claim against the web lane before it enters the claim graph. If `tool_search` finds nothing, xAI is not connected: record `x_search: unavailable` in the brief and skip the lane.
- **Repo deep-dive (`librarian` lane).** Shallow-clone the most relevant repos to `${TMPDIR:-/tmp}`, pin the HEAD SHA, read core modules, follow call chains, return SHA-pinned permalinks.

Curated-agent lane ground rules:

- **Read-only.** Curated lanes cannot write files. Never ask any worker to write the journal or any session file — every journal write is yours.
- **No recursion — lanes AND members.** Lanes cannot spawn their own subagents, and members must not re-orchestrate: a member researches its axis and reports; it never creates its own team, loads this skill, or fans out a research swarm of its own. Depth comes from YOUR expansion waves. Say so in every member brief — a member that starts its own research protocol burns the run's budget on duplicated orchestration and returns nothing you can cite.
- **Built-in brakes.** Workers ship with their own retrieval budgets ("stop when answered"). Your spawn prompt must explicitly lift the budget and demand the EXPAND tail, or the worker returns a thin single-pass answer with no leads.

## Phase 3 — Expand and debate until convergence

This loop is what makes the mode research rather than search. Collect returns as they land via injected notifications — peek a running lane with `task_output({ mode: "tail" })` when you need its transcript mid-run — and act on each raised lead the moment it arrives:

1. Journal the return the moment it lands, never at the end of the wave: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`, and append each new source, quote, and number to `sources-ledger.md` and `observation-manifest.md` in the same beat. Real-time journaling is what makes the run survivable — after a compaction the journal, not your memory, is the state.
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
### Excursions — dive deep on a new find, then surface back out

The Phase 0 core question is the fixed goal of the run and never drifts. An excursion is a BOUNDED detour off the wave plan to chase something a return surfaced — you go deep, settle it, and come back up to the question you were hired to answer.

**ENTER (dive) only on a trigger.** One of these must hold, and you name which one:

1. The find contradicts a claim already locked in `claim-graph.md`.
2. It would change the final answer or a recommendation if it turned out to be true.
3. It exposes a source territory no axis owns, so nobody else will ever reach it.
4. The user's steering points at it — their words are the trigger, quoted verbatim.

Interest alone is not a trigger. Anything without one stays a queued lead in `expansion-log.md`, and the wave plan continues.

**Budget the dive before you take it.** State the lane or member count and the probe count for this level in the ENTER row. An excursion may spawn at most ONE nested sub-excursion; a third level means the thing has become its own research question — surface immediately and either promote it to a real axis with its own member (`agentToolkit.steer({ kind: "add_subgoal", source: "finding", title: "<axis>", objective: "<what it must answer>", evidence: "<what surfaced it>", rationale: "<why the plan changes>" })`) or record it as an out-of-scope gap in `SYNTHESIS.md`.

**EXIT (surface) the moment any of these holds** — you do not need all of them:

- The ENTER trigger is resolved: the claim is confirmed, refuted, or its dependency is closed.
- Two consecutive probes changed nothing in the parent answer.
- The finding stops moving any claim's status — diminishing return is an exit, not a reason to push harder.
- The level's stated budget is spent.

**Fold back on the way out.** Every EXIT writes one line saying what the excursion changed in the top-level answer, and `none — <reason>` is a legitimate, required outcome; an excursion whose result is silently dropped is a lost run. Update the parent claim node or axis digest with the result, then mirror the whole excursion into the loop ledger: `agentToolkit.steer({ kind: "annotate_ledger", source: "finding", evidence: "<what the excursion observed>", rationale: "<what it changed, or none>" })`, and when it settled a success criterion, `agentToolkit.recordEvidence({ goalId, criterionId, status: "pass", evidence: "<artifact>" })`. Use status `"fail"` or `"blocked"` instead when the evidence supports that outcome. After a compaction, `agentToolkit.status()` plus `excursion-log.md` tell you which excursions are still open.

**Anti-drift.** After every EXIT, re-read the core question in `brief.md` and confirm the run still answers it. Three consecutive excursions that changed nothing end excursions for the run: converge on what you have.

6. **Relay the user's steering to everyone.** When the user changes scope, cadence, target sources, language, or format mid-run, broadcast it to every live member and lane immediately (`task_send` per member, a follow-up per lane) and record the exact wording in `expansion-log.md`. Steering only you saw silently splits the team's assignment from the user's actual ask.

**Convergence — the only stop rules while this mode is active.** Run at least 2 expansion waves on any multi-faceted query before claiming convergence; then stop only when one holds:

- Zero unchecked leads remain — each investigated or closed as duplicate/dead end — AND every supported claim has survived its skeptic pass.
- 3 consecutive waves produced no new actionable leads.
- Expansion depth reached 5 waves — pause, show the open leads, and ask the user whether to extend.

**Never end the run on a worker's completion.** Lanes finishing is not the deliverable; your synthesis is. Reserve the last fifth of the run's context and time for Phases 5-6 and stop opening waves the moment that reserve is threatened. A converged answer with two open leads beats nine finished workers and no report.

## Phase 4 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Run the verification yourself in one eval cell, or spawn one verification lane per claim:

```
task(category: "deep-low", run_in_background: true, prompt: "TASK: verify by execution: <claim>.
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
Members + lanes: <total> · Waves: <count> · Excursions: <count> · Sources: <count> (<unique domains> domains) · Verifications: <count> · Debate rounds: <count> · Elapsed: <minutes> min

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

**Write the skeleton early and fill it as claims lock.** The moment the brief records the deliverable, create the deliverable file with its section headings and a `STATUS: draft — <n> sections open` line as line 2 (an HTML comment in HTML); that line is the partial-state marker `outcome state` reads, removed only when the deliverable is complete. An interrupted run must leave a partial report on disk, never an empty directory and a lost conversation.

**Keep sourced numbers, assumptions, and derived results visibly apart.** Every quantitative claim carries its lineage: `MEASURED` (a number a source states, cited), `ASSUMED` (a coefficient, distribution, or scope you chose — say why), `DERIVED` (computed from those, showing the formula), plus a sensitivity line whenever the assumption moves the answer. Presenting a derived estimate with the confidence of a measured one is the most damaging thing this mode can ship.

**Search in English, deliver in the user's language.** Retrieval stays English-first (Search craft), but the synthesis and every final material are written in the language the user wrote to you in unless they ask otherwise — and a translated report still quotes its original-language sources verbatim.

## Phase 6 — Final materials, then teardown

The promised formats recorded in `brief.md` and `outcome.json` are binding; `pdf` + `docx` is the default pair only when a document was asked for with no format word and no destination:

| Target | How |
|---|---|
| PDF (default) | Author the report as one self-contained HTML file, then print it headless: `chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=<out.pdf> file://<report.html>`. Embed the `design-spec.md` fonts as real webfonts (CJK included) instead of trusting system fallbacks. `uv run --with weasyprint python` is the fallback renderer. |
| DOCX (default) | `pandoc <report.md> -o <out.docx>`, adding `--reference-doc=<template.docx>` when the user has a house style; `uv run --with python-docx python` when pandoc is unavailable. Charts and Mermaid renders go in as images. |
| LaTeX (.tex + PDF) | Read [references/latex-report.md](references/latex-report.md) first and follow it end to end: scaffold from its preamble, write per-section `.tex`, compile with the detected engine (XeLaTeX when the report language needs CJK), iterate to a clean multi-pass log, then render page PNGs for the visual-QA gate. |
| Slides / deck | `uv run --with python-pptx python` — one claim per slide, a chart or diagram per claim. |
| Standalone HTML / Markdown | The authored source itself. |

**Write `design-spec.md` the moment the deliverable is recorded — before any asset lane spawns.** When a document was pointed at, extract it instead of retyping its stylesheet: `node "$SKILL_DIR/scripts/report-tools.mjs" format-extract <reference> --out "$SESSION_DIR/design-spec.md"` (`--from-url` for a URL), then fill every `TODO: ask` from the interview answers, never by guessing. It is the one design contract every asset and assembly lane receives: template family (absent a reference, the clean analyst-report register — one accent over neutral tones, generous margins, styled section headings, no emoji, no clipart), palette tokens, body/heading fonts (a real gothic CJK webfont — Pretendard, Noto Sans KR — when the report language needs one, with `word-break: keep-all` for Korean), responsive breakpoints and HTML/CSS charts for web deliverables, the figure standard below, and the lineage mode on its own line: `Lineage: inline` (analyst default: every unit-bearing number tagged MEASURED / ASSUMED / DERIVED or cited in the same element) or `Lineage: section` (web and blog register: every section cited, lineage in the figure captions). The reference's section 6 lists the full defaults. One font family and one palette govern prose, charts, Mermaid, and generated images alike; a diagram rendering in a random default font inside a styled report is a defect, not a style choice.

**The figure standard — binding for every image, chart, and diagram.** Each figure sits in a fixed-size container styled from the spec (border, background, caption); the image scales to fit entirely inside it with its original aspect ratio preserved — object-fit: contain semantics — never stretched, never cropped, never spilling out. Every chart carries a title, axis labels, units, and value labels in the report's language; a bare number the reader cannot name is a defect.

Asset lanes (background, parallel `task` spawns, each fed `design-spec.md`) — visuals are the DEFAULT deliverable of this phase, not garnish the user must ask for; a delivered report without figures is an incomplete run:

- **Charts for every quantitative finding, computed from real data.** Pull the numbers into an actual table first (CSV/JSON under `$SESSION_DIR`), then plot from that table, never from prose. Follow the data-scientist tool doctrine — numpy always, Polars for filtering/sorting/transforms, DuckDB for joins/aggregations/window functions, never pandas — and load the `data-scientist` skill when this session has it: `uv run --with numpy --with polars --with duckdb --with pyarrow --with matplotlib python`. Keep `pyarrow` in that set — the DuckDB-to-Polars handoff (`.pl()`) fails without it, and `.df()` fails without pandas, so hand data across through `.pl()`, never `.df()`. Save to `$SESSION_DIR/assets/`.
- **Mermaid graphs** for process, architecture, argument, timeline, and evidence-flow structure, themed to the spec's fonts and palette. Render each to SVG and confirm the file exists before the document references it.
- **Generated visuals whenever this session has an image-generation skill:** a cover plus a concept illustration per major theme, prompted from the spec's style, palette, and mood — document-styled illustration, never generic stock art dropped into a designed page.
- **Full-page screenshots** of the top 5-10 sources (browsing lane) as provenance you can show.

**Verify the asset manifest before rendering.** List every asset the document references, assert each file exists and is non-empty on disk, and re-render whatever is missing. A document that renders with three broken diagrams is a document you will publish twice.

Assembly lane — `task(category: "deep-low", load_skills: ["frontend", "visual-qa"], run_in_background: true, ...)`: the report is a designed artifact, not a text dump; its prompt carries `design-spec.md`. Use the template the user approved; absent a stronger house style the default skeleton is executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (members, lanes, waves, searches, verifications, debate rounds) → correction log naming what verification overturned. Write it long and specific: every claim cites `[Source N]`, and the sources section lists every source the run actually used rather than a curated few.

### The delivery gates — every gate for the QA tier must PASS, in order

Nothing reaches the user until the gates pass. Record each result with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome gate <static|layout|visual|proofread> <pass|fail|not_run> --session-dir "$SESSION_DIR"`. A chat or post answer (light tier) runs gate 1 and one render; every paginated or web deliverable runs all four (the reference's sections 3 and 7).

1. **Static gates (always, before anyone looks at pixels).** `node "$SKILL_DIR/scripts/report-tools.mjs" check "$SESSION_DIR/report.html" --design-spec "$SESSION_DIR/design-spec.md" > "$SESSION_DIR/defects.json"`: keep-all, palette tokens, emoji, em dashes, heading length, unsourced numbers, figure containers, chart text, gothic-only fonts, citations, the closing and sources sections, broken assets. Codes and fixes: [references/report-gates.md](references/report-gates.md).
2. **Layout gates.** Print the probe with `node "$SKILL_DIR/scripts/report-tools.mjs" layout-probe --json`, evaluate its `source` in the rendered page through the `browser` skill's owned headless engine, save the result as `$SESSION_DIR/boxes.json`, and re-run `check` with `--layout "$SESSION_DIR/boxes.json"` (overflow, clipped text, distorted images, overlapping siblings).
3. **Visual QA.** Render the produced artifact back to images — PDF pages to PNG, the HTML through the browser skill at desktop and phone widths — and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Reading the source markup is not visual QA; inspect the pixels.
4. **Proofread gate — `task(category: "writing", ...)`.** Hand the final text to a dedicated `writing` lane whose only job is language: grammar, spelling, punctuation, terminology consistency, and whether the prose reads NATIVELY in the report's own language (for Korean, natural Korean written by a Korean, not translationese). It proofreads only and never composes. It returns a defect list; fix every item and re-run the gate on the delta. Deliver only on a clean pass — this gate runs BEFORE the first delivery, not after the user finds the typo.

**Repair is bounded.** After every gate run that found defects, ask `node "$SKILL_DIR/scripts/report-tools.mjs" repair decide --state "$SESSION_DIR/repair-state.json" --defects "$SESSION_DIR/defects.json" --artifact-bytes <bytes> --renders <pages> --session-dir "$SESSION_DIR"` and obey it: `repair` means fix and re-run; `deliver` means stop and ship with the residual defects the manifest now lists; `block` means a content-integrity defect remains (or there is no usable artifact), so do not deliver: tell the user what blocks it and record the row as `failed` with the reason. Never repair past a stop decision (3 attempts, a 2-attempt plateau, an oscillation, or 15 minutes; the reference's section 8).

Then resolve every manifest row (`outcome set <format> delivered --path <file>` or `blocked_capability` / `skipped` / `failed` with `--reason`) and deliver: the artifact plus a compact chat-readable summary of what it says — the answer in a few sentences, the numbers that matter, and what to look at first. The document is the deliverable; the summary is what gets it read.

### The closing briefing — every run ends with it

The last thing the user reads states, in one compact block, what the answer is made of:

- **The printed block.** `node "$SKILL_DIR/scripts/report-tools.mjs" outcome verify --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome finish --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome briefing --session-dir "$SESSION_DIR"`: sources and distinct domains counted from `sources-ledger.md`, elapsed minutes from the session directory's own timestamp, every promised deliverable with its status, the gate results, the residual defects, and the repair summary. A failing `verify` means the run is not done.
- **Effort.** Members, lanes, waves, excursions, verifications, and debate rounds — the same counters as the `SYNTHESIS.md` header — plus how many sources were primary and how many claims went to the unresolved/refuted annex.

Never ship the artifact without this block, and never fill it from memory — paste the printed block and read the rest off the journal.

**Record the format choice.** After delivery, when the memory tool exists and the run qualifies (the user declared a preference, or made the same unsolicited choice on 2+ runs), append one episode line to `reference/human-report-style.md` in the grammar of the reference's section 5, and update the `system/human/report-style.md` pointer when a generalization changed.

**Teardown is part of the deliverable.** Once the materials are delivered: `team_delete({ team_run_id, force: true })` for every team you stood up, confirm each lane is terminal (`/tasks`), and only then write the final answer. A live team left running past the final answer is a failed run, not a finished one.

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

- X search operators: `since:YYYY-MM-DD until:YYYY-MM-DD from:handle filter:links -filter:replies lang:ko`; always phrase time-sensitive queries as latest/recent.

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
| A `Browsing: yes` run whose roster carries no browsing lane, or a browsing lane spawned without `ultimate-browsing` | The browsing column is binding — name the lane's owner in the brief and spawn it, armed with the skill, in the first wave before any lead is chased |
| Contested claim settled by judgment | Phase 4 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
| Final answer while the team is still live | `team_delete` + terminal lanes first; teardown is part of done |
| Guessing the deliverable format | Derive it from the request and destination; ask the empty-info interview only for what is still missing, and record `answered_by` for every field |
| Blocking the collection wave on the format question | Ask with `waitForAnswer: false` and start collecting; unanswered fields run on the shown defaults |
| A roster smaller than the runtime maximum | Fill every slot; split the broadest axis until the team is full |
| One category across the whole roster | Mixed tiers by design — cheap breadth, premium attack, `writing` for language |
| Silently re-routing a "quick"/"fast" roster to another tier | Routing words are literal; journal requested -> spawned -> fallback for every slot |
| A member that starts its own research swarm or loads this skill | Members research one axis and report; orchestration is yours alone |
| Expanding on an entity the first wave never disambiguated | Settle canonical identity and first-party source before any later prompt asserts it |
| Batching findings into an end-of-run journal dump | Journal each return as it lands; ulw-loop state is what survives a compaction |
| Ending the run because every worker finished | Reserve the final fifth of the run for synthesis and materials |
| A derived estimate presented as a measured number | MEASURED / ASSUMED / DERIVED lineage on every quantitative claim, plus a sensitivity line |
| Delivering before visual QA or before the `writing` proofread gate | The gates are mandatory and ordered; a typo the user finds means the gate did not run |
| Skipping the static gates | `report-tools check` runs before any pixel review; its defects are cheaper than a visual pass |
| Delivering with a pending manifest row | `outcome verify` must pass; every promised format ends `delivered`, `blocked_capability`, `skipped`, or `failed` with a reason |
| Repairing past the tracker's stop decision | `repair decide` owns the budget; `deliver` ships with the residual list, `block` stops delivery |
| Guessing a design-spec value the extractor marked `TODO: ask` | Fill it from the interview answers or the reference's defaults, never by guessing |
| Referencing an asset that is not on disk | Verify the asset manifest before rendering; re-render whatever is missing |
| A figure stretched, cropped, or styled off the report's design language | `design-spec.md` binds every asset: fixed containers, contain-fit with aspect preserved, spec fonts and palette in charts and Mermaid |
| Chasing an interesting find with no ENTER trigger | Excursions need a named trigger; everything else stays a queued lead |
| An excursion that never came back, or drifted into a new mission | EXIT rules are unconditional; depth 3 means promote it to an axis or record it as a gap |
| An excursion whose result was never folded back | Every EXIT writes what it changed in the top-level answer, `none` included, and mirrors into the loop ledger |
| Delivering without the closing briefing | Paste the block `outcome briefing` prints; never compute or recall its numbers by hand |
