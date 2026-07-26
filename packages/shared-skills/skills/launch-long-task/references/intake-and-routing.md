# Intake And Routing

Select the handoff target first, then use this matrix to judge readiness to start that target. Do not judge whether eventual risky work is ready. A required unresolved row blocks only when it prevents the selected handoff itself from starting safely.

## Handoff Readiness Matrix

| Dimension | Resolve from read-only discovery | Ask only when owner input is required | Ready for selected handoff | Block selected handoff only when |
| --- | --- | --- | --- | --- |
| Mission | User request and any authoritative brief | Which request is authoritative only when sources materially conflict? | The target has enough mission context to begin its own work; `ulw-plan` needs only an intelligible planning mission | The mission is absent, unintelligible, or contradictory enough that the target cannot begin |
| Handoff authority | Side effects performed by the selected target itself | May this target start when that act itself crosses an owner-controlled boundary? | Starting the target is authorized; later execution gates may remain deferred | Even starting the target would exceed authority or trigger an unapproved external, destructive, or irreversible action |
| Target capability | Visible skill/tool catalog and supported invocation form | Do not ask about capability facts visible to the harness | The named target is available through native invocation or a supported explicit `$skill-name` next-turn prompt | No safe target or invocation fallback exists |
| Handoff inputs | Existing plan for `start-work`; runbook/state for `ulw-loop`; mission for `ulw-plan` | Which competing authoritative artifact should the target receive? | Inputs required by this target exist and are identifiable | This target cannot begin without a missing or contradictory authoritative input |
| Handoff access | Non-secret indicators for access needed immediately by this target | Is immediate access provisioned through an approved mechanism? Ask only yes/no/unknown | Access needed to start this target is approved; access needed only for later execution is a deferred gate | Starting the target requires secret disclosure, unavailable access, or an unapproved mechanism |
| Handoff constraints | Repository and owner rules that govern the selected target now | Which conflicting owner-controlled constraint governs this handoff? | The target can start without violating an applicable constraint | Constraints conflict or require unsafe behavior during the handoff itself |
| Handoff watchpoints | Uncertainty that can affect the selected target before its next gate | Accept this handoff-level risk with its signal and response? | Each accepted handoff uncertainty has an observable signal, response, and owner/role | A material handoff risk has no observable signal, safe response, or authorized owner |

## Planning-Owned Questions

When `ulw-plan` is selected, record unresolved product outcome detail, scope boundaries, architecture, decomposition, dependency order, acceptance design, QA design, rollback design, and execution access as **downstream planning questions**. Do not ask them during launcher intake and do not convert them into launch blockers. Route immediately when the mission is sufficient for `ulw-plan` to explore.

Planning may be ready while implementation or production execution is not. Record irreversible actions, production access, deploy/publish/merge authority, service windows, rollback conditions, and final acceptance as deferred execution gates for downstream resolution. Block only if starting `ulw-plan` itself would exceed authority or no safe planning handoff exists.

## Readiness Labels

- `READY`: The selected handoff can start safely and has no material handoff-level uncertainty. Downstream planning questions and deferred execution gates do not change this label.
- `READY WITH DECLARED WATCHPOINTS`: The selected handoff can start safely, but a handoff-level uncertainty has an observable signal, response, and owner/role. Obtain owner acceptance only when that uncertainty affects the handoff itself.
- `BLOCKED`: The selected handoff cannot safely begin because its mission is unusable, its immediate authority/input/access is missing, its own action is unsafe or irreversible without approval, or no safe capability/fallback exists. State only the minimum facts needed to reassess; do not ask for launch confirmation.

Never downgrade a handoff blocker to a watchpoint merely to launch. Conversely, never promote a planning-owned unknown or deferred execution gate into a launcher blocker.

## Route Selection

Apply precedence from top to bottom:

| Condition | Route | Preferred handoff target |
| --- | --- | --- |
| The mission is intelligible but product outcome detail, scope, architecture, decomposition, dependency order, acceptance design, or another planning decision remains open; no decision-complete plan exists | `PLAN_THEN_EXECUTE` | `ulw-plan` |
| A decision-complete execution plan already exists and identifies work, dependencies, acceptance, and QA | `PLAN_THEN_EXECUTE` | `start-work` |
| Outcome and acceptance are known, but delivery is iterative, multi-stage, evidence-heavy, interruption-prone, or must resume from durable checkpoints | `DURABLE_CAMPAIGN` | `ulw-loop` |
| Work is small and bounded, has clear acceptance, fits one ordinary execution envelope, and does not need durable campaign state | `DIRECT` | One ordinary implementation/delegation capability |

Do not label a route from the user's adjective "long" alone. Classify from uncertainty, boundedness, and continuity needs.

## Boundary Examples

| Request shape | Classification | Launcher behavior |
| --- | --- | --- |
| "Make repository authentication more secure" with product boundaries and acceptance still open | `READY` for `PLAN_THEN_EXECUTE` via `ulw-plan` when that handoff is available | Record the open security boundary, scope, and acceptance design as downstream planning questions; do not ask them |
| Plan and later run a production user-table migration, but migration design, production access, rollback authority, and service-window detail remain open | `READY` for `PLAN_THEN_EXECUTE` via read-only `ulw-plan` when that handoff is available | Record migration design as downstream planning questions and production authority/access as deferred execution gates; never treat planning confirmation as production authorization |
| A durable A/B campaign has invalid required commits or cases and no available `ulw-loop` or supported explicit invocation fallback | `BLOCKED` for `DURABLE_CAMPAIGN` | Report only the immediate input and capability blockers; do not downgrade to `DIRECT` |
| Fix one identified typo in `README.md` | `DIRECT` | Explain that it is small, bounded, and ordinarily verifiable; create no contract and offer ordinary execution after explicit confirmation |

## Capability-Aware Handoff

Inspect only capabilities already visible in the harness catalog.

- For a named skill target, use the harness-native skill invocation mechanism once and pass: `Read <contract path>; honor its mission, constraints, watchpoints, and launch confirmation.`
- For `DIRECT`, after confirmation use one available ordinary implementation/delegation capability once and pass the mission plus discovered constraints directly. Do not split, supervise, retry, create a contract, or execute the assignment inside this skill.
- `DIRECT` is not a fallback for missing planning or durable capability. Use it only for genuinely small, bounded work; create no launch contract or long-horizon state, explain the classification, and offer ordinary execution after explicit confirmation.
- Do not load multiple candidate skills to test availability. Catalog presence is capability detection; invocation is the handoff.
- If a named skill is cataloged but no direct skill-invocation tool is available, and the harness supports explicit `$skill-name` prompt invocation, do not downgrade or claim completion. After confirmation, set `Launch state: AWAITING_HANDOFF`, then emit exactly one line and nothing else:

  `$<skill-name> Read <contract path>; honor its mission, constraints, downstream planning questions, watchpoints, deferred execution gates, and launch confirmation.`

- The line above is a next-turn handoff prompt for the user to submit; it is not a receipt. Do not emit a second prompt, retry, or continue intake.
- Treat a successful native tool acceptance or returned task/session identifier as the handoff receipt. Treat a native invocation error as `BLOCKED`; record it and stop without a second attempt.
