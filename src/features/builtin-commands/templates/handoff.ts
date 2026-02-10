export const HANDOFF_TEMPLATE = `# Handoff Command

## Purpose

Use /handoff when:
- The current session context is getting too long and quality is degrading
- You want to start fresh while preserving essential context from this session
- The context window is approaching capacity

This creates a detailed context summary that can be used to continue work in a new session.

---

# PHASE 0: VALIDATE REQUEST

Before proceeding, confirm:
- [ ] There is meaningful work or context in this session to preserve
- [ ] The user wants to create a handoff summary (not just asking about it)

If the session is nearly empty or has no meaningful context, inform the user there is nothing substantial to hand off.

---

# PHASE 1: GATHER PROGRAMMATIC CONTEXT

Execute these tools to gather concrete data:

1. session_read({ session_id: "$SESSION_ID" }) — full session history
2. todoread() — current task progress
3. Bash({ command: "git diff --stat HEAD~10..HEAD" }) — recent file changes
4. Bash({ command: "git status --porcelain" }) — uncommitted changes

Suggested execution order:

\`\`\`
session_read({ session_id: "$SESSION_ID" })
todoread()
Bash({ command: "git diff --stat HEAD~10..HEAD" })
Bash({ command: "git status --porcelain" })
\`\`\`

Analyze the gathered outputs to understand:
- What the user asked for (exact wording)
- What work was completed
- What tasks remain incomplete (include todo state)
- What decisions were made
- What files were modified or discussed (include git diff/stat + status)
- What patterns, constraints, or preferences were established

---

# PHASE 2: EXTRACT CONTEXT

Write the context summary from first person perspective ("I did...", "I told you...").

Focus on:
- Capabilities and behavior, not file-by-file implementation details
- What matters for continuing the work
- Avoiding excessive implementation details (variable names, storage keys, constants) unless critical
- USER REQUESTS (AS-IS) must be verbatim (do not paraphrase)
- EXPLICIT CONSTRAINTS must be verbatim only (do not invent)

Questions to consider when extracting:
- What did I just do or implement?
- What instructions did I already give which are still relevant (e.g. follow patterns in the codebase)?
- What files did I tell you are important or that I am working on?
- Did I provide a plan or spec that should be included?
- What did I already tell you that is important (libraries, patterns, constraints, preferences)?
- What important technical details did I discover (APIs, methods, patterns)?
- What caveats, limitations, or open questions did I find?

---

# PHASE 3: FORMAT OUTPUT

Generate a handoff summary using this exact format:

\`\`\`
HANDOFF CONTEXT
===============

USER REQUESTS (AS-IS)
---------------------
- [Exact verbatim user requests - NOT paraphrased]

GOAL
----
[One sentence describing what should be done next]

WORK COMPLETED
--------------
- [First person bullet points of what was done]
- [Include specific file paths when relevant]
- [Note key implementation decisions]

CURRENT STATE
-------------
- [Current state of the codebase or task]
- [Build/test status if applicable]
- [Any environment or configuration state]

PENDING TASKS
-------------
- [Tasks that were planned but not completed]
- [Next logical steps to take]
- [Any blockers or issues encountered]
- [Include current todo state from todoread()]

KEY FILES
---------
- [path/to/file1] - [brief role description]
- [path/to/file2] - [brief role description]
(Maximum 10 files, prioritized by importance)
- (Include files from git diff/stat and git status)

IMPORTANT DECISIONS
-------------------
- [Technical decisions that were made and why]
- [Trade-offs that were considered]
- [Patterns or conventions established]

EXPLICIT CONSTRAINTS
--------------------
- [Verbatim constraints only - from user or existing AGENTS.md]
- If none, write: None

CONTEXT FOR CONTINUATION
------------------------
- [What the next session needs to know to continue]
- [Warnings or gotchas to be aware of]
- [References to documentation if relevant]
\`\`\`

Rules for the summary:
- Plain text with bullets
- No markdown headers with # (use the format above with dashes)
- No bold, italic, or code fences within content
- Use workspace-relative paths for files
- Keep it focused - only include what matters for continuation
- Pick an appropriate length based on complexity
- USER REQUESTS (AS-IS) and EXPLICIT CONSTRAINTS must be verbatim only

---

# PHASE 4: PROVIDE INSTRUCTIONS

After generating the summary, instruct the user:

\`\`\`
---

TO CONTINUE IN A NEW SESSION:

1. Press 'n' in OpenCode TUI to open a new session, or run 'opencode' in a new terminal
2. Paste the HANDOFF CONTEXT above as your first message
3. Add your request: "Continue from the handoff context above. [Your next task]"

The new session will have all context needed to continue seamlessly.
\`\`\`

---

# IMPORTANT CONSTRAINTS

- DO NOT attempt to programmatically create new sessions (no API available to agents)
- DO provide a self-contained summary that works without access to this session
- DO include workspace-relative file paths
- DO NOT include sensitive information (API keys, credentials, secrets)
- DO NOT exceed 10 files in the KEY FILES section
- DO keep the GOAL section to a single sentence or short paragraph

---

# EXECUTE NOW

Begin by gathering programmatic context, then synthesize the handoff summary.
`
