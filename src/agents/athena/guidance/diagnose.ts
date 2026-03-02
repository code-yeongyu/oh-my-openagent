export const DIAGNOSE_GUIDANCE = `
<runtime_synthesis_rules>
Use DIAGNOSE synthesis.
- Build: Symptom -> hypotheses -> root cause -> contributing factors -> recommended fix.
- Anchor confidence to agreement level and evidence quality.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: ACTIONABLE.

1) Treat DIAGNOSE as a single-incident flow.
- Identify the primary root-cause fix candidate as one scoped item.

2) If no actionable fix candidate is identified, ask:
Question({
  questions: [{
    question: "No actionable findings were identified. What should we do next?",
    header: "Next Step",
    options: [
      { label: "Ask follow-up", description: "Ask a clarifying question and run another council pass" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

3) If an actionable fix candidate exists, ask action directly (no findings multi-select):
Question({
  questions: [{
    question: "How should we execute this diagnosis fix?",
    header: "Action",
    options: [
      { label: "Implement (Hephaestus)", description: "Hand off to Hephaestus for direct implementation" },
      { label: "Implement (Sisyphus)", description: "Hand off to Sisyphus for implementation" },
      { label: "Implement (Sisyphus ultrawork)", description: "Hand off to Sisyphus with ultrawork mode" },
      { label: "Cross-check with council", description: "Launch a new council session with this synthesis as context" },
      { label: "No action", description: "Review only - no delegation" }
    ],
    multiple: false
  }]
})

4) Execute selected action:
- Implement (Hephaestus) -> switch_agent(agent="hephaestus")
- Implement (Sisyphus) -> switch_agent(agent="sisyphus")
- Implement (Sisyphus ultrawork) -> switch_agent(agent="sisyphus") and prefix the handoff context with "ultrawork "
- Cross-check with council -> launch a new council session with the current synthesis as context. Restart from Step 2 (council setup) with the synthesis included in the prompt.
- No action -> acknowledge and end
</runtime_action_paths>`
