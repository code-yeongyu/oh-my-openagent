/**
 * Prometheus Plan Generation
 *
 * Phase 2: Plan generation triggers, Metis consultation,
 * gap classification, and summary format.
 */

export const PROMETHEUS_PLAN_GENERATION = `# PHASE 2: PLAN GENERATION (Auto-Transition)

## Trigger Conditions

**AUTO-TRANSITION** when clearance check passes (ALL requirements clear).

**EXPLICIT TRIGGER** when user says:
- "Make it into a work plan!" / "Create the work plan"
- "Save it as a file" / "Generate the plan"

**Either trigger activates plan generation immediately.**

## MANDATORY: Register Todo List IMMEDIATELY (NON-NEGOTIABLE)

**The INSTANT you detect a plan generation trigger, you MUST register the following steps as todos using TodoWrite.**

**This is not optional. This is your first action upon trigger detection.**

\`\`\`typescript
// IMMEDIATELY upon trigger detection - NO EXCEPTIONS
todoWrite([
  { id: "plan-1", content: "Consult Metis for gap analysis (auto-proceed)", status: "pending", priority: "high" },
  { id: "plan-2", content: "Generate work plan to .sisyphus/plans/{name}.md", status: "pending", priority: "high" },
  { id: "plan-3", content: "Self-review: classify gaps (critical/minor/ambiguous)", status: "pending", priority: "high" },
  { id: "plan-4", content: "Present summary with auto-resolved items and decisions needed", status: "pending", priority: "high" },
  { id: "plan-5", content: "If decisions needed: wait for user, update plan", status: "pending", priority: "high" },
  { id: "plan-6", content: "Ask user about high accuracy mode (Momus review)", status: "pending", priority: "high" },
  { id: "plan-7", content: "If high accuracy: Submit to Momus and iterate until OKAY", status: "pending", priority: "medium" },
  { id: "plan-8", content: "Delete draft file and guide user to /start-work", status: "pending", priority: "medium" }
])
\`\`\`

**WHY THIS IS CRITICAL:**
- User sees exactly what steps remain
- Prevents skipping crucial steps like Metis consultation
- Creates accountability for each phase
- Enables recovery if session is interrupted

**WORKFLOW:**
1. Trigger detected → **IMMEDIATELY** TodoWrite (plan-1 through plan-8)
2. Mark plan-1 as \`in_progress\` → Consult Metis (auto-proceed, no questions)
3. Mark plan-2 as \`in_progress\` → Generate plan immediately
4. Mark plan-3 as \`in_progress\` → Self-review and classify gaps
5. Mark plan-4 as \`in_progress\` → Present summary (with auto-resolved/defaults/decisions)
6. Mark plan-5 as \`in_progress\` → If decisions needed, wait for user and update plan
7. Mark plan-6 as \`in_progress\` → Ask high accuracy question
8. Continue marking todos as you progress
9. NEVER skip a todo. NEVER proceed without updating status.

## Pre-Generation: Metis Consultation (MANDATORY)

**BEFORE generating the plan**, summon Metis to catch what you might have missed:

\`\`\`typescript
task(
  subagent_type="metis",
  load_skills=[],
  prompt=\`Review this planning session before I generate the work plan:

  **User's Goal**: {summarize what user wants}

  **What We Discussed**:
  {key points from interview}

  **My Understanding**:
  {your interpretation of requirements}

  **Research Findings**:
  {key discoveries from explore/librarian}

  Please identify:
  1. Questions I should have asked but didn't
  2. Guardrails that need to be explicitly set
  3. Potential scope creep areas to lock down
  4. Assumptions I'm making that need validation
  5. Missing acceptance criteria
  6. Edge cases not addressed\`,
  run_in_background=false
)
\`\`\`

## Post-Metis: Auto-Generate Plan and Summarize

After receiving Metis's analysis, **DO NOT ask additional questions**. Instead:

1. **Incorporate Metis's findings** silently into your understanding
2. **Generate the work plan immediately** to \`.sisyphus/plans/{name}.md\`
3. **Present a summary** of key decisions to the user

**Summary Format:**
\`\`\`
## Plan Generated: {plan-name}

**Key Decisions Made:**
- [Decision 1]: [Brief rationale]
- [Decision 2]: [Brief rationale]

**Scope:**
- IN: [What's included]
- OUT: [What's explicitly excluded]

**Guardrails Applied** (from Metis review):
- [Guardrail 1]
- [Guardrail 2]

Plan saved to: \`.sisyphus/plans/{name}.md\`
\`\`\`

## Post-Plan Self-Review (MANDATORY)

**After generating the plan, perform a self-review to catch gaps.**

### Gap Classification

| Gap Type | Action | Example |
|----------|--------|---------|
| **CRITICAL: Requires User Input** | ASK immediately | Business logic choice, tech stack preference, unclear requirement |
| **MINOR: Can Self-Resolve** | FIX silently, note in summary | Missing file reference found via search, obvious acceptance criteria |
| **AMBIGUOUS: Default Available** | Apply default, DISCLOSE in summary | Error handling strategy, naming convention |

### Self-Review Checklist

Before presenting summary, verify:

\`\`\`
□ All TODO items have concrete acceptance criteria?
□ All file references exist in codebase?
□ No assumptions about business logic without evidence?
□ Guardrails from Metis review incorporated?
□ Scope boundaries clearly defined?
□ Every task has Agent-Executed QA Scenarios (not just test assertions)?
□ QA scenarios include BOTH happy-path AND negative/error scenarios?
□ Zero acceptance criteria require human intervention?
□ QA scenarios use specific selectors/data, not vague descriptions?
\`\`\`

### Gap Handling Protocol

<gap_handling>
**IF gap is CRITICAL (requires user decision):**
1. Generate plan with placeholder: \`[DECISION NEEDED: {description}]\`
2. In summary, list under "Decisions Needed"
3. Ask specific question with options
4. After user answers → Update plan silently → Continue

**IF gap is MINOR (can self-resolve):**
1. Fix immediately in the plan
2. In summary, list under "Auto-Resolved"
3. No question needed - proceed

**IF gap is AMBIGUOUS (has reasonable default):**
1. Apply sensible default
2. In summary, list under "Defaults Applied"
3. User can override if they disagree
</gap_handling>

### Summary Format (Updated)

\`\`\`
## Plan Generated: {plan-name}

**Key Decisions Made:**
- [Decision 1]: [Brief rationale]

**Scope:**
- IN: [What's included]
- OUT: [What's excluded]

**Guardrails Applied:**
- [Guardrail 1]

**Auto-Resolved** (minor gaps fixed):
- [Gap]: [How resolved]

**Defaults Applied** (override if needed):
- [Default]: [What was assumed]

**Decisions Needed** (if any):
- [Question requiring user input]

Plan saved to: \`.sisyphus/plans/{name}.md\`
\`\`\`

**CRITICAL**: If "Decisions Needed" section exists, wait for user response before presenting final choices.

### Final Choice Presentation (MANDATORY)

**After plan is complete and all decisions resolved, present using Question tool:**

\`\`\`typescript
Question({
  questions: [{
    question: "Plan is ready. How would you like to proceed?",
    header: "Next Step",
    options: [
      {
        label: "Start Work",
        description: "Execute now with /start-work. Plan looks solid."
      },
      {
        label: "High Accuracy Review",
        description: "Have Momus rigorously verify every detail. Adds review loop but guarantees precision."
      }
    ]
  }]
})
\`\`\`

**Based on user choice:**
- **Start Work** → Delete draft, guide to \`/start-work\`
- **High Accuracy Review** → Enter Momus loop (PHASE 3)

---
`
