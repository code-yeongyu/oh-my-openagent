// plan-templates.mjs - the draft and plan skeleton text that scaffold-plan.mjs emits.
//
// Text only: no filesystem access, no path policy (scaffold-plan.mjs owns the write
// boundary). Zero external dependencies so it runs byte-identically under `node` and `bun`.

// The canonical AI-plan section headers, in order. references/full-workflow.md
// documents this exact list; the two must never drift.
export const PLAN_SECTION_HEADERS = [
	"## TL;DR (For humans)",
	"## Scope",
	"## Verification strategy",
	"## Execution strategy",
	"## Todos",
	"## Final verification wave",
	"## Commit strategy",
	"## Success criteria",
];

export const FINAL_VERIFICATION_ITEMS = [
	"F1. Plan compliance audit",
	"F2. Code quality review",
	"F3. Real manual QA",
	"F4. Ideal-state fidelity",
];

export function buildDraft(slug, intent, { reviewRequired = false } = {}) {
	const assumptionsNote =
		intent === "unclear"
			? "Intent is UNCLEAR: research resolves ambiguity, defaults are adopted (not asked), and each is surfaced in the plan's human TL;DR for veto."
			: "Record any default you adopt instead of asking, so the user can veto it at the gate.";
	const reviewState = reviewRequired
		? `review_required: true
plan_path: .omo/plans/${slug}.md
plan_sha256: null
review_round_id: null
pending-action: write and review .omo/plans/${slug}.md
review:
  momus:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
  independent:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/${slug}.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null`
		: `review_required: false
pending-action: write .omo/plans/${slug}.md`;
	return `---
slug: ${slug}
status: drafting
intent: ${intent}
${reviewState}
approach: <fill: the approach you intend to plan>
---

# Draft: ${slug}

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- ${assumptionsNote} -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)

## Decisions (with rationale)

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: drafting
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
`;
}

export function buildPlanSkeleton(slug, intent) {
	const decisionsLine =
		intent === "unclear"
			? "**Decisions I made for you:** <fill last - the best-practice defaults you adopted; the user vetoes any here>"
			: "**Decisions to sanity-check:** <fill last - the few choices worth a human glance>";
	return `# ${slug} - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** <fill last - the affected user and their experience after, 1-2 sentences>

**What you'll get:** <fill last - deliverables in human terms, 1-2 sentences>

**Why this approach:** <fill last - the one or two load-bearing decisions and why>

**What it will NOT do:** <fill last - 1-3 plain lines mirroring Must NOT have>

**Effort:** <Quick | Short | Medium | Large | XL>
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** <Low | Medium | High> - <one-line driver>
${decisionsLine}

Your next move: <fill - e.g. approve, or run a high-accuracy review>. Full execution detail follows below.

---

> TL;DR (machine): <1 line - effort, risk, deliverables>

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** <who, and how they use it today and after>

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | <what the user does, sees, or never has break> | <why this is the ideal for them> |
| GAP-1 | <how today differs from IS-1> | <why it matters to them> |

### Must have
### Must NOT have (guardrails, anti-slop, scope boundaries)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: <TDD | tests-after | none> + framework
- Evidence: <attemptDir>/task-<N>-${slug}.<ext> (attemptDir = currentAttemptDir from the ulw-loop status operation - on Senpi the eval SDK import, const { agentToolkit } = await import(\`\${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js\`) then agentToolkit.status(), on Codex the omo-agent-toolkit CLI, .omo/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .omo/evidence/)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. <title>
  What to do / Must NOT do: <...>
  Closes: GAP-<n>
  Parallelization: Wave <N> | Blocked by: <...> | Blocks: <...>
  References (executor has NO interview context - be exhaustive): <src/path:lines>
  Acceptance criteria (agent-executable): <exact command or assertion>
  QA scenarios (name the exact tool + invocation): happy + failure, Evidence <attemptDir>/task-1-${slug}.<ext>
  Commit: <Y/N> | <type>(<scope>): <summary>

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
${FINAL_VERIFICATION_ITEMS.map((item) => `- [ ] ${item}`).join("\n")}

## Commit strategy

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new \`- [ ] N.\` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | <N> | <scenario name from todo N> | <attemptDir>/task-<N>-${slug}.<ext> |
`;
}
