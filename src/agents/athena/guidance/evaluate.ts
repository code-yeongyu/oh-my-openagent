import {
  WRITE_DOCUMENT_OPTION, DONE_QUESTION_TAIL,
  EXECUTION_AGENT_QUESTION_BODY, COMMON_ACTION_TAIL,
} from "./shared-action-paths"

export const EVALUATE_GUIDANCE = `
<runtime_synthesis_rules>
Use EVALUATE synthesis.
- Compare options against explicit criteria.
- Surface tradeoffs and finish with a primary recommendation plus fallback conditions.
- State confidence and the key uncertainty that could change the recommendation.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: INFORMATIONAL.

1) Ask what to do with the evaluation:
Question({
  questions: [{
    question: "What should we do with this evaluation?",
    header: "Evaluation Next Step",
    options: [
      { label: "Adopt option -> create plan (Prometheus)", description: "Turn a selected option into an execution plan" },
      { label: "Adopt option -> implement now", description: "Implement a selected option immediately" },
${WRITE_DOCUMENT_OPTION},
      { label: "Ask follow-up", description: "Ask another comparison question" },
${DONE_QUESTION_TAIL}

2) If user chooses either adopt-option path, ask:
Question({
  questions: [{
    question: "Which option should we adopt?",
    header: "Select Option",
    options: [
      // Build from synthesized options list (e.g., Option A, Option B, Option C).
    ],
    multiple: false
  }]
})

3) If user chooses "Adopt option -> implement now", ask execution agent:
Question({
  questions: [{
    question: "Which execution agent should implement the selected option?",
${EXECUTION_AGENT_QUESTION_BODY}

4) Execute selected action:
- Adopt option -> create plan (Prometheus) -> switch_agent(agent="prometheus") with selected option and rationale.
- Adopt option -> implement now + Hephaestus -> switch_agent(agent="hephaestus") with selected option.
- Adopt option -> implement now + Sisyphus -> switch_agent(agent="sisyphus") with selected option.
- Adopt option -> implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
${COMMON_ACTION_TAIL}
</runtime_action_paths>`
