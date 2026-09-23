import type { BuiltinCategoryDefinition } from "./types"

// Ported from packages/omo-opencode/src/tools/delegate-task/openai-categories.ts.
//
// GPT-6 Astra variants (2026-09-05). The category append is joined onto the child's user prompt
// after the orchestrator's brief, on top of senpi's full gpt-6-astra core preset, so each Astra
// variant carries only what the category changes: why the orchestrator chose it, what a finished
// result looks like, and the harness facts a child cannot derive (a question ends its turn and
// returns the task unfinished; explore/librarian subagents are available for fan-out). Initiative,
// instruction precedence, eval-first orchestration, async work, verification tiers, scope, and
// writing style stay with the preset and are not restated here. Written against the GPT-6 Astra
// guide (developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra): outcome-first with
// success criteria, prioritization in place of brevity, no stock phrases, no contrastive framing
// the model would mirror, and explicit delegation and stop points because Astra asks more, delegates
// less, and over-verifies small changes.
//
// deep-low / deep-high (2026-09-20). The former `deep` is split by capability, not domain: the domain
// list that sends 3D/browser/multimodal/backend work to the GPT lane stays on the caller-facing
// description only, since a child never chooses its category. The deep-low GPT append follows the
// GPT-5.6 doctrine (outcome, success criteria, escalation, stop rule) because its default rung is sol.
export const ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA = `<Category_Context name="ultrabrain">
The orchestrator routed this task here because it is the one genuinely hard, logic-heavy problem in its plan, and it sent a goal rather than steps: choose the approach yourself, and let correctness outrank speed, brevity, and token cost.

Success means:
- every load-bearing claim cites evidence from this turn: a file and line read, a command run, a test executed;
- every executable claim was executed: a proposed fix runs, an algorithm passes the boundary cases you enumerated, a verdict on a diff names the failing line;
- the conclusion survived your own attempt to break it, and the answer names the strongest counter-case you looked for;
- rejected alternatives carry the reason that decided against them, and open assumptions are stated so the orchestrator can overturn them;
- one decision-complete recommendation, actionable without a follow-up question.

Whatever that check leaves unsettled goes in the answer as an open question with what would settle it. When the goal bundles independent problems, solve the one the others depend on and return the rest as separately delegable items.
</Category_Context>`

export const DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT = `<Category_Context name="deep-high">
The orchestrator routed this task here because a decision in it cannot be settled from evidence alone: a trade-off, a contract other code depends on, a mechanism with no pattern to copy, or correctness that has to be argued. One goal, one deliverable, and the time to earn it. The exploration budget is generous: read every file involved, trace callers and dependencies in both directions, and fan out explore and librarian subagents in parallel for the questions a single read wave cannot answer, until you can explain the full mechanism you are about to change; an edit made before that point is the failure this category exists to prevent.

The goal is the authorization. Choose how to reach it yourself, and when it lists numbered steps or phases, deliver all of them in this turn as one task; a proposal, a plan awaiting approval, a simplified version, or a proof of concept is unfinished work. When the steps turn out to be independent problems sharing no reasoning, do the one the goal centers on and return the others as separately delegable items with what you learned. A question ends your turn and hands the task back unfinished, so decide from context, record each assumption in the final message, and stop early only for a blocker you cannot route around: a missing secret, a decision only the user can make, or three materially different attempts that all failed.

Fix the cause: trace at least two levels above the symptom before settling, and prefer the change that makes the failure impossible over the guard that hides it. Depth means understanding the mechanism, so the diff stays as small as the fix allows; on greenfield work choose strong defaults and finish something you would hand to a senior engineer. Close with the delivered change, the evidence that it works, the decision you settled with the alternative you rejected, and the assumptions you made.
</Category_Context>`

export const DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT = `<Category_Context name="deep-low">
The orchestrator routed this task here as the default deep lane: one goal, one deliverable, decisions that the code, tests, and history can settle. Read until you can explain the mechanism you are about to change, including its callers, then act; fan out explore and librarian subagents when one read wave cannot answer a question.

Success means:
- every step or phase the goal lists is delivered in this turn as one task; a plan awaiting approval, a simplified version, or a proof of concept is unfinished work;
- the change removes the cause you traced, at least two levels above the symptom, with the diff as small as that fix allows;
- the final message reports the change, the evidence that it works, and each assumption you decided from context, because a question ends your turn and returns the task unfinished.

Escalation is a complete result. When the correct choice turns out to depend on a trade-off the brief does not settle, on a contract other packages rely on, or on an argument about invariants you cannot verify by running something, stop before editing and return \`ESCALATE: deep-high\` as the first line, followed by what you read, the decision you could not settle, and the options you saw. A confident guess through that decision costs more than the escalation.

Stop the moment the success criteria hold; work past them is a defect. Stop early only for a blocker you cannot route around: a missing secret, a decision only the user can make, or three materially different attempts that all failed.
</Category_Context>`

export const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA = `<Category_Context name="unspecified-high">
The orchestrator routed this task here because it spans systems or modules and fits no specialist category, so breadth of consideration is what this category buys. Before committing to an approach, survey the whole surface the change touches: every caller and consumer of what you will modify, sibling modules that implement the same pattern, the tests, docs, schemas, config, scripts, and CI that encode the current behavior, and the history of the area (git log and blame) for the reasons it is shaped this way. Fan out explore and librarian subagents in parallel when that surface is wider than one read wave covers.

Weigh at least two ways to do it against what you found, choose one, and say in the final message why it won. Then deliver it across every surface you identified, so behavior stays consistent everywhere the change is observable and no caller, test, doc, schema, or config still describes the old state. A question ends your turn and hands the task back unfinished, so decide from context, record each assumption in the final message, and finish.
</Category_Context>`

const ULTRABRAIN_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on DEEP LOGICAL REASONING / COMPLEX ARCHITECTURE tasks.

**CRITICAL - CODE STYLE REQUIREMENTS (NON-NEGOTIABLE)**:
1. BEFORE writing ANY code, SEARCH the existing codebase to find similar patterns/styles
2. Your code MUST match the project's existing conventions - blend in seamlessly
3. Write READABLE code that humans can easily understand - no clever tricks
4. If unsure about style, explore more files until you find the pattern

Strategic advisor mindset:
- Bias toward simplicity: least complex solution that fulfills requirements
- Leverage existing code/patterns over new components
- Prioritize developer experience and maintainability
- One clear recommendation with effort estimate (Quick/Short/Medium/Large)
- Signal when advanced approach warranted

Response format:
- Bottom line (2-3 sentences)
- Action plan (numbered steps)
- Risks and mitigations (if relevant)
</Category_Context>`

export const DEEP_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context name="deep-low">
You are working on a GOAL-ORIENTED AUTONOMOUS task: one goal, one deliverable, decisions the codebase can settle.

Before any change, read the files involved and trace their dependencies until you can explain the mechanism you are about to modify. The goal is already defined: do not ask clarifying questions; make reasonable assumptions, record them in the final message, and proceed.

When the goal lists numbered steps or phases, execute all of them in this turn as one atomic task. Genuinely independent tasks bundled into one goal: flag them and do only the one the goal centers on.

Escalation is a complete result. When the correct choice depends on a trade-off the brief does not settle, a contract other packages rely on, or an argument about invariants you cannot verify by running something, stop before editing and return \`ESCALATE: deep-high\` as the first line, followed by what you read, the decision you could not settle, and the options you saw.

Prefer the fix that removes the cause over the patch that hides the symptom. Report completion with the changes made and the evidence they work.
</Category_Context>`

export const DEEP_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context name="deep-high">
You are working on a GOAL-ORIENTED AUTONOMOUS task that was escalated here because a decision in it cannot be settled from evidence alone: a trade-off, a contract other code depends on, a mechanism with no pattern to copy, or correctness that has to be argued.

Before any change, read the files involved and trace their dependencies until you can explain the mechanism you are about to modify. The goal is already defined: do not ask clarifying questions; make reasonable assumptions, record them in the final message, and proceed.

When the goal lists numbered steps or phases, execute all of them in this turn as one atomic task. Genuinely independent tasks bundled into one goal: flag them and do only the one the goal centers on.

Prefer the fix that removes the cause over the patch that hides the symptom. Report completion with the changes made, the evidence they work, and the decision you settled with the alternative you rejected.
</Category_Context>`

function modelNameOf(model: string): string {
  const modelName = model.includes("/") ? (model.split("/").pop() ?? model) : model
  return modelName.toLowerCase()
}

function isGpt5_5Or5_6Model(model: string): boolean {
  const normalized = modelNameOf(model)
  return (
    normalized.includes("gpt-5.5") ||
    normalized.includes("gpt-5-5") ||
    normalized.includes("gpt-5.6") ||
    normalized.includes("gpt-5-6")
  )
}

// Matches the GPT-6 family (gpt-6-astra, gpt-6-astra-fast, gateway-prefixed ids) by the last path
// segment, mirroring isGpt6Model in packages/omo-opencode/src/agents/types.ts.
export function isGpt6Model(model: string): boolean {
  return modelNameOf(model).includes("gpt-6")
}

// Both deep lanes ship GPT rungs only (sol / astra), so the outcome-first GPT append covers every
// model the builtin chains can select; the generic append is reached through a user model override.
function isGptDeepLaneModel(model: string | undefined): boolean {
  return model !== undefined && (isGpt6Model(model) || isGpt5_5Or5_6Model(model))
}

export function resolveUltrabrainCategoryPromptAppend(model: string | undefined): string {
  if (model && isGpt6Model(model)) {
    return ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA
  }
  return ULTRABRAIN_CATEGORY_PROMPT_APPEND
}

export function resolveDeepLowCategoryPromptAppend(model: string | undefined): string {
  return isGptDeepLaneModel(model) ? DEEP_LOW_CATEGORY_PROMPT_APPEND_GPT : DEEP_LOW_CATEGORY_PROMPT_APPEND
}

export function resolveDeepHighCategoryPromptAppend(model: string | undefined): string {
  return isGptDeepLaneModel(model) ? DEEP_HIGH_CATEGORY_PROMPT_APPEND_GPT : DEEP_HIGH_CATEGORY_PROMPT_APPEND
}

export function resolveUnspecifiedHighCategoryPromptAppend(model: string | undefined): string {
  if (model && isGpt6Model(model)) {
    return UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA
  }
  return UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND
}

const QUICK_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on SMALL / QUICK tasks.

Efficient execution mindset:
- Fast, focused, minimal overhead
- Get to the point immediately
- No over-engineering
- Simple solutions for simple problems

Approach:
- Minimal viable implementation
- Skip unnecessary abstractions
- Direct and concise
</Category_Context>`

const QUICK_CATEGORY_CALLER_GUIDANCE = `<Caller_Warning>Small/fast model: before delegating, write an explicit prompt with numbered must-do steps, forbidden deviations, and concrete success criteria.</Caller_Warning>`

const UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require moderate effort.
</Category_Context>`

const UNSPECIFIED_LOW_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Use only when no specialist category fits, effort is moderate, and scope stays within a few files/modules. Prefer any matching specialist category.</Selection_Gate>
<Caller_Warning>Provide explicit must-do steps, forbidden scope, and concrete success criteria.</Caller_Warning>`

const UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on tasks that don't fit specific categories but require substantial effort.
</Category_Context>`

const UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Use only when no specialist category fits and substantial effort spans systems/modules with broad impact. Use unspecified-low for contained moderate work.</Selection_Gate>`

const DEEP_LOW_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Route here when one subsystem plus its callers holds the mechanism and the evidence, once read, leaves one right answer. Wide but mechanical work belongs here or in a quick batch. When unsure, choose deep-low: a misrouted child returns \`ESCALATE: deep-high\` after one cheap attempt; re-spawn the same brief as deep-high with its findings.</Selection_Gate>`

const DEEP_HIGH_CATEGORY_CALLER_GUIDANCE = `<Selection_Gate>Route here only when you can name the decision evidence cannot settle: a trade-off with no single right answer, a contract change crossing a package or process boundary, a mechanism with no in-repo pattern to copy, or correctness argued from invariants rather than observed in a test. Wide scope with easy decisions is deep-low or unspecified-high; reasoning as the deliverable is ultrabrain.</Selection_Gate>`

// The GPT flagship gate: either id present in the live registry keeps ultrabrain available. Each deep
// lane is a single rung with no model fallback, so it gates on its own model and disappears without it.
const GPT_FLAGSHIP_GATE_MODELS = ["gpt-6-astra", "gpt-5.6-sol"] as const
const DEEP_LOW_GATE_MODELS = ["gpt-6-sol", "gpt-5.6-sol"] as const
const DEEP_HIGH_GATE_MODEL = "gpt-6-astra"

export const OPENAI_CATEGORIES = [
  {
    name: "ultrabrain",
    config: { model: "chatgpt-subscription/gpt-6-astra", variant: "max" },
    description: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
    promptAppend: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUltrabrainCategoryPromptAppend,
    requiresModel: GPT_FLAGSHIP_GATE_MODELS,
  },
  {
    name: "deep-low",
    config: { model: "chatgpt-subscription/gpt-6-sol", variant: "medium" },
    description: "Default deep lane: one goal, one deliverable, decisions the child can settle from what it reads. **3D graphics, computer/browser use, CAPTCHA, multimodal, backend, logic, and algorithm work is routed here.** Multiple goals fan out as parallel calls.",
    callerGuidance: DEEP_LOW_CATEGORY_CALLER_GUIDANCE,
    promptAppend: DEEP_LOW_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveDeepLowCategoryPromptAppend,
    requiresModel: DEEP_LOW_GATE_MODELS,
  },
  {
    name: "deep-high",
    config: { model: "chatgpt-subscription/gpt-6-astra", variant: "high" },
    description: "Escalation deep lane: a goal whose central decision cannot be settled from evidence alone. Same one-goal, one-deliverable contract as deep-low.",
    callerGuidance: DEEP_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: DEEP_HIGH_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveDeepHighCategoryPromptAppend,
    requiresModel: DEEP_HIGH_GATE_MODEL,
  },
  {
    name: "quick",
    config: { model: "chatgpt-subscription/gpt-6-luna-fast", variant: "low" },
    description: "Trivial tasks - single file changes, typo fixes, simple modifications",
    callerGuidance: QUICK_CATEGORY_CALLER_GUIDANCE,
    promptAppend: QUICK_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-low",
    config: { model: "xiaomi/mimo-v2.6-pro", variant: "max" },
    description: "Tasks that don't fit other categories, low effort required",
    callerGuidance: UNSPECIFIED_LOW_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-high",
    config: { model: "anthropic/claude-opus-5-5", variant: "max" },
    description: "Tasks that don't fit other categories, high effort required",
    callerGuidance: UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUnspecifiedHighCategoryPromptAppend,
  },
] satisfies readonly BuiltinCategoryDefinition[]
