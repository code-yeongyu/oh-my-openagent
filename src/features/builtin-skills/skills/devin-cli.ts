import type { BuiltinSkill } from "../types"

export const devinCliSkill: BuiltinSkill = {
  name: "devin-cli",
  description:
    "Delegate tasks to the Devin CLI as a background coworker. Use when the user asks to hand off work to Devin, leverage their Devin/Windsurf subscription, or run a long task in parallel.",
  argumentHint: "<task description>",
  template: `# Devin CLI Delegation

You can delegate self-contained engineering tasks to the \`devin\` CLI as a background subprocess via the \`devin\` MCP server. The MCP server is registered at the repo root in \`.mcp.json\` and exposes 5 tools.

---

## When to delegate

Delegate to Devin when ANY of the following holds:

- The user explicitly asks ("delegate this to Devin", "use my Devin subscription", "hand off to Devin")
- The task is long-running, self-contained, and can proceed without your continuous attention (e.g. "refactor module X to use the new API", "write tests for file Y", "investigate why the build is slow")
- You want to parallelize: spawn Devin on subtask B while you work on subtask A
- The user wants to leverage a Devin-only model not available in the active provider

DO NOT delegate when:

- The task requires real-time back-and-forth with the user
- You can do it yourself in a few tool calls
- The task touches the same files you are about to edit (avoid merge conflicts)
- You have no actionable prompt yet — clarify with the user first

---

## Tools (provided by the \`devin\` MCP server)

| Tool | Purpose | Key arguments |
|------|---------|---------------|
| \`devin_start\` | Spawn \`devin -p <prompt>\` in the background | \`prompt\` (required), \`model?\`, \`cwd?\`, \`permission_mode?\` (\`auto\` \\| \`dangerous\`), \`resume?\` |
| \`devin_status\` | Get current status + tail of stdout/stderr log | \`session_id\`, \`tail_bytes?\` (default 8192) |
| \`devin_wait\` | Block until exit or timeout | \`session_id\`, \`timeout_ms?\` (default 60000), \`tail_bytes?\` |
| \`devin_cancel\` | Kill the background subprocess | \`session_id\` |
| \`devin_list\` | Enumerate sessions in this MCP process | \`include_output?\` |

Each tool returns a human-readable text snapshot. \`session_id\` is a UUID — store it; you will need it for every subsequent call.

---

## Standard workflow

1. **Compose a self-contained prompt.** Devin will not see your conversation history. The prompt must contain everything Devin needs: goal, constraints, file paths, acceptance criteria. Treat it like delegating to a remote engineer.
2. **Pick a working directory.** Default is the MCP server cwd (this repo). Pass \`cwd\` explicitly if Devin should run in a sibling project.
3. **Pick a model intelligently (optional).** Analyze the task and select the right model. Omit to use the user's Devin default (typically \`"swe-1-6"\`).
4. **Start the session.** Call \`devin_start({ prompt, cwd?, model? })\`. Save the returned \`session_id\`.
5. **Tell the user.** Briefly note that Devin is running in the background and return to whatever else you were doing.
6. **Poll periodically.** Call \`devin_status({ session_id })\` every few of your own steps, or whenever the user asks. Look at \`status\` and the output tail.
7. **Wait if you have nothing else to do.** Call \`devin_wait({ session_id, timeout_ms })\` instead of busy-polling. \`timeout_ms\` max is 600000 (10 min); chain \`devin_wait\` calls if you need longer.
8. **Report results.** When \`status\` is \`completed\`, summarize Devin's output for the user. If \`error\`, surface the error and either retry or fall back to handling it yourself.
9. **Cancel if needed.** \`devin_cancel({ session_id })\` if the user changes their mind or Devin goes off-rails.

---

## Model selection guidelines

Devin does not auto-select models — you must choose based on task analysis. Think like a smart engineer: match model capability to task complexity, time sensitivity, and cost.

### Decision framework

Ask yourself these questions to pick the right model:

1. **Task complexity**: Is this a multi-file refactor with deep architectural implications, or a straightforward single-file edit?
2. **Reasoning depth**: Does the task require tracing dependencies, understanding abstractions, or making design decisions?
3. **Time sensitivity**: Is the user waiting for results, or can this run in the background?
4. **Cost tolerance**: Is this a critical task worth spending tokens on, or a quick check?

### Model recommendations

| Model | Use when | Examples | Trade-offs |
|-------|----------|----------|------------|
| \`"opus"\` | Multi-file refactors, architecture changes, deep reasoning, complex debugging | "Refactor the auth module to use the new TokenStore interface", "Investigate why the build is slow and fix it", "Redesign the data layer for performance" | Highest capability, highest cost, slower |
| \`"gpt"\` or \`"gpt-5.5"\` | Complex refactors, cross-file changes, tasks requiring strong reasoning | "Update all API calls to use the new error handling pattern", "Refactor the state management to use the new library" | High capability, high cost, good balance |
| \`"claude-sonnet-4-6"\` | General-purpose tasks, moderate complexity, balanced speed/cost | "Add tests for the auth module", "Update the README with the new deployment steps", "Fix the failing test in src/auth" | Balanced capability and cost, good default for most tasks |
| \`"codex"\` | Code generation, boilerplate, repetitive patterns | "Generate a CRUD API for the User model", "Create unit tests for all service methods", "Write TypeScript types for the API response" | Fast for generation, less strong on reasoning |
| \`"swe"\` or \`"swe-1-6"\` | Straightforward edits, bug fixes, quick questions, cost-sensitive tasks | "Fix the typo in the error message", "Update the import statement", "Why is this test failing?" | Fast, cheap, good for simple tasks |
| \`"sonnet"\` | General-purpose, moderate complexity | "Review this PR for issues", "Explain how this code works" | Balanced, similar to claude-sonnet-4-6 |

### Heuristics

Use these rules of thumb:

- **3+ files or architectural impact** → \`"opus"\` or \`"gpt"\`
- **1-2 files, moderate complexity** → \`"claude-sonnet-4-6"\` or \`"sonnet"\`
- **Single file, straightforward** → \`"swe"\` or \`"swe-1-6"\`
- **Code generation from scratch** → \`"codex"\`
- **User is waiting, time-sensitive** → favor faster models (\`"swe"\`, \`"codex"\`) even if less capable
- **Critical correctness required** → favor stronger models (\`"opus"\`, \`"gpt"\`) even if slower
- **Cost-sensitive, many small tasks** → use \`"swe"\` consistently

### When to omit the model

Omit \`model\` and let Devin use the user's configured default when:

- The task is routine and the default model is sufficient
- The user hasn't expressed a preference
- You're unsure — the user's default is their preferred baseline

### Examples

**Task**: "Refactor the entire auth module to use the new TokenStore interface across 15 files."
→ **Model**: \`"opus"\` (multi-file, architectural, deep reasoning)

**Task**: "Fix the typo in the error message on line 42."
→ **Model**: \`"swe"\` or omit (single file, straightforward)

**Task**: "Generate unit tests for all service methods in src/services/."
→ **Model**: \`"codex"\` (code generation, repetitive pattern)

**Task**: "Update the README with the new deployment steps."
→ **Model**: \`"claude-sonnet-4-6"\` (moderate complexity, documentation)

**Task**: "Investigate why the build is failing and fix it."
→ **Model**: \`"gpt"\` or \`"opus"\` (debugging, potentially complex)

---

## Prompt-writing rules for Devin

- Start with a one-line goal.
- Provide absolute file paths (relative-to-repo also works since \`cwd\` is set).
- List acceptance criteria explicitly: tests pass, lint clean, etc.
- State what NOT to do (e.g. "do not modify the build config").
- Ask Devin to commit only if the user wants it; otherwise say "do not commit".
- Keep it under ~2000 characters when possible — long prompts work but cost tokens.

Example prompt:

\`\`\`
Refactor src/auth/session.ts to use the new TokenStore interface from src/auth/token-store.ts.
- Replace all direct cookie reads with TokenStore.get()
- Update src/auth/session.test.ts accordingly
- Run \`bun test src/auth\` and confirm it passes
- Do NOT commit. Do NOT touch any other file.
- When done, print a summary of changed files and remaining concerns.
\`\`\`

---

## Anti-patterns

- **Don't spawn duplicate sessions for the same task.** Check \`devin_list\` first if unsure.
- **Don't pass conversation transcripts as the prompt.** Distill to a clear, self-contained brief.
- **Don't poll in a tight loop.** Wait 5–15 seconds between \`devin_status\` calls or use \`devin_wait\`.
- **Don't \`permission_mode: "dangerous"\`** unless the user explicitly grants it for this task.
- **Don't forget to cancel.** Stale background sessions waste subscription budget.

---

## Example interactions

### User: "Delegate the auth refactor to Devin while you work on the UI."

\`\`\`
1. Analyze task: multi-file refactor with architectural impact → choose "opus"
2. devin_start({
     prompt: "<self-contained refactor brief>",
     cwd: "/path/to/repo",
     model: "opus",
   }) → session_id "abc-123"
3. Tell user: "Started Devin (session abc-123, model opus) on the auth refactor. Working on the UI now."
4. Continue with UI work.
5. Periodically: devin_status({ session_id: "abc-123" })
6. When complete: report Devin's output and continue.
\`\`\`

### User: "Ask Devin to fix the typo in the error message."

\`\`\`
1. Analyze task: single-file, straightforward → use "swe" or omit
2. devin_start({
     prompt: "Fix the typo in the error message on line 42 of src/errors.ts",
     cwd: "/path/to/repo",
     model: "swe",
   }) → session_id "def-456"
3. Tell user: "Started Devin (session def-456, model swe) on the typo fix."
4. devin_wait({ session_id: "def-456" })
5. Report: "Devin fixed the typo. Here's the change: ..."
\`\`\`

### User: "How is Devin doing?"

\`\`\`
1. devin_list({ include_output: true }) — find active session(s)
2. devin_status({ session_id, tail_bytes: 16384 }) — get fuller output
3. Summarize status + any blockers.
\`\`\`

### User: "Stop Devin."

\`\`\`
1. devin_list() — confirm session id
2. devin_cancel({ session_id })
3. Confirm to user.
\`\`\`
`,
}
