# Task 8 evidence - documentation

## What was tested

- `docs/reference/omo-json.md` names all five agents, field-level overlays, disablement, the ignored curated process override, team rejection, and the shell-free `gh`/HTTPS broker.
- Both package AGENTS files describe the same runtime boundary and explicit-model disable behavior.
- Machine checks found every curated name in the reference and audited all repository-local Markdown links.

## What was observed

- `bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts` completed with 16 pass and 0 fail.
- The five-name grep audit exited 0.

## Why it is enough

The documentation no longer calls unrestricted Senpi bash read-only or describes process mode as overrideable for curated agents.

## What was omitted

No OpenCode or Codex documentation was changed.
