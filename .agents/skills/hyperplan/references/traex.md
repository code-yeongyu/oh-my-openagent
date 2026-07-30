# TraeX Backend

Use this backend when the harness exposes `spawn_agent`, `send_input`,
`wait_agent`, and `close_agent`. This includes TraeX, `traecli`, and
`trae-agent`.

This file overrides OpenCode-specific orchestration instructions in the parent
`SKILL.md`. The adversarial roles, three debate rounds, distillation rules, and
mandatory planner handoff remain unchanged.

## Preconditions

1. Run only from the main agent thread.
2. Require room for the main thread plus five reviewer threads. In TraeX,
   configure at least:

   ```toml
   [features.multi_agent_v2]
   enabled = true
   max_concurrent_threads_per_session = 6
   ```

3. Do not set per-reviewer model overrides. Let each reviewer inherit the
   current model and harness.
4. Use five persistent reviewer threads. Do not spawn fresh agents for later
   rounds because the defense round depends on each reviewer's own prior
   claims.
5. Do not use worktree isolation for these read-only planning reviewers.

If the required tools or concurrency are unavailable, stop and identify the
missing capability. Do not silently reduce the roster or replace the debate
with a single-agent plan.

## Reviewer Roster

Spawn one `default` agent for each logical role:

| Reviewer | Role prompt in the parent skill |
| --- | --- |
| `skeptic` | Pragmatist Skeptic |
| `validator` | Integration Tester |
| `researcher` | Autonomous Researcher |
| `architect` | Architect Strategist |
| `creative` | Creative Challenger |

Spawn all five in one parallel wave. For each call:

- set `agent_type` to `default`;
- omit `model`;
- set `fork_context` to `false`;
- include the complete role prompt and Round 1 task in the initial message;
- state that the task is read-only and that the final response must contain
  only that round's findings.

Record the returned agent id under its reviewer name. Treat those ids as the
stable roster for all three rounds.

## Round 1: Independent Analysis

The initial spawn message must contain:

```text
<hyperplan-round-1-task>
You are the [ROLE NAME]. Follow this role contract for every round:

[FULL ROLE PROMPT FROM THE PARENT SKILL]

The user's planning request:
<user-request>
[VERBATIM USER REQUEST]
</user-request>

Round 1 - Independent Analysis:
Produce 3-7 numbered findings from your assigned perspective.
Each finding must be at most 3 sentences and specific.
Do not critique other reviewers and do not write a synthesized plan.
Return only the numbered findings to the lead.
</hyperplan-round-1-task>
```

Call `wait_agent` with the set of outstanding ids and use a long wait. Save
every terminal result, remove its id from the set, and repeat only while ids
remain. This is completion-driven waiting, not short-interval polling. A failed
reviewer may be resumed or replaced once with the same role and prompt. If it
fails again, stop and report the failed role.

## Round 2: Cross-Attack

Build the same Round 1 findings bundle defined in the parent skill. Send the
bundle to every existing reviewer with five parallel `send_input` calls:

```text
<hyperplan-round-2-task>
Here are all Round 1 findings, including yours for reference:

[ROUND 1 FINDINGS BUNDLE]

Round 2 - Cross-Attack:
Attack the OTHER four reviewers' findings from your assigned role.
Do not critique your own findings.

For each target use:
- [reviewer] Finding #N: [claim]
  ATTACK: [specific attack, at most 3 sentences]

When a finding survives your scrutiny, write:
STANDS - [specific reason]

Return only the cross-attacks to the lead.
</hyperplan-round-2-task>
```

Call `wait_agent` for the same five ids and apply the same failure rule as
Round 1.

## Round 3: Defense And Refinement

Group attacks by original finding. Send each reviewer only its own findings
and the attacks against them, using five parallel `send_input` calls:

```text
<hyperplan-round-3-task>
Your Round 1 findings were attacked:

[THIS REVIEWER'S FINDINGS AND THEIR INCOMING ATTACKS]

Round 3 - Defend, Refine, or Concede:
For every finding choose exactly one:
- DEFEND: rebut with concrete evidence or reasoning.
- REFINE: accept the valid attack and state a stronger finding.
- CONCEDE: acknowledge defeat and state what, if anything, survives.

Format:
[finding #N] DEFEND/REFINE/CONCEDE: [at most 3 sentences]

Return only the dispositions to the lead.
</hyperplan-round-3-task>
```

Call `wait_agent` for the same five ids. Distill the results exactly as defined
in Phase 5 of the parent skill.

## Planner Handoff

After distillation:

1. Close all five reviewer threads with parallel `close_agent` calls. This
   releases a concurrency slot for the planner.
2. Spawn one `plan` agent with `fork_context: false`. Pass the complete insight
   bundle and the handoff contract from Phase 6 of the parent skill.
3. Call `wait_agent` for the planner id and use its final response as the
   executable plan.
4. If the planner asks questions, forward them unchanged. Continue the same
   planner thread with `send_input` after the user answers; do not spawn a new
   planner.
5. Close the planner after its plan has been delivered.

Do not draft, outline, or pre-structure the executable plan before spawning the
`plan` agent.

## Cleanup

Maintain the set of live reviewer and planner ids throughout the run. On
success, cancellation, or error, call `close_agent` for every id that has not
already been closed. Report cleanup failures with the affected ids.

TraeX has no team registry to delete. Do not call OpenCode `team_shutdown_*` or
`team_delete` tools on this backend.

## TraeX Anti-Patterns

- Do not call `team_*`; those belong to the OpenCode Team Mode backend.
- Do not call `spawn_agent` again for Rounds 2 or 3.
- Do not use `send_input` before saving the prior round's final response.
- Do not poll completed agents repeatedly.
- Do not ask reviewer agents to edit files.
- Do not keep reviewers open while spawning the planner when the configured
  thread cap would be exceeded.
