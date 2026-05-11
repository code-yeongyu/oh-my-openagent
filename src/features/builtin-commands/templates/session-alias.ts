export const SESSION_ALIAS_TEMPLATE = `# Session Alias Command

The user invoked \`/session-alias\` to manage friendly names for OpenCode session IDs.

Aliases are stored in \`<project>/.opencode/session-aliases.json\` and resolved transparently
by \`session_read\`, \`session_info\`, and \`session_search\` (when given an identifier
that does NOT start with \`ses_\`).

---

## Subcommands

Parse the \`<user-request>\` block for one of:

- \`create <alias> <session-id-or-prefix> [--note="..."] [--overwrite]\`
- \`list\` (default if no subcommand given)
- \`delete <alias>\`

### create

1. If \`<session-id-or-prefix>\` does not already start with \`ses_\`, call \`session_list\` and
   find the unique session whose ID starts with the provided string. If zero or multiple
   matches, ask the user to clarify and stop.
2. Call \`session_alias_create({ alias, session_id, note?, overwrite? })\`.
3. Echo the result to the user.

### list

1. Call \`session_alias_list({})\`.
2. Render the markdown response as-is.

### delete

1. Call \`session_alias_delete({ alias })\`.
2. Confirm the deletion to the user.

---

## Examples

- \`/session-alias\` → list all aliases
- \`/session-alias create auth-refactor ses_1e95074dcffe\` → create alias (prefix expanded)
- \`/session-alias create bug-fix ses_abc... --note="root cause investigation"\`
- \`/session-alias delete auth-refactor\`

---

## Anti-patterns

- Do NOT call \`session_alias_create\` with \`skip_existence_check=true\` unless the user
  explicitly asks for it (e.g. the session lives in SQLite-only storage).
- Do NOT silently overwrite an existing alias. If \`session_alias_create\` returns the
  "already exists" error, ask the user before retrying with \`overwrite=true\`.
`
