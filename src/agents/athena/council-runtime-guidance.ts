const VALID_INTENTS = [
  "DIAGNOSE",
  "AUDIT",
  "PLAN",
  "EVALUATE",
  "EXPLAIN",
  "CREATE",
  "PERSPECTIVES",
  "FREEFORM",
] as const

export type CouncilIntent = (typeof VALID_INTENTS)[number]

const RUNTIME_GUIDANCE_BY_INTENT: Record<CouncilIntent, string> = {
  DIAGNOSE: `
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
      { label: "No action", description: "Review only - no delegation" }
    ],
    multiple: false
  }]
})

4) Execute selected action:
- Implement (Hephaestus) -> switch_agent(agent="hephaestus")
- Implement (Sisyphus) -> switch_agent(agent="sisyphus")
- Implement (Sisyphus ultrawork) -> switch_agent(agent="sisyphus") and prefix the handoff context with "ultrawork "
- No action -> acknowledge and end
</runtime_action_paths>`,

  AUDIT: `
<runtime_synthesis_rules>
Use AUDIT synthesis.
- Output numbered findings grouped by confidence: unanimous, majority, minority, solo.
- For each finding: issue, impact, evidence, fix direction.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: ACTIONABLE.

1) Build actionable findings list from audit synthesis.

2) Ask how the user wants to process findings:
Question({
  questions: [{
    question: "How would you like to process the findings?",
    header: "Processing Mode",
    options: [
      { label: "One by one", description: "Review findings individually with per-finding decisions" },
      { label: "By severity/urgency", description: "Select findings by criticality first" },
      { label: "By quorum", description: "Select findings by agreement level" }
    ],
    multiple: false
  }]
})

3) Branch by processing mode.

Mode: One by one
- Process findings in batches using ONE Question call per batch.
- Default batch size: 3 findings per batch.
- Hard cap: 5 findings only when findings are short and options are limited.
- For each finding in the batch, provide dynamic options from synthesis (for example A/B/C fix options) plus:
  - Skip
  - Defer
  - Stop review
- Example Question tool call (batch of 3 findings):
Question({
  questions: [
    {
      question: "Finding #10: choose how to proceed.",
      header: "#10 Action",
      options: [
        { label: "Option A", description: "Apply fix option A from synthesis" },
        { label: "Option B", description: "Apply fix option B from synthesis" },
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    },
    {
      question: "Finding #11: choose how to proceed.",
      header: "#11 Action",
      options: [
        { label: "Option A", description: "Apply fix option A from synthesis" },
        { label: "Option C", description: "Apply fix option C from synthesis" },
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    },
    {
      question: "Finding #12: choose how to proceed.",
      header: "#12 Action",
      options: [
        { label: "Option B", description: "Apply fix option B from synthesis" },
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    }
  ]
})
- Keep free-form answers enabled (user may type custom choices like "#10:A, #11:skip"). Parse them.
- Continue batch-by-batch until user stops or all findings are processed.

Mode: By severity/urgency
- Ask multi-select severity buckets using only non-empty groups.
- Typical groups: Critical, High, Medium, Low.
- Example Question tool call:
Question({
  questions: [{
    question: "Which findings should we act on by severity? You can also type specific finding numbers (e.g. #1, #3, #7).",
    header: "Select Findings",
    options: [
      // Include ONLY severities that actually have findings. Skip empty ones.
      // Replace N with the actual count for each category.
      { label: "All Critical (N)", description: "Highest urgency findings" },
      { label: "All High (N)", description: "High-priority findings" },
      { label: "All Medium (N)", description: "Medium-priority findings" },
      { label: "All Low (N)", description: "Lower-priority findings" },
    ],
    multiple: true
  }]
})
- Resolve selected buckets into concrete finding IDs.

Mode: By quorum
- Ask multi-select quorum buckets using only non-empty groups.
- Typical groups: Unanimous, Majority, Minority, Solo.
- Example Question tool call:
Question({
  questions: [{
    question: "Which findings should we act on? You can also type specific finding numbers (e.g. #1, #3, #7).",
    header: "Select Findings",
    options: [
      // Include ONLY categories that actually have findings. Skip empty ones.
      // Replace N with the actual count for each category.
      { label: "All Unanimous (N)", description: "Findings agreed on by all members" },
      { label: "All Majority (N)", description: "Findings agreed on by most members" },
      { label: "All Minority (N)", description: "Findings from 2+ members - higher false-positive risk" },
      { label: "All Solo (N)", description: "Single-member findings - potential false positives" },
    ],
    multiple: true
  }]
})
- Resolve selected buckets into concrete finding IDs.

4) If actionable findings count is 0 OR user selected no findings, do NOT ask execution action. Ask:
Question({
  questions: [{
    question: "No findings were selected for action. What should we do next?",
    header: "Next Step",
    options: [
      { label: "Ask follow-up", description: "Ask a clarifying question and run another council pass" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

5) If selected findings exist, ask what action to take on the selected findings:
Question({
  questions: [{
    question: "How should we handle the selected findings?",
    header: "Action",
    options: [
      { label: "Fix now (Atlas)", description: "Hand off to Atlas for direct implementation" },
      { label: "Create plan (Prometheus)", description: "Hand off to Prometheus for planning and phased execution" },
      { label: "No action", description: "Review only - no delegation" }
    ],
    multiple: false
  }]
})

6) Execute selected action:
- Fix now (Atlas) -> switch_agent(agent="atlas") with ONLY selected findings
- Create plan (Prometheus) -> switch_agent(agent="prometheus") with ONLY selected findings
- No action -> acknowledge and end
</runtime_action_paths>`,

  PLAN: `
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
      { label: "Execute full plan (Prometheus)", description: "Hand off all phases to Prometheus for execution" },
      { label: "Execute selected phase (Prometheus)", description: "Choose one phase and execute only that phase first" },
      { label: "Write to document", description: "Write the plan under .sisyphus/athena/notes/{council-session-name}" },
      { label: "Ask follow-up", description: "Ask another planning question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

2) If user chooses Execute selected phase (Prometheus), ask:
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
- Execute full plan (Prometheus) -> switch_agent(agent="prometheus") with full synthesized plan.
- Execute selected phase (Prometheus) -> switch_agent(agent="prometheus") with only the selected phase plus dependencies.
- Write to document -> write the document directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path to the user.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,

  EVALUATE: `
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
      { label: "Write to document", description: "Write under .sisyphus/athena/notes/{council-session-name}" },
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
- Write to document -> write directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,

  EXPLAIN: `
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
      { label: "Write to document", description: "Write under .sisyphus/athena/notes/{council-session-name}" },
      { label: "Ask follow-up", description: "Ask another explanatory question" },
      { label: "Done", description: "No further action needed" }
    ],
    multiple: false
  }]
})

2) Execute selected action:
- Convert to action plan (Prometheus) -> switch_agent(agent="prometheus") with synthesized explanation and target outcome.
- Write to document -> write directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,

  CREATE: `
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
      { label: "Write selected creation to document", description: "Write under .sisyphus/athena/notes/{council-session-name}" },
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
- Write selected creation to document -> write directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,

  PERSPECTIVES: `
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
      { label: "Write to document", description: "Write under .sisyphus/athena/notes/{council-session-name}" },
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
- Write to document -> write directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,

  FREEFORM: `
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
      { label: "Write to document", description: "Write under .sisyphus/athena/notes/{council-session-name}" },
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
- Write to document -> write directly to ".sisyphus/athena/notes/{council-session-name}" and then report the exact path.
- Ask follow-up -> ask user then restart at Step 3.
- Done -> acknowledge and end.
</runtime_action_paths>`,
}

export function getValidCouncilIntents(): readonly CouncilIntent[] {
  return VALID_INTENTS
}

export function resolveCouncilIntent(intent?: string): CouncilIntent | null {
  if (!intent) return null
  const normalized = intent.toUpperCase()
  return (VALID_INTENTS as readonly string[]).includes(normalized)
    ? (normalized as CouncilIntent)
    : null
}

export function buildAthenaRuntimeGuidance(intent: CouncilIntent): string {
  return [
    "<athena_runtime_guidance>",
    "source: council_finalize",
    `intent: ${intent}`,
    RUNTIME_GUIDANCE_BY_INTENT[intent].trim(),
    "</athena_runtime_guidance>",
  ].join("\n\n")
}
