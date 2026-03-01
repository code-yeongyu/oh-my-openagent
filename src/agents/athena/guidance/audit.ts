export const AUDIT_GUIDANCE = `
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
</runtime_action_paths>`
