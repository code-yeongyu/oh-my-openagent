# Lane B: Design Execution Guidance

Lane B feeds `start-work` workers and always loads `frontend` for UI implementation. It does not install a separate builder. Its job is to carry designpowers composition, interaction, motion, content, responsive, adaptive, token, and cognitive-accessibility guidance into worker prompts while keeps ownership of decomposition, implementation, QA, evidence, and ledger updates.

## Phase Owner

| Capability | Materialized designpowers source | owner | Mapping |
|---|---|---|---|
| Visual hierarchy, layout, color, typography, touch targets, and WCAG contrast | `ui-composition` | `start-work` worker plus `frontend` | Add visual constraints and acceptance checks to worker assignments. `frontend` remains the required UI implementation skill. |
| States, feedback, loading, error, keyboard, touch, and recovery behavior | `interaction-design` | `start-work` worker plus `frontend` | Require every interactive component to define default, hover, focus, active, disabled, loading, success, and error states where applicable. |
| Purposeful motion and reduced-motion alternatives | `motion-choreography` | `start-work` worker plus `frontend` | Require motion specs to explain what changed, what to look at next, or how elements relate; require safe alternatives. |
| Content-driven breakpoints and zoom behavior | `responsive-patterns` | `start-work` worker plus `frontend` | Require responsive proof at narrow, mid, desktop, and 200 percent zoom scenarios when the surface is visual. |
| User preference adaptation | `adaptive-interfaces` | `start-work` worker plus `frontend` | Require support for relevant preferences such as color scheme, contrast, reduced motion, text sizing, and density. |
| Mental load, wayfinding, focus management, memory demands, and recovery paths | `cognitive-accessibility` | `start-work` worker plus `frontend` | Add COGA-style checks directly to worker acceptance criteria for flows, forms, navigation, and dense tools. |
| Plain-language labels, headings, alt text, link text, errors, and instructions | `accessible-content` and `voice-and-tone` | `start-work` worker plus `frontend` | Require final copy, no placeholders, useful errors, readable labels, and consistent tone. |
| Tokens and design-system consistency | `token-architecture` and `design-system-alignment` | `frontend` | Require real design tokens and existing component patterns before new one-off styling. |

Materialized agent references for this lane: `design-lead`, `motion-designer`, and `content-writer`. They are prompt-role references for spawned OpenAgent work, not alternate executors.

## Prompt Injection

Add this block to each `start-work` implementation worker that touches UI:

```text
Load `frontend` for UI implementation. Also apply Lane B Design Execution Guidance.

Use the OpenAgent plan and `.omo/frontend-design/state.md` as source of truth. Carry forward:
- design principles, personas, taste direction, and accepted trade-offs
- ui-composition requirements for hierarchy, spacing, type, color, contrast, and touch targets
- interaction-design requirements for all states, feedback, keyboard, touch, loading, empty, and error paths
- motion-choreography requirements for purposeful motion and reduced-motion alternatives
- responsive-patterns requirements for content-driven breakpoints and 200 percent zoom
- adaptive-interfaces requirements for relevant user preferences
- cognitive-accessibility requirements for mental load, wayfinding, focus, memory, and recovery
- accessible-content and voice-and-tone requirements for labels, headings, alt text, link text, and errors
- token-architecture and design-system-alignment requirements for reusable tokens and existing components

Do not invent visual direction that conflicts with the plan. If the plan lacks a design decision that affects users, return BLOCKED with the exact missing owner decision.
```

## Evidence Requirements

Lane B worker DoneClaims must include:

- Exact changed files and the `frontend` references loaded.
- The real-surface QA invocation required by `start-work` for the UI surface, with captured artifact path.
- Screenshot, browser, HTTP, or tmux artifacts appropriate to the visible surface.
- Accessibility evidence from the existing OpenAgent frontend path, such as Lighthouse, react-doctor, keyboard checks, or other plan-required checks.
- A short design trace: which persona, design principle, token, or state requirement each major UI decision satisfies.
- Cleanup receipts for any browser session, server, tmux session, temporary artifact, or process used during QA.

## Guardrails

- UI implementation always goes through `frontend`; Lane B only enriches the worker prompt.
- `start-work` owns decomposition, worker dispatch, evidence ledger entries, adversarial checks, and completion state.
- The materialized `design-builder` concept is not used as an available executor. OpenAgent workers build.
- No placeholders, generic copy, unverified contrast claims, decorative-only motion, or one-off hardcoded design systems pass this lane.
- Accessibility and cognitive-accessibility are implementation constraints, not review-only cleanup.
- Direct or auto mode language is prompt-only and cannot create new automation.

## Pass / Fail Behavior

PASS when every UI worker loads `frontend`, implements against the OpenAgent plan plus Lane B constraints, and returns evidence showing the design works through the actual surface.

FAIL when a worker skips `frontend`, invents unplanned design direction, omits cognitive-accessibility checks for complex flows, ships placeholder content, leaves required states undesigned, or claims success without captured real-surface evidence.
