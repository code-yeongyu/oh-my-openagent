import { FOLLOWUP_OR_DONE_QUESTION_BODY } from "./shared-action-paths"

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
- Per-finding fix options MUST be derived from the synthesis's fix directions / suggested fixes.
- Each option represents a remediation APPROACH (e.g., "Add input validation", "Refactor to use parameterized queries"), NOT an execution agent.
- NEVER use agent names (Atlas, Prometheus, Hephaestus, Sisyphus) as per-finding option labels — those belong ONLY to Step 5 (execution method).
- Handle variable fix counts per finding:
  - If a finding has NO fix suggestion from synthesis -> show only Skip / Defer / Stop review.
  - If a finding has exactly ONE fix suggestion -> show that fix + Skip / Defer / Stop review.
  - If a finding has MULTIPLE fix suggestions -> show each as a labeled option + Skip / Defer / Stop review.
- Process findings in batches using ONE Question call per batch.
- Default batch size: 3 findings per batch.
- Hard cap: 5 findings only when findings are short and options are limited.
- Example Question tool call (batch of 3 findings — showing all 3 cases):
Question({
  questions: [
    {
      question: "Finding #10: SQL injection in user search — choose how to proceed.",
      header: "#10 Action",
      options: [
        { label: "Add input validation", description: "Pattern-based sanitization at the controller layer (from synthesis)" },
        { label: "Use parameterized queries", description: "Refactor raw SQL to prepared statements (from synthesis)" },
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    },
    {
      question: "Finding #11: Missing rate limiter on /api/auth — choose how to proceed.",
      header: "#11 Action",
      options: [
        { label: "Add rate limiting middleware", description: "Express-rate-limit on auth endpoints (from synthesis)" },
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    },
    {
      question: "Finding #12: Outdated dependency detected (low confidence) — choose how to proceed.",
      header: "#12 Action",
      options: [
        { label: "Skip", description: "Do not act on this finding now" },
        { label: "Defer", description: "Keep for later" },
        { label: "Stop review", description: "End one-by-one processing" }
      ],
      multiple: false
    }
  ]
})
- IMPORTANT: The labels above ("Add input validation", "Use parameterized queries", etc.) are EXAMPLES. Use the ACTUAL fix approaches from your synthesis.
- Anti-pattern: Do NOT use "Fix now (Atlas)" or "Create plan (Prometheus)" as per-finding options. Those are execution methods and belong ONLY in Step 5.
- Keep free-form answers enabled (user may type custom choices like "#10:A, #11:skip"). Parse them. Use stable short IDs (e.g., first letter of each fix label) so free-form input remains parseable even with descriptive labels.
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
${FOLLOWUP_OR_DONE_QUESTION_BODY}

5) If selected findings exist, ask what action to take on the selected findings:
Question({
  questions: [{
    question: "How should we handle the selected findings?",
    header: "Action",
    options: [
      { label: "Fix now with (Atlas)", description: "Hand off to Atlas for task based implementation" },
      { label: "Fix now with (Hephaestus)", description: "Hand off to Hephaestus for direct implementation" },
      { label: "Fix now with (Sisyphus)", description: "Hand off to Sisyphus for collaborative implementation" },
      { label: "Create plan (Prometheus)", description: "Hand off to Prometheus for planning and phased execution" },
      { label: "Cross-check with council", description: "Launch a new council session with this synthesis as context" },
      { label: "No action", description: "Review only - no delegation" }
    ],
    multiple: false
  }]
})

6) Execute selected action:
- Fix now with (Atlas) -> switch_agent(agent="atlas") with ONLY selected findings
- Fix now with (Hephaestus) -> switch_agent(agent="hephaestus") with ONLY selected findings
- Fix now with (Sisyphus) -> switch_agent(agent="sisyphus") with ONLY selected findings
- Create plan (Prometheus) -> switch_agent(agent="prometheus") with ONLY selected findings
- Cross-check with council -> launch a new council session with the current synthesis as context. Restart from Step 2 (council setup) with the synthesis included in the prompt.
- No action -> acknowledge and end
</runtime_action_paths>`
