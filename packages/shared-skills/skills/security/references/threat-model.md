# Threat model: six lines before the first edit

Write these into the plan, in this order, for any change that touches a trust boundary. Each line is a list of concrete nouns from this repository, not a category name. The procedure is adapted from the `dev-security` skill of lidge-jun/codexclaw (MIT).

1. **Assets.** What the attacker would want: accounts, sessions, payment state, admin actions, uploaded files, secrets, personal data, audit logs, build artifacts, the agent's own credentials and config.
2. **Entry points.** Where input arrives: forms, URLs, headers, cookies, API routes, webhooks, uploads, queues, CLI arguments, prompts, tool calls, MCP tool results, CI jobs, files the agent reads.
3. **Trust boundaries.** The lines where trust changes: browser to API, public API to internal service, application to database, agent prompt to tool execution, retrieved text to the model, CI runner to production artifact, one tenant to another.
4. **Attacker capability.** Who is on the other side of each boundary: an anonymous user, an authenticated user, a peer tenant, a malicious insider, a compromised browser, a compromised CI runner, a poisoned dependency, a hostile web page or tool result the agent will read.
5. **Assumptions.** What the design relies on and what shows each one holds: the identity source, the tenant model, the data sensitivity, whether this surface is runtime or dev tooling, the deployment environment, who can reach the agent's config directory.
6. **Controls.** For each boundary: validation at entry, authentication and authorization, rate limits, isolation, logging with redaction, secret handling, scans, and the tests that prove each control.

When an assumption decides the severity and you cannot confirm it from the repository, ask one question before building. When the change touches auth, payment, uploads, logging, or personal data, write the must-pass checks (the tests and the manual probes) after the model and before the code, so the implementation is measured against them instead of the other way round.

## What the model is for

The model chooses the controls. A login change needs the authentication rows and nothing about uploads; an upload handler needs path, type and size validation, storage isolation and a scan, and nothing about sessions. The review at the end walks the same six lines and marks each boundary covered or open, which is why the model is written down rather than kept in mind.

## Agent-specific boundaries

An agent harness adds boundaries ordinary web threat models leave out, and omo has every one of them:

- Prompt to tool: the model decides to run a command or edit a file on the strength of text it read. A tool result, a web page, a file in the repository, and a skill's instructions are all inputs at this boundary.
- Config to execution: `omo.json`, MCP server entries, hooks, skill directories and agent definitions are executable configuration; whoever writes them runs code as the user.
- Agent to credentials: the agent holds the user's tokens for the forge, the cloud, the model providers. Any path that prints, logs or sends them is an exfiltration path.
- Agent to the rest of the machine: shell access reaches everything the user can reach; the deny list for destructive commands and the sandbox boundaries are controls, and a change that widens them is security-sensitive.
