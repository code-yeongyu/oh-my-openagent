import { FOLLOWUP_OR_DONE_QUESTION_BODY } from "./shared-action-paths"

export const AUDIT_GUIDANCE = `
<runtime_synthesis_rules>
Use AUDIT synthesis.
- Output numbered findings grouped by confidence: UNANIMOUS (all or nearly all members agree), MAJORITY (more than half agree), MINORITY (2-3 members), SOLO (single member).
- Each finding MUST use this exact format:

  #### #{number}: {title}
  - **Severity**: {Critical|High|Medium|Low}
  - **Confidence**: {Unanimous|Majority|Minority|Solo} ({N} members)
  - **Members Reported**: [{member1}, {member2}, ...]
  - **Issue**: {description}
  - **Evidence**: {file:line references, code snippets}
  - **Impact**: {what breaks or degrades}
  - **Fix Direction**: {concrete remediation approach}

- After all findings, include a summary table with columns: #, Finding, Severity, Agreement, Members Reported.
- End with a Priority Recommendations section grouping findings by action urgency.
- If any findings are dismissed as false positives, list them in a Dismissed section with reasoning.
</runtime_synthesis_rules>

<runtime_action_paths>
Path type: ACTIONABLE.

1) After synthesis, check for minority and solo findings (findings reported by fewer than half the council members).

2) If minority or solo findings exist, ask the user about cross-checking BEFORE processing:
Question({
  questions: [{
    question: "The audit found {N} findings with low agreement (minority/solo). Cross-checking sends these to ALL council members for independent verification. This costs one additional council round.",
    header: "Cross-check?",
    options: [
      { label: "Cross-check low-confidence findings", description: "Launch a new council round where all members evaluate the {N} minority/solo findings" },
      { label: "Skip cross-check", description: "Proceed to findings processing with current confidence levels" }
    ],
    multiple: false
  }]
})

3) If user chose cross-check:
- Build a cross-check prompt listing each minority/solo finding with its full details (ID, title, severity, evidence, fix direction).
- Use the standard council flow: prepare_council_prompt(prompt=cross_check_prompt, mode=same_mode, intent="AUDIT") -> athena_council -> background_wait -> council_finalize.
- The cross-check prompt should instruct each member: "For each finding below, independently evaluate against the codebase. For each: (1) AGREE or DISAGREE, (2) your severity rating, (3) evidence supporting your assessment. Wrap your evaluation in <COUNCIL_MEMBER_RESPONSE> tags."
- After collecting cross-check results, re-synthesize: update each cross-checked finding with the new agreement level, note changed assessments, promote/demote findings based on cross-check votes.
- Write the updated synthesis.md (overwrite the previous one in the same archive_dir).
- Include a Cross-Check Results section showing how each finding's confidence changed.

4) If no minority/solo findings exist, OR user chose to skip cross-check, proceed to processing mode:
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

5) Branch by processing mode.

Mode: One by one
- Per-finding fix options MUST be derived from the synthesis's fix directions / suggested fixes.
- Each option represents a remediation APPROACH (e.g., "Add input validation", "Refactor to use parameterized queries"), NOT an execution agent.
- NEVER use agent names (Atlas, Prometheus, Hephaestus, Sisyphus) as per-finding option labels — those belong ONLY in Step 7 (execution method).
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

6) If actionable findings count is 0 OR user selected no findings, do NOT ask execution action. Ask:
Question({
  questions: [{
    question: "No findings were selected for action. What should we do next?",
${FOLLOWUP_OR_DONE_QUESTION_BODY}

7) If selected findings exist, ask what action to take on the selected findings:
Question({
  questions: [{
    question: "How should we handle the selected findings?",
    header: "Action",
    options: [
      { label: "Fix now with (Atlas)", description: "Hand off to Atlas for task based implementation" },
      { label: "Fix now with (Hephaestus)", description: "Hand off to Hephaestus for direct implementation" },
      { label: "Fix now with (Sisyphus)", description: "Hand off to Sisyphus for collaborative implementation" },
      { label: "Create plan (Prometheus)", description: "Hand off to Prometheus for planning and phased execution" },
      { label: "No action", description: "Review only - no delegation" }
    ],
    multiple: false
  }]
})

8) Execute selected action:
- Fix now with (Atlas) -> switch_agent(agent="atlas") with ONLY selected findings
- Fix now with (Hephaestus) -> switch_agent(agent="hephaestus") with ONLY selected findings
- Fix now with (Sisyphus) -> switch_agent(agent="sisyphus") with ONLY selected findings
- Create plan (Prometheus) -> switch_agent(agent="prometheus") with ONLY selected findings
- No action -> acknowledge and end
</runtime_action_paths>`
