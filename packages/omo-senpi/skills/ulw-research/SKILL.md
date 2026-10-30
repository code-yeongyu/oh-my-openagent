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

**What a shortened run still owes.** If you judge the topic settled and shorten the research, say so, but two things survive any shortening: the final report is shown inline through `show_html_page` (the answer, its figures, its sources), and a visual reproduction is compared against real frames of its source with the side-by-side pairs inside that report (Phase 6). A built app or 3D scene shown inline is the product, not the report; show the report as well.

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
- The delivered artifact passed the delivery gates in order (static gates, layout gates, fidelity gate, visual QA, and the proofread pass where the harness provides one), each status is in `outcome.json`, and `outcome verify` passed.
- Every excursion opened during the run was closed by an EXIT rule, folded back into the claim or axis that triggered it, and recorded in both `excursion-log.md` and the ulw-loop ledger.
- When this session has `show_html_page`, the report was shown inline in the thread before the artifact paths.
- When the ask reproduces a visual source, the report carries side-by-side pairs of real source frames and the output rendered at the same moments, each with its critique, and the differences they surfaced were fixed or listed as gaps. A simple or well-understood topic shortens the research, never this comparison.
- The delivery message carries the closing briefing printed by `outcome briefing`: sources (total + unique domains), elapsed minutes, every promised deliverable with its status, and any residual defects.
- The session journal reconstructs what was searched, found, expanded, and debated, wave by wave, and it was written in real time rather than reconstructed at the end.
- The team was disbanded (`team_delete`) and every lane reached terminal status before the final answer.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts — members and lanes NEVER write session files (a mass-research dag node writes only its own `waves/<run-key>/<node-id>.md` handoff file, which carries its EXPAND tail and claim candidates; you journal from it):

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), `fact_ids` (the ledger rows the claim rests on), and final synthesis location. High-risk non-code nodes that clear the Phase 4b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `sources/` and `fact-ledger.json` — one directory per source snapshot and the ledger built from them. The snapshot and locator contract (raw bytes, converted-only sources, byte locators, `source refresh`) is defined once, in [fact-ledger.md](references/fact-ledger.md#snapshot-and-locator-contract); every number and quotation reaches the report through a ledger placeholder.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.
- `excursion-log.md` — one ENTER row and one EXIT row per excursion. Required fields: `excursion_id`, parent claim or axis, ENTER trigger, depth, workers spent, EXIT rule that closed it, what it changed in the top-level answer (`none` is a valid, required answer), and the ulw-loop steer/evidence id it was mirrored into.
- `debate-log.md` — one row per debate round: the claim under attack, the attacker's argument, the defender's evidence, your verdict, and what changed in the claim graph because of it.

Observation candidates, claim candidates, and EXPAND leads travel back from members and lanes as message text (except a mass-research dag node's handoff file). You write the instrumentation artifacts, link candidates into the intent diff and claim graph, and record where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Execution references

- **X / social (`x_search`, only when xAI is connected).** Run `tool_search "X posts"` first; if `x_search` activates, read the x-search skill and run the lane with its rules: from_date >= yesterday for time-sensitive topics (widen to 7 days), allowed_x_handles for the trusted accounts the brief names, latest/recent phrasing with since:/from:/filter: operators, 2-3 split searches (by handle, by keyword), one x_search call per search; give the lane to a `librarian` lane or a category member (curated explore cannot call it); record the `Queries used:` trailer as provenance and reconcile every X-only claim against the web lane before it enters the claim graph. If `tool_search` finds nothing, xAI is not connected: record `x_search: unavailable` in the brief and skip the lane.

Read [research-collection.md](references/research-collection.md) before scoping or collecting sources, then [research-delivery.md](references/research-delivery.md) before verification, synthesis, and delivery. These references continue this skill in phase order; their requirements remain binding.

`source snapshot --html` and `--url` probe their own conversion and print the numbers it altered (a footnote digit glued onto a value, a merged table cell); `fact add` then refuses those numbers with `conversion_altered_number`, so write a verified text of that source and replace the snapshot with `source snapshot --id S<n> --text <verified.txt> --replace` (refused while an active row cites the id: retract those rows first or use a new id), then add the fact from it. When you convert a document yourself, run `node "$SKILL_DIR/scripts/report-tools.mjs" source probe-conversion <raw-file> <converted-file>` and snapshot a verified `--text` instead before adding any number it lists as `altered`; `lost` is a warning only.
