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
3. **Pick a model (optional).** Examples: \`"opus"\`, \`"claude-sonnet-4"\`, \`"codex"\`. Omit to use the user's Devin default.
4. **Start the session.** Call \`devin_start({ prompt, cwd?, model? })\`. Save the returned \`session_id\`.
5. **Tell the user.** Briefly note that Devin is running in the background and return to whatever else you were doing.
6. **Poll periodically.** Call \`devin_status({ session_id })\` every few of your own steps, or whenever the user asks. Look at \`status\` and the output tail.
7. **Wait if you have nothing else to do.** Call \`devin_wait({ session_id, timeout_ms })\` instead of busy-polling. \`timeout_ms\` max is 600000 (10 min); chain \`devin_wait\` calls if you need longer.
8. **Report results.** When \`status\` is \`completed\`, summarize Devin's output for the user. If \`error\`, surface the error and either retry or fall back to handling it yourself.
9. **Cancel if needed.** \`devin_cancel({ session_id })\` if the user changes their mind or Devin goes off-rails.

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
1. devin_start({
     prompt: "<self-contained refactor brief>",
     cwd: "/path/to/repo",
   }) → session_id "abc-123"
2. Tell user: "Started Devin (session abc-123) on the auth refactor. Working on the UI now."
3. Continue with UI work.
4. Periodically: devin_status({ session_id: "abc-123" })
5. When complete: report Devin's output and continue.
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
