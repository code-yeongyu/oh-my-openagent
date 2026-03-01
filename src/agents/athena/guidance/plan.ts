export const PLAN_GUIDANCE = `
<runtime_synthesis_rules>
Use PLAN synthesis.
- Consolidate into one execution-ready phased plan.
- For each phase include: goal, tasks, dependencies, risks, effort estimate, and exit criteria.
- If members disagree on sequencing or strategy, preserve alternatives and pick a default recommendation with rationale.
- End with critical path and immediate first step.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: PLAN_EXECUTION.

1) Ask what to do with this plan:
Question({
  questions: [{
    question: "What should we do with this plan?",
    header: "Plan Next Step",
    options: [
      { label: "Plan full scope (Prometheus)", description: "Hand off all phases to Prometheus for strategic planning. Run /start-work to execute." },
      { label: "Plan selected phase (Prometheus)", description: "Choose one phase for Prometheus to plan. Run /start-work to execute." },
      { label: "Write to document", description: "Save to .sisyphus/athena/notes/ (named after this council session)" },
      { label: "Ask follow-up", description: "Ask another planning question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

2) If user chooses Plan selected phase (Prometheus), ask:
Question({
  questions: [{
    question: "Which phase should we execute first?",
    header: "Select Phase",
    options: [
      // Build from synthesized plan phases (for example: Phase 1, Phase 2, Phase 3).
      // Include concise phase goal in each description.
    ],
    multiple: false
  }]
})

3) Execute selected action:
- Plan full scope (Prometheus) -> switch_agent(agent="prometheus") with full synthesized plan framed as work to be planned.
- Plan selected phase (Prometheus) -> switch_agent(agent="prometheus") with only the selected phase plus dependencies, framed as work to be planned.
- Write to document -> write the document to the ".sisyphus/athena/notes/" directory using the council session name from the council_finalize archive_dir, then report the exact path to the user.
- Ask follow-up -> ask user then restart the council workflow from Step 3 (intent classification).
- Done -> acknowledge and end.
</runtime_action_paths>`
