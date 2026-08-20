# PR #6742 OpenCode programming-skill load proof

## What was tested

- `probe.sh` ran OpenCode in an isolated XDG sandbox with this worktree's TypeScript entrypoint registered as a local plugin and a deterministic local fake provider.
- The provider requested the plugin's `skill(name=programming)` tool. The probe inspected both the advertised tool metadata and OpenCode's completed tool result.
- It asserted that the tool returned the `programming` body, its advertised description begins with the supported write/edit/review scope, the legacy overbroad trigger is absent, the description fits the 1024-byte budget, and the real OpenCode DB session count is unchanged.

## What was observed

- `opencode-run.jsonl` is the structured event stream emitted by the real OpenCode CLI.
- `dependency-bootstrap.txt` records the offline, cache-only installation of OpenCode's matching plugin API into the sandbox; no live user configuration was reused.
- `fake-provider.txt` records sanitized assertions about the tool schema received by the provider and whether the tool output returned to it.
- `opencode-programming-skill.txt` records the completed tool state, description byte length, tool-output prefix, and real DB session counts before and after the probe.
- All seven assertions printed `PASS` and the real DB session count did not change.

## Why this is enough

The plugin deliberately overrides OpenCode native skill discovery with its own `skill` tool (`packages/omo-opencode/src/plugin/tool-registry-core-tools.ts`). The tool description is machine-consumed routing metadata sent to the model, and the completed tool result proves the plugin resolved and loaded `programming`. This is the same bounded frontmatter field whose 1024-character line budget is enforced by `packages/omo-senpi/src/skills-sync.test.ts`.

## Omitted

No real-model positive/negative prompt pair was run. This machine has no OpenCode provider credentials, and model selection based on natural-language prompts would be nondeterministic. `packages/shared-skills/AGENTS.md` forbids tests that pin prose behavior; this probe instead verifies the deterministic metadata OpenCode actually serves.
