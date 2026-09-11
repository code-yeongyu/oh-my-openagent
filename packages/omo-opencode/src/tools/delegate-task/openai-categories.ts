import { isGpt5_5Model, isGpt5_6Model, isGpt6Model } from "../../agents/types"
import type { BuiltinCategoryDefinition } from "./builtin-category-definition"

// GPT-6 Astra variants, byte-identical to packages/senpi-task/src/category/openai-categories.ts, where
// the rationale lives: each append is a delta over the model's own core preset and carries only why
// the orchestrator chose the category, what a finished result looks like, and the harness facts a
// child cannot derive.
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

export const DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA = `<Category_Context name="deep">
The orchestrator routed this task here for depth: one goal, one deliverable, and the time to earn it. The exploration budget is generous: read every file involved, trace callers and dependencies in both directions, and fan out explore and librarian subagents in parallel for the questions a single read wave cannot answer, until you can explain the full mechanism you are about to change; an edit made before that point is the failure this category exists to prevent.

**MUST USE \`deep\` FOR 3D GRAPHICS, COMPUTER USE, BROWSER USE, BACKEND, LOGIC, ALGORITHMS, CAPTCHA SOLVING, AND MULTIMODAL WORK.**

The goal is the authorization. Choose how to reach it yourself, and when it lists numbered steps or phases, deliver all of them in this turn as one task; a proposal, a plan awaiting approval, a simplified version, or a proof of concept is unfinished work. When the steps turn out to be independent problems sharing no reasoning, do the one the goal centers on and return the others as separately delegable items with what you learned. A question ends your turn and hands the task back unfinished, so decide from context, record each assumption in the final message, and stop early only for a blocker you cannot route around: a missing secret, a decision only the user can make, or three materially different attempts that all failed.

Fix the cause: trace at least two levels above the symptom before settling, and prefer the change that makes the failure impossible over the guard that hides it. Depth means understanding the mechanism, so the diff stays as small as the fix allows; on greenfield work choose strong defaults and finish something you would hand to a senior engineer. Close with the delivered change, the evidence that it works, and the assumptions you made.
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

export const DEEP_CATEGORY_PROMPT_APPEND = `<Category_Context>
You are working on GOAL-ORIENTED AUTONOMOUS tasks.

You are NOT an interactive assistant. You are an autonomous problem-solver.

**MUST USE \`deep\` FOR 3D GRAPHICS, COMPUTER USE, BROWSER USE, BACKEND, LOGIC, ALGORITHMS, CAPTCHA SOLVING, AND MULTIMODAL WORK.**

BEFORE making ANY changes:
1. Silently explore the codebase extensively (5-15 minutes of reading is normal)
2. Read related files, trace dependencies, understand the full context
3. Build a complete mental model of the problem space
4. Do not ask clarifying questions - the goal is already defined

You receive a GOAL. When the goal includes numbered steps or phases, treat them as one atomic task broken into sub-steps, not as separate independent tasks. Figure out HOW to achieve it yourself. Thorough research before any action.

Sub-steps of ONE goal = execute all steps as phases of one atomic task.
Genuinely independent tasks = flag and refuse, require separate delegations.

Approach: explore extensively, understand deeply, then act decisively. Prefer comprehensive solutions over quick patches. If the goal is unclear, make reasonable assumptions and proceed.

Minimal status updates. Focus on results, not play-by-play. Report completion with summary of changes.
</Category_Context>`

export const DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5 = `<Category_Context name="deep">
You are operating in DEEP mode. This is the category reserved for goal-oriented autonomous work on hairy problems that reward thorough exploration and comprehensive solutions.

**MUST USE \`deep\` FOR 3D GRAPHICS, COMPUTER USE, BROWSER USE, BACKEND, LOGIC, ALGORITHMS, CAPTCHA SOLVING, AND MULTIMODAL WORK.**

The orchestrator chose this category because the task benefits from depth over speed. You should feel empowered to spend the time needed: five to fifteen minutes of silent exploration before the first edit is normal and correct. Rushing to implementation on a deep task is a failure mode, not a feature.

# How deep mode adjusts the base behavior

**Exploration budget: generous.** Read the files you need, trace dependencies both directions, fire 2-5 explore/librarian sub-agents in parallel for broader questions. Build a complete mental model before the first \`apply_patch\`. Exploration here is an investment, not overhead.

**Goal, not plan.** You receive a GOAL describing the desired outcome. You figure out HOW to achieve it. The orchestrator deliberately did not hand you a step-by-step plan; producing one and asking for approval is not what was asked. Execute.

**Atomic task treatment.** When the goal contains numbered steps or phases, treat them as sub-steps of ONE task and execute them all in this turn. Splitting them across turns is wrong unless they reveal an architectural blocker that requires the user's input. If the "steps" turn out to be genuinely independent tasks that should have been separate delegations, flag that in your final message and refuse the ones beyond scope.

**Root cause bias.** Prefer root-cause fixes over symptom fixes. A null check around \`foo()\` is a symptom fix; fixing whatever causes \`foo()\` to return unexpected values is the root fix. Trace at least two levels up before settling on an answer. In deep mode, you have permission (and the expectation) to do the deeper fix.

**Ambition scaled to context.** For brand-new greenfield work, be ambitious. Choose strong defaults, avoid AI-slop aesthetics, produce something you would be proud to hand to another senior engineer. For changes in an existing codebase, be surgical and respect the existing patterns; depth does not mean invasiveness.

**Completion bar: full delivery.** "Simplified version", "proof of concept", and "you can extend this later" are not acceptable deliveries for a deep task. The orchestrator routed here specifically for a complete solution. If you hit a genuine blocker (missing secret, design decision only the user can make, three materially different attempts all failed), document it and return; otherwise, finish the task.

**Status cadence: sparse.** The user is not on the other side of this conversation; the orchestrator is, and they will synthesize your progress. Send commentary only at meaningful phase transitions (starting exploration, starting implementation, starting verification, hitting a genuine blocker). Do not narrate every tool call; silence during focused work is expected.
</Category_Context>`

export function resolveUltrabrainCategoryPromptAppend(model: string | undefined): string {
  if (model && isGpt6Model(model)) {
    return ULTRABRAIN_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA
  }
  return ULTRABRAIN_CATEGORY_PROMPT_APPEND
}

export function resolveDeepCategoryPromptAppend(model: string | undefined): string {
  if (model && isGpt6Model(model)) {
    return DEEP_CATEGORY_PROMPT_APPEND_GPT_6_ASTRA
  }
  if (model && (isGpt5_5Model(model) || isGpt5_6Model(model))) {
    return DEEP_CATEGORY_PROMPT_APPEND_GPT_5_5
  }
  return DEEP_CATEGORY_PROMPT_APPEND
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

// The GPT flagship gate: either id present in the live registry keeps deep available.
const GPT_FLAGSHIP_GATE_MODELS = ["gpt-6-astra", "gpt-5.6-sol"] as const

export const OPENAI_CATEGORIES: BuiltinCategoryDefinition[] = [
  {
    name: "ultrabrain",
    config: { model: "openai/gpt-6-astra", variant: "max" },
    description: "Use ONLY for genuinely hard, logic-heavy tasks. Give clear goals only, not step-by-step instructions.",
    promptAppend: ULTRABRAIN_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUltrabrainCategoryPromptAppend,
  },
  {
    name: "deep",
    config: { model: "openai/gpt-6-astra", variant: "high" },
    description: "**MANDATORY: USE deep FOR 3D GRAPHICS, COMPUTER USE, BROWSER USE, BACKEND, LOGIC, ALGORITHMS, CAPTCHA SOLVING, AND MULTIMODAL WORK.** Deep autonomous problem-solving for complex research. ONE goal + ONE deliverable per call — multiple goals must fan out as parallel `deep` calls, never bundled into one.",
    promptAppend: DEEP_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveDeepCategoryPromptAppend,
    requiresModel: GPT_FLAGSHIP_GATE_MODELS,
  },
  {
    name: "quick",
    config: { model: "kimi-for-coding/kimi-for-coding-highspeed" },
    description: "Trivial tasks - single file changes, typo fixes, simple modifications",
    callerGuidance: QUICK_CATEGORY_CALLER_GUIDANCE,
    promptAppend: QUICK_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-low",
    config: { model: "xai/grok-4.6", variant: "xhigh" },
    description: "Tasks that don't fit other categories, low effort required",
    callerGuidance: UNSPECIFIED_LOW_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_LOW_CATEGORY_PROMPT_APPEND,
  },
  {
    name: "unspecified-high",
    config: { model: "openai/gpt-6-astra", variant: "high" },
    description: "Tasks that don't fit other categories, high effort required",
    callerGuidance: UNSPECIFIED_HIGH_CATEGORY_CALLER_GUIDANCE,
    promptAppend: UNSPECIFIED_HIGH_CATEGORY_PROMPT_APPEND,
    resolvePromptAppend: resolveUnspecifiedHighCategoryPromptAppend,
  },
]
