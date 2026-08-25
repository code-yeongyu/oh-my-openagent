# Define Goal

How to turn a brief into a registered goal the run can be held to. Read this BEFORE calling `create_goal`: the objective you register is the binding contract for the whole run, and the run's quality is capped by the quality of this objective.

A goal is a prompt to the agent that executes it, including future-you after compaction. It earns its tokens the way any prompt does: it carries only what the run cannot re-derive later, the outcome, the proof, the bounds, and the stop state. Everything else is noise that steals attention from the parts that decide completion.

## The quality bar

Before registering, the objective must answer all five:

1. What concrete thing will be TRUE when this is done? An outcome, never an activity.
2. What evidence will prove it? Commands, validators, artifacts someone can open.
3. What quantitative or binary threshold defines success?
4. What scope boundaries matter? What is in, and what is explicitly out.
5. What should make the agent stop and ask instead of grinding?

An objective that cannot answer one of these is not ready. Repair it (below) before calling the tool.

## Objective anatomy

Write the objective outcome-first, in this order:

1. **Outcome**: one sentence stating what will be true, naming the artifact, system, repo, or user-facing behavior involved.
2. **Deliverables**: the named surfaces the work lands on (files, endpoints, packages, environments). Use literal paths and names: the executing agent interprets the objective literally and will not infer surfaces you did not name.
3. **Success criteria**: sized by tier (below), each one a binary observable with its scenario and evidence named upfront.
4. **Constraints and scope bounds**: Record the user's stated constraints verbatim, including what is explicitly out of scope wherever ambiguity would let the run expand. Where the user was silent on a bound the work forks on, SET it yourself: derive the clearest defensible bound from repo evidence and best practice (stack already in use, compatibility surfaces, scale the code must serve, audience or compliance the repo implies) and record it inside the objective as `assumed: <constraint> — <rationale>, <reversible?>`, binding until the user vetoes it. Unstated bounds do not exist — which is why you write them.
5. **WHEN TO STOP**: one line, "I'll stop right away when <the exact observable state that ends this run>". This line is binding: the moment it holds, the run delivers and stops. Work past it is a defect, not diligence.

State the motivation when it changes execution ("p95 matters because the checkout SLA is 300ms") and omit it when it does not. Positive statements beat prohibitions: "verify against staging" carries more signal than "do not touch production".

## Success criteria construction

Count by tier, mirroring the run's tier triage:

- LIGHT (known pattern, no open design decisions): 1-2 criteria, happy path plus the riskiest edge.
- HEAVY (new module or abstraction, auth or security, external integration, schema or migration, concurrency, cross-domain refactor, or the user demanded care): 3+ criteria covering happy path, edge (boundary, empty, malformed, concurrent), adjacent-surface regression named by file and function, and the adversarial risk the change actually creates.

Every criterion carries, at definition time, not after the work:

- a binary pass condition ("returns 200 and the body matches the schema", never "works correctly");
- the exact scenario: the literal command, request, page action, or payload that will prove it;
- the evidence artifact it will capture: transcript, status plus body, screenshot path, diff, parsed dump;
- the failing-first proof (test id or scenario) that will be captured RED before implementation.

A criterion that cannot fail is not a criterion. If no input could make the scenario fail, it measures nothing; rewrite it until failure is possible.

## Make it quantitative

Prefer numbers that represent real success over decorative precision. A threshold nobody would act on differently is noise.

| Domain | Quantify as |
| --- | --- |
| Bug fix | reproduction first, fix second: the failing case captured RED, then the same validator green |
| Tests | the exact command and required pass condition, plus run count for flake-sensitive suites |
| Performance | metric, target threshold, measurement method, and run count ("p95 under 250ms across 3 consecutive local runs") |
| Quality work | the observable acceptance bar: lint, typecheck, and test pass; reviewed examples; a user-approved artifact |
| Research | the decision the research must enable, the sources or systems in scope, and the evidence standard per claim |
| Operations | healthy state, monitoring window, failure threshold, and the rollback or escalation trigger |

## Repair weak goals

Reject pure activity objectives: "make progress", "keep investigating", "improve things", "work on X". They cannot fail, so they cannot finish.

Rewrite vague goals into measurable ones when local context makes the rewrite safe. Ask ONE narrow question only when the missing detail is an OWNER-DECISION — irreversible, destructive, safety-critical, or a cross-cutting product choice (real budget or spend, public surface, external dependency, data shape, target audience) — that changes the intended outcome or its validation, shaped around the missing validator or bound:

- "What metric defines success here: latency, cost, accuracy, or user-visible behavior?"
- "Which environment do I verify against: local, staging, or production?"
- "What is the minimum evidence you want before this goal is marked complete?"

Every other missing constraint follows Objective anatomy #4: adopt the clearest defensible default, state it in the objective as `assumed:`, and let the user veto.

When the user cannot provide a metric, propose the most honest binary validator available and proceed with it stated in the objective.

Weak: "Make checkout faster."
Repaired: "Reduce checkout API p95 below 250ms on the documented slow path with the smallest safe server-side change; prove it with `npm run test:checkout` green plus the local latency benchmark showing p95 under 250ms across 3 consecutive runs; out of scope: client-side changes and new caching layers."

Weak: "Keep investigating the PR comments."
Repaired: "Resolve every open change-requesting review comment on PR 123 touching only the affected auth files and their tests; prove it with the targeted auth test command green plus `gh pr view 123` showing zero unresolved change-request threads."

## Registration protocol

1. Call `get_goal` first, then act by state:

| get_goal shows | Action |
| --- | --- |
| no active goal | Register with `create_goal`, passing exactly `objective`. Never include lifecycle fields such as `status`; never register a goal in prose, a notepad, or a plan instead of the tool. |
| an active goal matching this intent | Continue it. Never register a duplicate. |
| an active goal conflicting with this intent | Stop and surface the conflict; the user decides whether to finish it, complete it, or branch. |

2. Goals are unlimited. Never invent a numeric budget, token limit, or deadline the user did not state — that ban covers run quotas; the `assumed:` work constraints from Objective anatomy #4 are different and required.
3. In a ulw-loop run, the loop CLI owns per-goal state (`.omo/ulw-loop/goals.json`): `create_goal` registers the aggregate objective from the printed handoff, and this reference shapes both that objective and every goal's `successCriteria` at `create-goals` time.

## Completion honesty

- Report `update_goal` complete only after auditing every criterion against evidence captured in this run. A green suite is supporting evidence, never completion proof by itself.
- Waiting is not blocked: while a monitor, background child, or scheduled continuation can wake the run, end the turn and let it fire. Blocked requires a true impasse: no live resumption channel, and the same block recurring across consecutive turns.
- The moment the WHEN TO STOP line holds with evidence in hand, deliver and stop.

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
| --- | --- | --- |
| Activity objective ("investigate X") | Cannot fail, so cannot finish; the run wanders | Name the outcome the activity must produce and its evidence |
| Criteria added after implementation | The contract bent to fit the work; nothing was proven | Write criteria and scenarios at registration, before any edit |
| Decorative precision ("99.97% uptime" nobody measures) | A threshold no validator checks is noise wearing a suit | Only thresholds a named validator will actually check |
| Padded objective (role prose, restated context, filler) | Every extra token competes with the criteria for attention | Outcome, deliverables, criteria, bounds, stop line; nothing else |
| Goal registered in prose or a notepad | Nothing binds the run; completion becomes a vibe | `create_goal` with the objective, every time the tool exists |
| Duplicate goal for the same intent | Two contracts, neither authoritative | Continue the active goal or surface the conflict |
