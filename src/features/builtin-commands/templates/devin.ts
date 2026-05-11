export const DEVIN_TEMPLATE = `# Devin Delegation Command

The user invoked \`/devin\` to delegate work to the Devin CLI as a background coworker via the \`devin\` MCP server.

---

## Your task

1. **Parse the user's request** from the \`<user-request>\` block below.
2. **If the request is empty or unclear**, ask the user what they want Devin to do. Do NOT call \`devin_start\` yet.
3. **Otherwise, delegate to Devin** using the \`devin-cli\` skill workflow:
   - Compose a self-contained prompt (Devin will not see this conversation)
   - **Analyze task complexity and select an appropriate model**:
     - 3+ files / architectural / complex debugging → \`"opus"\` or \`"gpt"\`
     - 1-2 files / moderate / general-purpose → \`"claude-sonnet-4-6"\` or \`"sonnet"\`
     - Single file / straightforward / cost-sensitive → \`"swe-1-6"\` or \`"swe"\`
     - Code generation / boilerplate → \`"codex"\`
   - Call \`devin_start({ prompt, model, cwd, permission_mode: "auto" })\`
   - Save the returned \`session_id\`
4. **Tell the user**:
   - The chosen model and why (one line)
   - The session ID
   - That Devin is running in the background
5. **Offer next steps**: poll status, wait for completion, or cancel.

---

## Optional flags in the user request

The user may include hints in their request:

- \`--model=<name>\` → override your model selection (e.g. \`--model=opus\`)
- \`--wait\` → block on \`devin_wait\` after starting and report the final result inline
- \`--cwd=<path>\` → run Devin in a different directory

Parse and respect these flags. If \`--wait\` is set, after \`devin_start\` immediately call \`devin_wait\` with a sensible \`timeout_ms\` (60s for simple tasks, 300s for complex) and report the final output.

---

## Anti-patterns

- Do NOT delegate trivial tasks you can do in one or two tool calls.
- Do NOT pass conversation transcripts as the Devin prompt — distill to a clear brief.
- Do NOT spawn duplicate sessions — call \`devin_list\` if unsure.
- Do NOT use \`permission_mode: "dangerous"\` unless the user explicitly asks.

---

## Example response

User: \`/devin refactor src/auth/session.ts to use the new TokenStore interface\`

You:
1. Analyze: 1-2 files, moderate complexity → \`claude-sonnet-4-6\`
2. \`devin_start({ prompt: "<self-contained brief>", model: "claude-sonnet-4-6" })\` → \`session_id "abc-123"\`
3. Reply: "Started Devin (session abc-123, model claude-sonnet-4-6) on the session refactor. I picked claude-sonnet-4-6 because this is a focused 1-2 file change with moderate complexity. Use \`/devin-status\` to check progress."
`

export const DEVIN_MODELS_TEMPLATE = `# Devin Model Selector

The user invoked \`/devin-models\` to see available Devin models and their use cases.

---

## Your task

Render this reference as your reply, with no additional preamble:

\`\`\`
Devin CLI — Available Models

## TIER 1: Premium (Best for complex work)

| Model             | Speed | Cost   | Best For                                                          | Examples                                      |
|-------------------|-------|--------|-------------------------------------------------------------------|-----------------------------------------------|
| opus              | Slow  | High   | Multi-file refactors, architecture changes, deep reasoning         | "Redesign the auth module across 15 files"    |
| gpt / gpt-5.5     | Med   | High   | Complex refactors, cross-file changes, strong reasoning           | "Update all API calls to new error pattern"   |

## TIER 2: Balanced (Good default for most tasks)

| Model             | Speed | Cost   | Best For                                                          | Examples                                      |
|-------------------|-------|--------|-------------------------------------------------------------------|-----------------------------------------------|
| claude-sonnet-4-6 | Med   | Med    | General-purpose, moderate complexity, balanced speed/cost         | "Add tests for the auth module"               |
| sonnet            | Med   | Med    | General-purpose, moderate complexity (alias)                        | "Review this PR for issues"                   |

## TIER 3: Fast & Cheap (Best for simple tasks)

| Model             | Speed | Cost   | Best For                                                          | Examples                                      |
|-------------------|-------|--------|-------------------------------------------------------------------|-----------------------------------------------|
| swe / swe-1-6     | Fast  | Low    | Quick edits, bug fixes, single-file tasks, README updates          | "Fix typo on line 42", "List files in src"    |
| codex             | Fast  | Low    | Code generation, boilerplate, repetitive patterns                  | "Generate a CRUD API for User model"          |

## Quick Selection Guide

1. Count files touched:
   - 1 file / simple       → swe-1-6 (default for auto-delegate)
   - 1-2 files / moderate  → claude-sonnet-4-6
   - 3+ files / complex    → opus or gpt

2. Consider urgency:
   - User waiting / quick check    → swe-1-6
   - Background / can wait         → opus (better quality)

3. Consider cost:
   - Many small tasks              → swe-1-6 consistently
   - One critical task             → opus (worth the cost)

## Usage

  /devin <task>                         # auto-select model (recommended)
  /devin <task> --model=opus            # force premium model
  /devin <task> --model=swe-1-6         # force cheap/fast model
  /devin <task> --wait                  # block until completion
  /devin <task> --cwd=/path/to/repo     # run in different directory

## Default Model

When no model is specified, Devin uses the user's configured default (typically "swe-1-6" for cost-efficiency). The auto-delegate system also defaults to "swe-1-6" for simple tasks.
\`\`\`

If the user asked a question alongside the command (in the \`<user-request>\` block), answer it after rendering the table.
`

export const DEVIN_STATUS_TEMPLATE = `# Devin Status Command

The user invoked \`/devin-status\` to check on running Devin sessions.

---

## Your task

1. Call \`devin_list({ include_output: true })\` to enumerate all sessions in the current MCP server process.
2. If there are no sessions, tell the user "No active Devin sessions." and stop.
3. Otherwise, for each session render a compact summary:
   - Session ID (short form: first 8 chars)
   - Status (running / completed / error / cancelled)
   - Duration
   - Model (if known)
   - One-line prompt preview
4. If the user passed a specific session id in the \`<user-request>\` block (e.g. \`/devin-status abc-123\`), call \`devin_status({ session_id, tail_bytes: 16384 })\` for that session and render the full tail.
5. End with a hint: "Use \`/devin-cancel <id>\` to stop a session, or \`/devin-status <id>\` for full output."

---

## Optional flag

- \`--full\` → render full output (tail_bytes: 65536) for every session, not just the targeted one.
`

export const DEVIN_CANCEL_TEMPLATE = `# Devin Cancel Command

The user invoked \`/devin-cancel\` to stop one or more Devin sessions.

---

## Your task

1. **If the user passed a session id** in the \`<user-request>\` block (e.g. \`/devin-cancel abc-123\` or a partial prefix):
   - Call \`devin_list()\` to find the matching session id (allow prefix match — pick the unique session whose id starts with the provided string)
   - If no match, tell the user and stop.
   - If multiple matches, list them and ask the user to disambiguate.
   - Otherwise, call \`devin_cancel({ session_id })\` and report the result.
2. **If the user passed \`--all\`**, cancel every running session:
   - Call \`devin_list()\`
   - For each session with \`status: "running"\`, call \`devin_cancel({ session_id })\`
   - Report a summary of how many were cancelled.
3. **If the user passed nothing**, render the running sessions and ask which to cancel:
   - Call \`devin_list({ include_output: false })\`
   - List running sessions (id + prompt preview)
   - Wait for the user's reply.

---

## Anti-pattern

Never silently cancel multiple sessions when the user only asked about one. Confirm intent on \`--all\`.
`
