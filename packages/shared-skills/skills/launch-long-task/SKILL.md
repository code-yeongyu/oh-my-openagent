---
name: launch-long-task
description: "Thin launch-readiness intake for safely routing substantial, long-running, or resumable work to the next capable handoff. Use when the user wants to assess, prepare, launch, or hand off work and the correct route through DIRECT, PLAN_THEN_EXECUTE, or DURABLE_CAMPAIGN is not yet explicit. Assesses readiness to start the selected handoff, not readiness to perform eventual implementation or production actions."
---

# Launch Long Task

Select the next handoff, assess readiness to start that handoff, obtain explicit confirmation, and hand off once. Do not plan the product, execute the work, or manage its runtime.

## Guardrails

- Read `references/intake-and-routing.md` and `references/launch-contract.md` before intake.
- Discover only enough read-only context to select and safely start the next handoff. Inspect the request, repository guidance, existing plans/state, relevant docs, and the visible skill/tool catalog. Do not mutate anything except a non-DIRECT contract.
- Ask only unresolved owner decisions that determine whether the selected handoff itself may start, 1-3 questions per turn. Do not ask the owner to rediscover facts available locally.
- Never ask product-scope, architecture, decomposition, dependency-order, implementation, or acceptance-design questions. Record them as downstream planning questions and route to `ulw-plan` as soon as the mission is sufficient for planning to begin.
- Do not ask for or persist passwords, tokens, keys, cookies, auth headers, private credentials, raw environment dumps, or secret-bearing URLs. Record only whether required access is available through an approved mechanism.
- Do not conduct the `ulw-plan` product interview, produce an execution plan, create a Goal, create checkpoint/evidence state, edit product code, execute product work, launch processes, or create runners, daemons, heartbeats, polling, or retry loops.
- Do not promise a wall-clock duration. Record deadlines or service windows only when the owner declares them.

## Workflow

1. **Discover.** Establish the mission, repository constraints, existing plan or campaign state, authority to start the next handoff, and visible handoff capabilities. Redact any secret the user volunteers; never echo it into a contract.
2. **Route early.** Select the route and target before evaluating readiness. A vague but intelligible mission is sufficient to begin `ulw-plan`; unresolved product or execution design belongs in downstream planning questions, not launcher questions or blockers.
3. **Assess the selected handoff.** Apply the intake matrix only to starting that target. Select one readiness label: `READY`, `READY WITH DECLARED WATCHPOINTS`, or `BLOCKED`. Eventual implementation, deployment, migration, publication, or other irreversible work may remain gated while a read-only planning handoff is ready.
4. **Handle DIRECT without durable overhead.** When work is small, bounded, clearly accepted, and fits ordinary execution, do not create `.omo/launches/` state or a launch contract. Explain briefly why the route is `DIRECT`, name the ordinary execution capability, and ask exactly: `This is a small bounded DIRECT task; proceed with ordinary execution via <capability>?` Treat only an unambiguous affirmative reply as confirmation. After confirmation, hand off once to that capability; do not execute inside this skill.
5. **Write non-DIRECT contract.** For `PLAN_THEN_EXECUTE` or `DURABLE_CAMPAIGN`, create or update exactly one secret-free `.omo/launches/<slug>.md` using the contract schema. Derive a stable lowercase hyphen slug from the mission. Reuse it across intake turns; never create parallel drafts. If the slug already describes different work, choose a distinct slug.
6. **Gate.** Show readiness for the selected handoff, route, contract path, target, and handoff-level watchpoints or blockers. For `BLOCKED`, stop without confirmation. Otherwise ask exactly: `Launch now via <handoff target> using <contract path>?` The original request is not confirmation.
7. **Handoff once.** After explicit confirmation, capability-detect without probing. If direct invocation is available, invoke exactly one target with the contract path and mission, record `HANDED_OFF`, and stop. If the named skill cannot be invoked directly but the harness supports explicit `$skill-name` prompts, record `AWAITING_HANDOFF`, emit exactly the one next-turn prompt specified in the routing reference, and stop. Do not claim handoff or downstream completion. If neither mechanism is available, record `BLOCKED`; never downgrade the route or choose a second target.

## Final Output

Before confirmation, report the classification for the selected handoff and the gate question. For prompt-only handoff, output only the single next-turn prompt. After native handoff, report only the contract path, classification, target, and receipt. For `DIRECT`, report the route explanation and confirmation question without creating long-horizon state. Never claim downstream work completed.
