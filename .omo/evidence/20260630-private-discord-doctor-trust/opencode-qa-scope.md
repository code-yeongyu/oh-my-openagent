# OpenCode QA Scope

Skill used:
- `.agents/skills/opencode-qa/SKILL.md`

Changed surface:
- `packages/omo-opencode/src/cli/doctor/checks/system.ts`
- `packages/omo-opencode/src/cli/doctor/checks/system.test.ts`

Case mapping:
- This is an OpenCode-facing `omo doctor --platform opencode` CLI guidance change.
- It does not add or modify an OpenCode lifecycle hook, tool, TUI surface, or server/SSE event route.
- Matching-surface QA is the doctor CLI invocation captured in `manual-qa-doctor-trust-invocation-v3.txt`.

OpenCode QA harness proof:
- `opencode-qa-common-self-check.txt` confirms the opencode-qa harness dependencies, DB path lookup, isolated XDG sandbox creation/removal, and HOME isolation.
- `opencode-qa-cli-probe.txt` confirms the installed OpenCode CLI surface was available during QA (`opencode --version`, DB path, debug paths).

Isolation:
- The doctor CLI manual QA used isolated `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME`.
- The real OpenCode session count stayed unchanged before and after the doctor invocation.

Not run:
- `sse-hook-probe.sh`: not applicable because this change does not touch lifecycle hooks or event handling.
- `tui-smoke.sh`: not applicable because this change does not touch the OpenCode TUI.
