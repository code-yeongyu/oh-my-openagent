---
description: Append a durable note to this project's omo memory file (.codebuddy/omo-memory.md), which the omo SessionStart hook injects into every new session
argument-hint: "<what to remember>"
---

<command-instruction>
Append one entry to the project memory file. Do not rewrite the file, do not
reorganize it, and do not touch unrelated sections.

1. Resolve the memory file: `.codebuddy/omo-memory.md` under ${CODEBUDDY_PROJECT_DIR}.
2. If it does not exist, create it with the header `# omo project memory`.
3. Append an entry in this exact shape, keeping the note to one or two lines of
   durable fact (a convention, a command, a decision, a trap):

````markdown
## <YYYY-MM-DD> — <short title>
<the fact, stated so a future session can act on it without asking>
````

4. Report the file path and the entry you appended. If the user's request is
   transient (a status, a one-off question), say that it does not belong in
   durable memory and skip the write.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
