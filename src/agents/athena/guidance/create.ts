export const CREATE_GUIDANCE = `
<runtime_synthesis_rules>
Use CREATE synthesis.
- Preserve creations side-by-side as a gallery.
- Do not collapse into a single merged artifact unless the user asks.
- Assign stable IDs to creations (e.g., C1, C2, C3) so user selections are unambiguous.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: INFORMATIONAL.

1) Ask which creations to carry forward:
Question({
  questions: [{
    question: "Which creations should we carry forward? You can also type IDs (e.g. C1, C3).",
    header: "Select Creations",
    options: [
      // Build from synthesized gallery IDs and titles.
    ],
    multiple: true
  }]
})

2) If no creations are selected, ask:
Question({
  questions: [{
    question: "No creations selected. What should we do next?",
    header: "Next Step",
    options: [
      { label: "Ask follow-up", description: "Ask for clearer selection criteria" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

3) If creations are selected, ask:
Question({
  questions: [{
    question: "How should we proceed with the selected creations?",
    header: "Creation Next Step",
    options: [
      { label: "Implement selected creation (Hephaestus)", description: "Direct implementation with Hephaestus" },
      { label: "Implement selected creation (Sisyphus)", description: "Implementation with Sisyphus" },
      { label: "Implement selected creation (Sisyphus ultrawork)", description: "Implementation with Sisyphus using ultrawork mode" },
      { label: "Write selected creation to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another creation-focused question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

4) Execute selected action:
- Implement selected creation (Hephaestus) -> switch_agent(agent="hephaestus") with only selected creation(s).
- Implement selected creation (Sisyphus) -> switch_agent(agent="sisyphus") with only selected creation(s).
- Implement selected creation (Sisyphus ultrawork) -> switch_agent(agent="sisyphus") and prefix handoff context with "ultrawork ", including only selected creation(s).
- Write selected creation to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Done -> acknowledge and end.
</runtime_action_paths>`
