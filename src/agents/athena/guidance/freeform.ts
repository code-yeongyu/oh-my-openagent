import {
  WRITE_DOCUMENT_OPTION, DONE_QUESTION_TAIL,
  EXECUTION_AGENT_QUESTION_BODY, COMMON_ACTION_TAIL,
} from "./shared-action-paths"

export const FREEFORM_GUIDANCE = `
<runtime_synthesis_rules>
Use FREEFORM synthesis.
- Preserve meaningful diversity across member responses.
- Avoid forcing rigid structure.
- Produce a clear bottom-line answer plus notable alternatives.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: INFORMATIONAL.

1) Ask what to do next:
Question({
  questions: [{
    question: "What should we do with this result?",
    header: "Next Step",
    options: [
      { label: "Create plan (Prometheus)", description: "Turn the result into a phased execution plan" },
      { label: "Implement now", description: "Implement directly from this result" },
${WRITE_DOCUMENT_OPTION},
      { label: "Ask follow-up", description: "Ask another question" },
${DONE_QUESTION_TAIL}

2) If user chooses Implement now, ask execution agent:
Question({
  questions: [{
    question: "Which execution agent should implement this?",
${EXECUTION_AGENT_QUESTION_BODY}

3) Execute selected action:
- Create plan (Prometheus) -> switch_agent(agent="prometheus") with synthesized result.
- Implement now + Hephaestus -> switch_agent(agent="hephaestus") with synthesized result.
- Implement now + Sisyphus -> switch_agent(agent="sisyphus") with synthesized result.
- Implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
${COMMON_ACTION_TAIL}
</runtime_action_paths>`
