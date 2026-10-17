# QA Evidence: issue #4250 - live chat skill tool cannot load host-discovered sibling-plugin skills

Date: 2026-08-25
Branch: issue/4250-livechat-superpowers-load
Base: c7094b8ac

## WHAT WAS TESTED

- Scoped Bun tests: `packages/omo-opencode/src/plugin/native-skills-union.test.ts` (new, 5 cases),
  `packages/omo-opencode/src/plugin/native-skills.test.ts`, and the full `packages/omo-opencode/src/tools/skill/`
  suite (62 pass / 0 fail across 15 files). Command captured in `bun-test-scoped.txt`.
- Failing-first proof: `native-skills-union.test.ts` was written against `createUnionNativeSkills`
  before implementation and failed on import (red), then passed after implementation (green).
- Typecheck: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`, exit 0 (`tsgo-omo-opencode.txt`).
  tsgo is authoritative here; LSP daemon is not reachable from this worktree.

## WHAT WAS OBSERVED

Root cause chain established from source:

1. Host skill discovery (verified in sst/opencode `packages/opencode/src/skill/index.ts`,
   `discoverSkills`) scans external dirs (~/.claude/skills, agents dirs), opencode config dirs,
   `skills.paths`, and `skills.urls`. Plugin-native skill dirs are not scanned; plugins contribute
   through merged-config `skills.paths`.
2. OMO live chat already bridges host skills additively via two seams:
   `readRuntimeHostSkills` (merged-config `skills.paths` via `client.config.get()`) and
   `createNativeSkills` (`client.app.skills()` -> GET `/skill`, "all available skills").
3. Remaining hole: `tool-registry-core-tools.ts` used
   `getPluginInputNativeSkills(ctx) ?? createNativeSkills(...)` - prefer-then-skip. If a host
   provides its own `ctx.skills` accessor that omits sibling-plugin entries (#4250 shape), or if
   our `/skill` fetch fails (older host without the route) it degrades silently to `[]` and the
   `skill` tool answers "Skill or command X not found" even though the other source knows the skill.

Fix: `createUnionNativeSkills(primary, secondary)` merges both sources, dedup by lowercase name,
host entry wins on collision, one source rejecting no longer masks the other. Wired into
`createCoreTools` replacing the prefer-then-skip expression.

## WHY IT IS ENOUGH

The new unit suite pins the exact #4250 failure shape (host accessor omitting a sibling-plugin
skill), collision precedence, both single-source-failure isolation paths, and dirs union. The full
scoped skill-tool suite stays green, proving the existing runtime/native routing contract did not
regress. Typecheck proves the wiring change is type-sound across the package.

## WHAT WAS OMITTED

- Live OpenCode harness QA (opencode-qa skill / `opencode run` drive): this environment is
  network-restricted; `bun install` cannot complete here (deps were reused via a sibling-worktree
  node_modules symlink) and spawning a real opencode server with plugin marketplace access is not
  possible. Residual risk: host response shapes beyond the SDK v2 schema pinned in
  `native-skills.test.ts` are covered only at type level.
- Full repo gates (`bun run test:codex`, root `bun test`): change is scoped to
  packages/omo-opencode skill resolution; scoped suite + package typecheck run instead.
- No secrets or env dumps in this evidence.
