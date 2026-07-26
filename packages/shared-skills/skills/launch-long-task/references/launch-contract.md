# Launch Contract Schema

For `PLAN_THEN_EXECUTE` and `DURABLE_CAMPAIGN`, write exactly one Markdown file at `.omo/launches/<slug>.md`. Never create a contract for `DIRECT`. Keep the file concise, reviewer-readable, and secret-free. Use `Unknown - blocks selected handoff` only when the unknown prevents that handoff from starting; otherwise record it under downstream planning questions or deferred execution gates. Omit optional rows that do not apply.

```markdown
# Launch Contract: <mission title>

- Contract version: 2
- Readiness: <READY | READY WITH DECLARED WATCHPOINTS | BLOCKED>
- Route: <PLAN_THEN_EXECUTE | DURABLE_CAMPAIGN>
- Handoff target: <skill or delegation capability | unavailable>
- Readiness for: <starting the selected handoff>
- Launch state: <AWAITING_CONFIRMATION | CONFIRMED | AWAITING_HANDOFF | BLOCKED | HANDED_OFF>
- Updated: <ISO-8601 timestamp>

## Mission

- Request: <authoritative mission in the owner's words or a faithful concise summary>
- Handoff objective: <what the selected target will produce or begin>
- Authoritative inputs: <paths, issue/plan identifiers, or non-secret references>

## Selected Handoff Envelope

- Immediate constraints: <rules governing this handoff itself>
- Permitted handoff side effects: <none or explicitly authorized actions by this target>
- Immediate access readiness: <available through approved mechanism | not required | unavailable>
- Why this handoff is ready or blocked: <target-relative reason>

## Downstream Planning Questions

- <product scope, architecture, decomposition, dependency, acceptance, QA, rollback, or execution-access question owned by ulw-plan; or None>

## Deferred Execution Gates

- <eventual irreversible action, authority, access, service window, acceptance, or rollback gate; or None>

## Continuity

- Durable source of truth: <existing plan/campaign artifact or downstream target that will create it>
- Resume anchor: <existing artifact or downstream-owned future anchor; do not invent runtime state>

## Watchpoints

| Risk | Observable signal | Required response | Owner/role |
| --- | --- | --- | --- |
| <risk or None> | <signal> | <response> | <owner/role> |

## Decisions

- Discovered facts: <facts verified read-only and relevant to handoff selection>
- Owner decisions: <explicit choices about the handoff>
- Handoff blockers: <None or minimum immediate decision/capability needed>

## Launch Gate

- Confirmation asked: `Launch now via <handoff target> using .omo/launches/<slug>.md?`
- Confirmation: <pending | confirmed by owner in current conversation | not requested because blocked>
- Next-turn handoff prompt: <not applicable | pending | exact single `$skill-name` prompt emitted>
- Handoff receipt: <pending | target plus returned task/session identifier | invocation error; AWAITING_HANDOFF is not a receipt>
```

## Safety Rules

- Store paths, identifiers, booleans, and approved mechanism names; never store credential values, auth headers, cookies, private URLs, raw environment output, or secret-bearing command output.
- Summarize discovery instead of pasting logs. Redact a volunteered secret and do not repeat it.
- Evaluate every readiness field against the selected handoff. Do not write `Unknown - blocks selected handoff` for questions that `ulw-plan` owns or for authority/access needed only by eventual execution.
- When reusing a version 1 contract, upgrade it in place to version 2. Preserve confirmed owner decisions and the furthest valid launch state; reclassify old execution-readiness blockers as downstream planning questions or deferred execution gates when they do not block the selected handoff. Never reset confirmation or create a replacement contract solely for migration.
- Keep `Launch state` monotonic: `AWAITING_CONFIRMATION` to `CONFIRMED`, then to either `HANDED_OFF` after native acceptance or `AWAITING_HANDOFF` after emitting the one explicit next-turn prompt; any pre-handoff state may move to `BLOCKED`. Never record `HANDED_OFF` merely because a prompt was emitted.
- Record only one handoff receipt. An invocation error is terminal for this launcher turn; do not retry or choose another target.
- Use the contract as a launch decision record, not a progress ledger, plan, Goal, checkpoint database, heartbeat, or retry state.
