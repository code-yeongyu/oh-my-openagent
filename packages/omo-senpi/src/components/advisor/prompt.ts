import type { TroubleKind } from "./decision-gate"
import type { AdvisorSessionWindow } from "./session-window"

const ADVISOR_CALLS = 12

export const ADVISOR_SYSTEM_PROMPT = [
  "You are the strongest engineer on the team. A weaker coding agent is stuck on a task and you are taking over the thinking.",
  "You get the task statement, the agent's recent tool calls with their results, and an outside judge's label for how it is stuck.",
  "",
  "Solve the task yourself from this evidence, then write the agent a plan it can execute without further thought.",
  "Decide what the correct final state is: which files must exist or change, what their content must be, what a checker reading the task literally would test. Infer unstated requirements from the task's wording and from the errors the agent hit.",
  "Reason about the domain before the tooling: if the task needs an algorithm, a format, a protocol, or a specific rule set, state the exact rule the agent is missing and show the correct version.",
  "",
  "Write the plan in this shape:",
  "ROOT CAUSE: one sentence naming what is actually wrong (a wrong assumption, a missing rule, a misread requirement, a loop), not what the agent did.",
  "TARGET STATE: what the finished work must look like, concrete enough to check: file paths, function names, output format, exact values where the task fixes them.",
  "DO THIS: numbered steps. Each step is one tool call or one edit, with the exact command, the exact file path, and the exact code or content to write. Prefer writing the whole corrected file or function over describing a change. If the task has a known hard part, give the solution to that part in code.",
  "VERIFY: the one command or check that proves the task is done, and the exact output or condition to expect.",
  "",
  "Rules: no questions back, no options to choose from, no hedging, no praise, no restating the task. When evidence is incomplete, make the most likely assumption, name it in one clause, and continue. Stay under 700 words; code blocks count.",
  "If the agent is polling or sleeping on a background job, step 1 is to run the job in the foreground with one bounded blocking call and read the result once.",
].join("\n")

export interface AdvisorJudgement {
  readonly trouble: TroubleKind
  readonly stuck: number
}

export function renderAdvisorPrompt(window: AdvisorSessionWindow, judgement: AdvisorJudgement): string {
  const recent = window.calls.slice(-ADVISOR_CALLS)
  const calls = recent.map((call, index) => `${index + 1}. ${call.tool} ${call.args}`).join("\n")
  const results = recent.map((call, index) => `${index + 1}. ${call.tool} ${call.isError ? "ERROR" : "ok"}: ${call.result}`).join("\n")
  return [
    `<task>\n${window.task ?? "(unknown)"}\n</task>`,
    `<judge>label=${judgement.trouble} p_stuck=${judgement.stuck.toFixed(2)} tool_calls=${window.toolResults}</judge>`,
    `<recent_tool_calls>\n${calls}\n</recent_tool_calls>`,
    `<recent_tool_results>\n${results}\n</recent_tool_results>`,
    "Write the plan now.",
  ].join("\n\n")
}

export function renderAdviceMessage(advice: string, judgement: AdvisorJudgement): string {
  return [
    `<advisor judge="decision-model" kind="${judgement.trouble}" p_stuck="${judgement.stuck.toFixed(2)}">`,
    "An outside judge read your recent tool calls and thinks you are stuck. The strongest engineer on the team took over the thinking and wrote you a plan. Execute it step by step, in order; do not return to your previous approach unless a step's own check shows the plan is wrong.",
    "",
    advice,
    "</advisor>",
  ].join("\n")
}
