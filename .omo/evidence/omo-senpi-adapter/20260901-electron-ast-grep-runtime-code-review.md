# Code Quality Review: Electron ast-grep runtime

## Verdict

- **codeQualityStatus:** CLEAR
- **recommendation:** APPROVE
- **blockers:** None

## Scope reviewed

- `packages/omo-senpi/src/components/ast-grep/index.ts`
- `packages/omo-senpi/src/components/ast-grep/index.test.ts`
- `packages/omo-senpi/plugin/extensions/omo.js`
- `.omo/evidence/omo-senpi-adapter/20260901-electron-ast-grep-runtime/`

Other pre-existing/unrelated working-tree changes were not reviewed.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

None.

## Review notes

The adapter adds `ELECTRON_RUN_AS_NODE: "1"` to the exact stdio MCP child environment at `src/components/ast-grep/index.ts:53-57`. This is the correct seam: `command` remains `process.execPath` (or the injected executable), and Electron receives the documented environment switch before its child process starts. The setting is inert for Node and Bun, while the existing `BUN_BE_BUN` setting remains intact.

The shipped bundle contains the same environment entry (`packages/omo-senpi/plugin/extensions/omo.js`, minified ast-grep component near byte 482), and a fresh artifact-currentness check passed. No intended generated artifact is missing.

The focused regression tests assert the registered MCP-server environment for both fallback and explicit project-CWD paths (`index.test.ts:50-101`). These are behavior-level adapter assertions rather than prompt/prose checks, do not depend on timing, and fail if the Electron child-runtime setting is removed.

## Skill-perspective check

Ran: `packages/shared-skills/skills/remove-ai-slops/SKILL.md` and `packages/shared-skills/skills/programming/SKILL.md` were loaded and applied.

- **remove-ai-slops:** no deletion-only, tautological, implementation-constant-only, or prompt/prose tests; no needless extraction, parsing, normalization, or added production complexity.
- **programming:** no untyped escape hatch, needless abstraction, unnecessary validation/parsing, brittle prompt test, or implementation-mirroring test. The minimal typed configuration change follows the existing component pattern.

Neither skill perspective is violated.

## Checks performed

- Inspected the complete scoped source/test diff and the generated bundle contents.
- Confirmed HEAD's bundle lacked `ELECTRON_RUN_AS_NODE`, while the working bundle contains it exactly once.
- Ran `git diff --check` for the changed TypeScript files: PASS.
- Ran `bun test packages/omo-senpi/src/components/ast-grep/index.test.ts`: PASS (4 pass, 0 fail).
- Ran `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: PASS.
- Ran `checkExtensionCurrent()` from `plugin/scripts/build-extension.mjs`: PASS; rebuilt all extension artifacts in a temporary directory and confirmed `omo.js` is current.
- Inspected supplied QA evidence: `README.md` and `live-driver.json` report PASS. It supports adapter/harness compatibility but is not relied upon as the sole proof of Electron behavior.
- Attempted TypeScript LSP diagnostics; unavailable because `typescript-language-server` is not installed. The repository typecheck above passed instead.
