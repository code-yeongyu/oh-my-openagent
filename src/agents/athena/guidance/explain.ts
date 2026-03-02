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
      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another explanatory question" },
      { label: "Cross-check with council", description: "Launch a new council session with this synthesis as context" },
    ],
    multiple: false
  }]
})

2) Execute selected action:
- Convert to action plan (Prometheus) -> switch_agent(agent="prometheus") with synthesized explanation and target outcome.
- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Cross-check with council -> launch a new council session with the current synthesis as context. Restart from Step 2 (council setup) with the synthesis included in the prompt.
</runtime_action_paths>`
