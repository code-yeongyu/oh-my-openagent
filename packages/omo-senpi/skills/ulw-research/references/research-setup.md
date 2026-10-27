## Phase 0 — Scope solo, organize the brief

Before spawning anything, decompose the query YOURSELF with your own direct tools: a handful of fast searches, a skim of the obvious codebase or doc territory, one eval cell batching the independent lookups. This is a scoping pass, not research — minutes, not waves. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?"

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Collection: <search-only | browser> · Verification likely: <yes/no> · X/social signal: <yes/no>
Scale: <axis count, source territories, target document length> · Precision demand: <what a wrong claim costs here> → lifecycle: <single team | research team then refinement-debate team>
Debate need: <which claims will be contested, and which member perspectives attack them>
</analysis>
```

`Collection` is `search-only` only when a result snippet settles every axis (a date, a version, a spec value); anything that needs reading a source is `browser`.

Then create the session directory and write the brief:

```bash
mkdir -p .omo/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. Write `brief.md` into it: the analysis block, the axis list with one named owner per axis, the expected truths seeding `intent-diff.md`, and the team roster you are about to create. The brief is what the team is built FROM — a team stood up before the brief exists is a failure mode (see the table at the end).

### Run it as a loop, and journal in real time

ulw-loop is ON by default for this mode: register the research axes as loop goals from a JS eval cell (import the SDK once, const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`), then `agentToolkit.createGoals({ brief })`, then `create_goal` from the returned handoff) so the run has durable state and survives a compaction. The run's start clock is `outcome.json` `startedAt`, which `outcome init` records once: from `--started-at <ISO>` when you pass it, else from this directory's timestamp name — the closing briefing is computed from it, so create the directory once and never rename it. From that point every finding, source, quote, number, and lead is written into `$SESSION_DIR` **the instant it lands** — never held in the conversation for an end-of-run dump. After any context loss, re-read the brief, the journal, and `agentToolkit.status()` (re-import the SDK if the kernel restarted) before doing anything else, then resume from the open wave.

### Deliverable lane, format, and the empty-info interview

Never block collection on the shape of the deliverable, and never guess it either. Read [references/deliverable-phase.md](deliverable-phase.md) sections 1-6 before writing the brief, then:

1. **Derive first.** Name the lane (`template-strict`, `template-vibe`, `no-format`, `edit-existing`) and the promised formats from the request and its destination (the reference's section 3). When the request refers to an existing deliverable, decide its state with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome state --deliverable <path> --session-dir "$SESSION_DIR"`: `partial` resumes the skeleton on disk, `complete` means edit-existing and never a regenerated report. `$SKILL_DIR` is this skill's own directory, the folder containing this SKILL.md.
2. **Read the requester's format memory** when the memory tool exists: `read` the projected pointer `system/human/report-style.md`, then `reference/human-report-style.md`, and take the choice recorded for the most similar context (same destination kind and audience) as the first option.
3. **Ask only what is still missing**: at most the reference's three questions (destination and format, audience and length, template lineage) in one `ask_user_question` call with `waitForAnswer: false`, each with its default first, a free-text "describe the format" path, and "don't care, you decide". Collection starts without waiting; a late answer is folded in until the assembly lane starts, and after that it becomes a re-render request.
4. **Settle source fidelity in the same step.** Seven fields under `## Fidelity` in `brief.md` say what the report must stay faithful to; the reference's section 4 lists each field's values and default. Infer every field before asking anything; an explicit word in the request decides a field (`answered_by: request`), the destination, the sources, and the Phase 0 axes supply the rest (`answered_by: default`):
   - `as of`: a version, release, tag, commit, date, quarter, "as of", "current", or "latest" in the request decides it; a pointed-at repository anchors on its HEAD or tag at run start, pointed-at documents on their own revisions, and a comparison of two anchors records `multiple: <a>, <b>; rows tagged`. Default `latest at run start, <run date>`, the date of the `$SESSION_DIR` timestamp. Ask when the topic is version-bound or time-sensitive (software, APIs, standards, prices, rates, rankings, laws, programs, schedules) and nothing names an anchor; a stable topic takes the default silently.
   - `meaning check`: the QA tier decides (full: `on`, light: `off`); a chat answer on a legal, medical, financial, procurement, or public-facing question with no speed word is `on`. Ask when two explicit signals disagree: a document deliverable under a literal "quick" or "fast", or a light-tier answer that carries both a speed word and a precision demand; `on` goes first.
   - `source floor`: "official docs only", "peer-reviewed only", "SEC filings" give `primary only` or `classes: <host suffixes>`; "from these only" gives `pointed only: <source ids, URLs, or paths>`; pointed-at sources with no restricting word are seeds, not a floor. Default `standard`. Ask when a restricting phrase sits beside an open-ended question whose answer lives outside that floor. Declare each source's provenance when you snapshot it (`source snapshot --provenance primary|secondary`, by the Phase 4b primary-source rule); `primary only` refuses every source not declared `primary`.
   - `derived numbers`: "compare", "growth", "share", "estimate" give `allowed`; "only the sources' own numbers", "no estimates" give `none`. Default `allowed`. Ask when both kinds of phrase share one request. Record only `allowed` or `none` (any other value stops `fact fill` and `fact verify` with a usage error); a partial or free-text answer records `none`.
   - `languages` (never asked): the report in the user's language or the one they named; sources `en`, plus the user's language for a local topic, plus the pointed-at documents' languages; quotes `original` when every source language equals the report language, else `original with translation beside`.
   - `identifier classes` (never asked): from the Phase 0 axes' domain (software: version strings, package names, commit ids; finance: tickers, filing ids, fiscal periods; law: statute, article, and case numbers; science: gene names, DOIs, trial ids), else `none`. It is recorded only; no gate enforces it yet.
   - `fallback` (never asked): `block-quote`, or `omit` on "drop anything you cannot verify"; no other value is accepted.

   Ask nothing when the request, the destination, and the sources decide every field. Otherwise ask only the fields whose trigger fired, in the same `ask_user_question` call as the format questions, with `waitForAnswer: false`, each with its default first, a free-text path, and "don't care, you decide" (it resolves to the first option, recorded `answered_by: user`). At most four questions ride in that call: `pending` fidelity fields first, then format Q1, Q2, Q3, then `as of`, `meaning check`, `source floor`, `derived numbers`; a question that loses its slot runs on its default and is named, with that default, in the reply that opens collection. When each reading of a field would make part of the request undeliverable, record it `pending` with no default. Collection starts regardless: `source snapshot`, `fact add`, `fact quote`, `fact derive`, `fact retract`, and `fact export` keep working while answers are pending; only the six reader-facing commands (`fact fill`, `fact verify`, `fact pairs`, `fact meaning-check`, `fact polish-apply`, `fact polish-diff`) and the assembly lane wait for the lock, and those commands exit 1 with `fidelity_interview_incomplete` while a field is `pending` or missing. When the assembly lane is about to start, a field still awaiting its answer keeps its default; a `pending` field is asked once more, blocking this time.
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

Phase 6 opens by turning the recorded fields into `design-spec.md`.

## Phase 1 — Stand up the team (DEFAULT composition)

**When the user asked for MASS research, the team is not the collection surface.** "mass ulw research", "mulw research", "ulw mass research" — in any language — order over-collection that 8 member slots cannot produce. Read `mass-ulw`'s `references/planning.md` and define collection in full before `start`, as its Mass research section lays out: 60+ angles, each a `harvest -> expand -> verify` chain, reduced through per-cluster slice reducers into one final reducer. Everything else in this skill still binds: the deliverable interview, the journal, the claim graph, the convergence rules, and the delivery gates. Keep a small team alongside the graph for the debate rounds of Phase 3 — attack is conversation, and dag nodes do not talk.

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
- **Routing words from the user are literal.** "quick", "fast", "deep", "all quick", "max parallel" are hard instructions, not mood. Route exactly as asked and journal `requested tier -> spawned category -> fallback reason` for every slot. Silently promoting a "quick" roster to a heavier tier is a defect, and so is dropping to a cheaper one without saying why.
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
4. The role protocol (Phase 2). A web member's brief names the `browser` skill's `SKILL.md` to read first (`team_create` members carry no `load_skills`); a web `task` lane loads it with `load_skills: ["browser"]`.
5. The raise law and the reply tail. EXPAND markers, observation candidates, and claim candidates travel back as message text to `to: "lead"`, never as files. Every substantial report ends with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
```

A member with nothing to expand sends `## EXPAND` followed by `none — <one-line reason>`. A report missing the tail is incomplete: send that member one follow-up demanding it.
