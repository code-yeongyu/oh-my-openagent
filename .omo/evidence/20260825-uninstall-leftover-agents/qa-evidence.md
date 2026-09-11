# QA Evidence: uninstall leaves omo agents in OpenCode (#6322)

Date: 2026-08-25 | Branch: issue/6322-uninstall-leftover-agents | Base: c7094b8ac

## WHAT WAS TESTED

1. Failing-first co-located regression tests (bun test, hermetic temp-dir fixtures, real fs):
   - `packages/omo-opencode/src/cli/opencode-agent-cleanup.test.ts` (7 tests)
   - `packages/omo-opencode/src/cli/cleanup.test.ts` (3 routing tests)
   - Guarded existing suites: `cli-program.test.ts`, `install-platform-resolution.test.ts`, `index.test.ts`
2. Real CLI surface smoke (source entry, no mocks):
   `OMO_INVOCATION_NAME=omo bun packages/omo-opencode/src/cli/index.ts uninstall --platform=opencode --config-dir <tmp> --project <tmp>`
3. Authoritative typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`

## WHAT WAS OBSERVED

- RED first (implementation absent): `error: Cannot find module './opencode-agent-cleanup'` — 0 pass / 1 fail.
- GREEN after fix: 36 pass / 0 fail across the 5 files above.
- Live CLI smoke (exit=0): removed exactly `sisyphus.md`, `hephaestus.md`, `prometheus.md` from `<tmp>/config/agent/`
  and `atlas.md` from `<tmp>/project/.opencode/agent/`; user-owned `my-agent.md` survived. Output captured in
  `cli-smoke-output.txt`.
- tsgo package typecheck: clean (no output).

## WHY IT IS ENOUGH

- The bug is an fs-removal gap in the uninstall path; the new module is pure fs logic over OpenCode's real agent
  directories (`<configDir>/agent|agents`, `<project>/.opencode/agent|agents`) and is exercised against real
  temp-dir filesystems, including near-miss names (`sisyphus-pro.md`, `my-sisyphus.md`, `.txt`, `.md.bak`) and
  missing dirs.
- The live smoke drives the actual commander wiring (`cleanup-command.ts` -> `cleanup()` -> removal) end to end,
  proving the command surface users run (`uninstall`, default platform now opencode) performs the removal.
- Name-gating derives from `BuiltinAgentNameSchema.options` (single source of truth), so registry drift fails tests.

## WHAT WAS OMITTED

- No live OpenCode TUI session was driven: the change adds CLI-side file removal only; it registers no hooks,
  tools, agents, or config schema, so there is no plugin-runtime surface to observe in a TUI. The TUI-visible
  effect (agents gone after uninstall) follows from the definition files being absent, which the fs-level smoke
  proves directly.
- No secrets or env dumps in artifacts; smoke used throwaway mktemp dirs outside the repo.
