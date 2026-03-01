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
      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another perspective question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

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
- Commit to stance -> create plan (Prometheus) -> switch_agent(agent="prometheus") with selected stance and rationale.
- Commit to stance -> implement now + Hephaestus -> switch_agent(agent="hephaestus") with selected stance.
- Commit to stance -> implement now + Sisyphus -> switch_agent(agent="sisyphus") with selected stance.
- Commit to stance -> implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Done -> acknowledge and end.
</runtime_action_paths>`
