# designpowers Routing Contract

`designpowers` routes design operating-layer guidance inside the existing frontend skill. It is not a replacement for `/frontend`, `/visual-qa`, `/ulw-plan`, `/start-work`, `/review-work`, or any OpenAgent skill, and it must not create a second planner, builder, verification harness, or orchestration API.

## Phase Routing

| User intent or workflow phase | Load or instruct | Required handoff from designpowers |
|---|---|---|
| Ambiguous or multi-step web UI request; any request needing a plan | `/ulw-plan` plus this reference's `lane-a-direction.md` | Provide design discovery prompts, target users, inclusive personas, taste direction, open owner decisions, and design debt policy as planning inputs. |
| Approved plan execution; continuing an OpenAgent plan | `/start-work` plus `lane-b-execution.md` | Keep execution under Boulder/ledger discipline and include current design-state constraints in worker assignments. |
| Building, styling, redesigning, auditing, or performance-checking a web UI | frontend `design` + `perfection`; add `lane-b-execution.md` when designpowers context affects implementation | Preserve the frontend `DESIGN.md` gate, design/perfection routing, React tooling, real-browser checks, and implementation standards. |
| Screenshots, visual regressions, clone fidelity, layout quality, alpha/CJK checks, or design QA | `/visual-qa` plus `lane-c-review.md` | Run objective evidence capture before design judgment and feed the same artifacts into persona/accessibility/heuristic review. |
| Final implementation approval, QA my work, review changes, or significant completed implementation | `/review-work` plus `lane-c-review.md` and `lane-d-memory.md` | Include the design brief, state file path, visual artifacts, unresolved design debt, and accessibility-debt acknowledgements as review inputs. |

## Planning Through `/ulw-plan`

When planning is needed, `designpowers` supplies design-specific context and lets `/ulw-plan` own the plan artifact. Do not write a separate design plan. The Prometheus plan should receive:

- product or page goal;
- primary tasks and user journeys;
- inclusive personas and assistive or cognitive constraints;
- taste direction, anti-references, and brand/design-system constraints;
- content tone and plain-language requirements;
- motion, responsive, and adaptive-interface requirements;
- verification expectations: frontend checks, visual QA artifacts, persona walkthroughs, and review-work sign-off;
- explicit Must Not Have constraints, including prohibited bridge/canvas tooling.

## Execution Through `/start-work`

When a plan is approved or selected, `/start-work` remains the orchestrator. `designpowers` only enriches worker prompts with design context from `.omo/frontend-design/state.md` and the selected plan. Worker prompts should carry:

- the exact plan checkbox and files in scope;
- design-state constraints that affect the task;
- required frontend `design` and `perfection` loading for UI implementation;
- required `/visual-qa` loading for rendered visual proof;
- the design debt rule: unresolved accessibility debt cannot disappear into a summary.

Direct implementation outside `/start-work` is not part of this routing contract when a Prometheus plan is active.

## UI Build Through Frontend `design` And `perfection`

The frontend skill owns actual UI build quality. `designpowers` may point it at:

- user taste and anti-reference notes;
- target personas and task success criteria;
- content tone, error-state, loading-state, and empty-state expectations;
- cognitive accessibility and adaptive preference requirements;
- design token and design-system constraints.

`designpowers` must not replace the frontend `DESIGN.md` gate, taste routing, React tooling, Lighthouse 100 workflow, browser QA, or performance discipline.

## Visual Checks Through `/visual-qa`

`/visual-qa` owns objective rendered evidence. Run it before accepting visual or design-quality claims. `designpowers` adds design judgment only after that evidence exists:

- accessibility review with WCAG plus cognitive accessibility concerns;
- heuristic review of task flow and feedback states;
- synthetic persona walkthroughs against the same build;
- debt capture for unresolved design or accessibility gaps.

The same build must satisfy objective visual evidence and design judgment, unless remaining gaps are explicitly recorded and accepted by the user.

## Final Review Through `/review-work`

Use `/review-work` as the final gate for significant implementation work. The review packet should include:

- original goal and design constraints;
- changed files and diff;
- `.omo/frontend-design/state.md` path when used;
- frontend design/perfection verification outputs;
- `/visual-qa` artifact paths;
- persona walkthrough results;
- design debt entries and any explicit accessibility-debt acknowledgement.

`designpowers` does not approve its own work. It prepares design context so `/review-work` can evaluate whether the delivered UI satisfies the full request.

## Prohibited Routes

The following are guardrails only: framesmith, Figma bridge tooling, `figma-bridge`, canvas adapters, and `canvas_evaluate` are not available integration paths. Do not add scripts, hooks, a scheduler, fake direct calls, or a competing planner/build harness.
