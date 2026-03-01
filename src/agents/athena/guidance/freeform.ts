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
      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

2) If user chooses Implement now, ask execution agent:
Question({
  questions: [{
    question: "Which execution agent should implement this?",
    header: "Execution Agent",
    options: [
      { label: "Hephaestus", description: "Direct implementation with Hephaestus" },
      { label: "Sisyphus", description: "Implementation with Sisyphus" },
      { label: "Sisyphus ultrawork", description: "Implementation with Sisyphus using ultrawork mode" }
    ],
    multiple: false
  }]
})

3) Execute selected action:
- Create plan (Prometheus) -> switch_agent(agent="prometheus") with synthesized result.
- Implement now + Hephaestus -> switch_agent(agent="hephaestus") with synthesized result.
- Implement now + Sisyphus -> switch_agent(agent="sisyphus") with synthesized result.
- Implement now + Sisyphus ultrawork -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ".
- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Done -> acknowledge and end.
</runtime_action_paths>`
