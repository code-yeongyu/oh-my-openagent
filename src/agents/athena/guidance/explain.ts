import { WRITE_DOCUMENT_OPTION, DONE_QUESTION_TAIL, COMMON_ACTION_TAIL } from "./shared-action-paths"

export const EXPLAIN_GUIDANCE = `
<runtime_synthesis_rules>
Use EXPLAIN synthesis.
- Start with thesis.
- Then mechanisms/interactions.
- Then uncertainties and confidence.
- Include a concise "why this matters" section tied to the user question.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: INFORMATIONAL.

1) Ask what to do with the explanation:
Question({
  questions: [{
    question: "What should we do with this explanation?",
    header: "Explanation Next Step",
    options: [
      { label: "Convert to action plan (Prometheus)", description: "Turn insights into a phased plan" },
${WRITE_DOCUMENT_OPTION},
      { label: "Ask follow-up", description: "Ask another explanatory question" },
${DONE_QUESTION_TAIL}

2) Execute selected action:
- Convert to action plan (Prometheus) -> switch_agent(agent="prometheus") with synthesized explanation and target outcome.
${COMMON_ACTION_TAIL}
</runtime_action_paths>`
