export const RESUME_TEMPLATE = `# Resume from Handoff

## Purpose

Load the handoff context from a previous session and continue work seamlessly.

---

# PHASE 1: LOAD HANDOFF

Read the handoff file at \`.opencode/handoff.md\`.

If the file does not exist:
- Inform the user: "No handoff found at .opencode/handoff.md. Run /handoff in your current session first to save context."
- Stop here.

---

# PHASE 2: INTERNALIZE CONTEXT

Parse the handoff content and internalize:
- USER REQUESTS: What the user originally asked for
- GOAL: What should be done next
- WORK COMPLETED: What was already done (do not redo this)
- CURRENT STATE: Build status, environment, configuration
- PENDING TASKS: What still needs to be done
- KEY FILES: Important files to be aware of
- IMPORTANT DECISIONS: Technical decisions already made (follow these)
- EXPLICIT CONSTRAINTS: Rules to follow (non-negotiable)
- CONTEXT FOR CONTINUATION: Warnings, gotchas, references

---

# PHASE 3: PRESENT SUMMARY AND CONTINUE

Present a brief status to the user:

\`\`\`
Resumed from handoff.

Previous session: [1-2 sentence summary of what was done]
Pending: [1-2 sentence summary of what remains]
\`\`\`

Then:
- If $ARGUMENTS contains a specific task: Start working on that task immediately
- If PENDING TASKS exist and no specific task given: Ask the user if they want to continue with the pending tasks
- If no pending tasks and no specific task: Ask the user what they would like to work on

---

# IMPORTANT CONSTRAINTS

- DO NOT re-read files already summarized in the handoff unless you need their current content
- DO NOT re-verify or redo completed work
- DO respect all EXPLICIT CONSTRAINTS and IMPORTANT DECISIONS from the handoff
- DO treat the handoff as ground truth for what was already accomplished
- DO focus on moving forward, not looking backward
- If the handoff mentions uncommitted changes or broken builds, address those first
`
