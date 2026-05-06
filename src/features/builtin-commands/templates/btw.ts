export const BTW_TEMPLATE = `# BTW Command

## Purpose

Use /btw when:
- The user has a quick side question that should not pollute the main conversation
- The user wants a fast answer without derailing the current task or todo list
- The user wants the answer to be reasoned out in a separate context, then summarized back

The side question MUST NOT be added to the active todo list, plan, or main task tracking. After answering, the main task flow continues unchanged.

---

# PHASE 0: VALIDATE REQUEST

Before proceeding, confirm:
- [ ] The user provided a non-empty question after /btw
- [ ] The question is a side question, not a redefinition of the main task

If the arguments are empty or only whitespace, respond with a short usage hint and stop:

\`\`\`
Usage: /btw <question>
Example: /btw what does this regex match?
\`\`\`

Do NOT create todos, do NOT modify plans, do NOT touch the working tree for an empty /btw invocation.

---

# PHASE 1: ISOLATE THE SIDE QUESTION

The side question is the verbatim user input below. Treat it as an isolated request:

- Do NOT add it to the existing todo list
- Do NOT mark any current todo as in_progress, completed, or cancelled because of it
- Do NOT change branch, files, or build state because of it
- Do NOT use it to revise the main task interpretation

Capture the side question exactly as written.

---

# PHASE 2: DELEGATE TO A SEPARATE SESSION

Delegate the side question to a fresh subagent session so the main session context stays clean.

Use the task tool with these parameters:
- category: "quick" for short factual or local code questions; "unspecified-low" for slightly broader questions; "deep" only when the user explicitly asks for thorough investigation
- run_in_background: false (the user is waiting for a synchronous answer)
- load_skills: [] unless a skill clearly matches the question domain
- description: short label like "Side question: <topic>"
- prompt: a self-contained prompt that includes:
  - The verbatim side question
  - A directive that this is an isolated side question with no side effects
  - Required output format (concise direct answer, no preamble, no flattery)
  - Forbidden actions: do not commit, do not edit files, do not create todos

Suggested prompt skeleton:

\`\`\`
This is an isolated side question. Do not modify files, do not commit,
do not create todos, do not run long-running tasks. Read-only investigation
is allowed. Answer concisely.

Side question (verbatim):
<verbatim user question>

Output format:
- One short answer first (1-3 sentences when possible)
- Then up to 5 bullet points of supporting detail if useful
- No preamble, no apologies, no follow-up offers
\`\`\`

If the question is trivially answerable from existing knowledge with no exploration needed, you MAY answer directly without delegation. In that case, still keep the answer short and skip todo updates.

---

# PHASE 3: RELAY THE ANSWER

When the subagent returns:

- Forward the answer to the user as-is, lightly trimmed of any duplicated preamble
- Prefix the answer with a single line: \`Side answer (not added to main task):\`
- Do not summarize the delegation process itself
- Do not add a "let me know if you want me to" closer

---

# PHASE 4: RETURN TO MAIN TASK

After the answer is delivered, on a new line append exactly:

\`\`\`
Resuming main task.
\`\`\`

Do not restart, replan, or summarize the main task unless the user explicitly asks. The main todo list and plan remain untouched.

---

# IMPORTANT CONSTRAINTS

- DO NOT add the side question to the todo list
- DO NOT modify files, branches, or commits because of /btw
- DO NOT run long background tasks for /btw
- DO NOT echo the original side question back unless quoting briefly is necessary
- DO keep the answer focused and short by default
- DO use task delegation when the question requires any non-trivial investigation
- DO answer directly without delegation only when the question is trivial

---

# EXECUTE NOW

Read the user request below as the side question. Validate, delegate when needed, relay the answer, then resume the main task.
`
