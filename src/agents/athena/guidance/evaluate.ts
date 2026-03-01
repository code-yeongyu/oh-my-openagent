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
      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another comparison question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

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
    header: "Execution Agent",
    options: [
      { label: "Hephaestus", description: "Direct implementation with Hephaestus" },
      { label: "Sisyphus", description: "Implementation with Sisyphus" },
      { label: "Sisyphus ultrawork", description: "Implementation with Sisyphus using ultrawork mode" }
    ],
    multiple: false
  }]
})

4) Execute selected action:
- Adopt option -> create plan (Prometheus) -> switch_agent(agent="prometheus") with selected option and rationale.
- Adopt option -> implement now + Hephaestus -> switch_agent(agent="hephaestus") with selected option.
- Adopt option -> implement now + Sisyphus -> switch_agent(agent="sisyphus") with selected option.
- Adopt option -> implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Done -> acknowledge and end.
</runtime_action_paths>`
