import {
  WRITE_DOCUMENT_OPTION, DONE_QUESTION_TAIL,
  EXECUTION_AGENT_QUESTION_BODY, COMMON_ACTION_TAIL,
} from "./shared-action-paths"

export const PERSPECTIVES_GUIDANCE = `
<runtime_synthesis_rules>
Use PERSPECTIVES synthesis.
- Map positions.
- Identify tensions.
- Evaluate evidence strength.
- Take a final stance with conditions.
- Name strongest counter-position and what evidence could overturn the final stance.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: INFORMATIONAL.

1) Ask what to do with these perspectives:
Question({
  questions: [{
    question: "What should we do with this perspectives analysis?",
    header: "Perspectives Next Step",
    options: [
      { label: "Commit to stance -> create plan (Prometheus)", description: "Turn a chosen stance into a phased plan" },
      { label: "Commit to stance -> implement now", description: "Implement based on a chosen stance immediately" },
${WRITE_DOCUMENT_OPTION},
      { label: "Ask follow-up", description: "Ask another perspective question" },
${DONE_QUESTION_TAIL}

2) If user chooses a commit-to-stance path, ask:
Question({
  questions: [{
    question: "Which stance should we commit to?",
    header: "Select Stance",
    options: [
      // Build from synthesized perspective labels and final stance.
    ],
    multiple: false
  }]
})

3) If user chooses "Commit to stance -> implement now", ask execution agent:
Question({
  questions: [{
    question: "Which execution agent should implement this stance?",
${EXECUTION_AGENT_QUESTION_BODY}

4) Execute selected action:
- Commit to stance -> create plan (Prometheus) -> switch_agent(agent="prometheus") with selected stance and rationale.
- Commit to stance -> implement now + Hephaestus -> switch_agent(agent="hephaestus") with selected stance.
- Commit to stance -> implement now + Sisyphus -> switch_agent(agent="sisyphus") with selected stance.
- Commit to stance -> implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
${COMMON_ACTION_TAIL}
</runtime_action_paths>`
