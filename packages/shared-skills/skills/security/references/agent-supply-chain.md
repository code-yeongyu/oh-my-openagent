# Agent supply chain: MCP servers, skills, hooks and AI-suggested dependencies

An MCP server runs as the user with whatever the harness grants it. A skill is instructions the model follows. A hook runs on every matching event. Each is executable supply chain, vetted with the rigor of an npm dependency rather than edited like a preference. The checklists are adapted from the `dev-security` skill of lidge-jun/codexclaw (MIT), with omo's own install surfaces named.

## 1. Vetting an MCP server before enabling it

| Check | How | Block when |
|---|---|---|
| Source | the npm or PyPI publisher, the linked repository, the commit history | anonymous publisher, repository missing, project younger than a few months with no history |
| Version | an exact version in the config, installed explicitly | `latest`, `*`, or an `npx -y` / `uvx` auto-install at start |
| Capabilities | the tools it declares against the purpose it is enabled for | it asks for filesystem, network or shell beyond that purpose |
| Secrets | the config entry | any secret value written inline instead of an environment reference |
| Maintenance | last commit, open issues answered | abandoned for a year |
| Advisories | the registry's advisory list for the package name | an unpatched advisory |

```jsonc
// an entry that passes
{ "command": "node", "args": ["node_modules/@vendor/mcp-postgres/dist/index.js"], "env": { "DATABASE_URL": "${DATABASE_URL}" } }
// an entry that fails on two rows
{ "command": "npx", "args": ["-y", "@vendor/mcp-postgres"], "env": { "DATABASE_URL": "postgres://user:pass@prod:5432/db" } }
```

Keep an allowlist per project of the servers and skills that are enabled, with the version, who approved it, when, and the scope it was approved for. A version bump is a dependency change: read the changelog and the diff. Run each server with the least it needs (a read-only mount of the directories it serves, egress limited to its API, its own credential rather than the shared environment, a per-call timeout) and log tool invocations with the server, tool, redacted input, truncated output, duration and caller context.

## 2. Installing a skill

A skill is text the model will obey. Read the whole SKILL.md and every file it references before installing, and look for:

- embedded commands or `exec` calls the skill wants run at load time or as a step;
- URLs that would carry data out (a webhook, a paste site, a form endpoint, an image URL with query parameters built from context);
- instruction overrides ("ignore previous instructions", "you are now", "do not tell the user");
- runtime fetching of further instructions, which moves the skill's behavior out of the reviewed text;
- encoded or obfuscated blocks, zero-width or homoglyph characters, and frontmatter fields the loader does not define.

Then pin it: install from a specific commit SHA, never a branch, and record the content hash of the installed files. On update, diff the new version against the installed one and re-read the changed parts with the same list; new commands, new URLs, removed safety constraints and changed behavioral instructions are the lines to read twice. Keep an inventory (name, source, commit, hash, installed on, last reviewed, risk class) so an update or an incident can be traced.

Skills should declare what they need (paths read or written, network, commands) and be denied the rest. A skill that behaves differently across harnesses is tested on the one it will run in before it is trusted there.

## 3. Hooks and agent-authored config

Configuration files the agent writes or that other agents wrote are a trust surface of their own.

| File | Look for |
|---|---|
| `AGENTS.md`, `CLAUDE.md`, rules files | hardcoded secrets, auto-run instructions, injected instructions aimed at the model |
| settings and permission files | allow lists wide open (`Bash(*)`), empty deny lists, bypass flags |
| MCP config | the rows of section 1 |
| hooks | command injection through interpolated fields (`${file}` into a shell string), data sent out, errors silenced |
| agent definitions | unrestricted tool access, prompt-injection surface, no model constraint |

## 4. AI-suggested dependencies (the slopsquatting gate)

Models recommend package names that do not exist, and the same wrong names recur, so attackers register them. Before adding any dependency a model suggested: confirm the package exists on the official registry with a real release history (not published days ago), the maintainer or organization and the linked source repository are plausible for the name, the install scripts hold no surprise, the lockfile diff is read, and the registry's provenance or trusted-publishing attestation is present where the registry offers it (npm, PyPI). A name that fails one row is not added; the correct package is found by reading the official documentation, not by trying the next suggestion.

## 5. Blast radius

Assume one component will be compromised and make that survivable: least-privilege filesystem access for every agent tool, database credentials scoped to the tables and verbs the task uses, CI runners separated from production secrets, egress filtering on build and agent environments, credentials that expire when the task ends, and an explicit deny list for destructive commands wherever the agent can run a shell.
