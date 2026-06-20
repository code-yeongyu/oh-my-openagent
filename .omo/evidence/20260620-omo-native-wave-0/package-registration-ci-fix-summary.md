# Package Registration CI Fix Evidence

Date: 2026-06-20
Branch: code-yeongyu/omo-native-wave0
PR: #5454

## Root Cause

GitHub Actions `test` failed on ubuntu, macOS, and Windows because `packages/omo-native` was added to the root workspace and `typecheck:packages` script, but `script/package-registration-audit.test.ts` still did not classify it as a managed package.

The CI failure was reproduced locally by `bun test` before the fix:

- `1 tests failed`
- failing test: `package registration audit > #given managed packages #when root registration is audited #then workspaces typecheck and dev deps stay aligned`
- diff showed `packages/omo-native` present in actual typecheck paths but absent from expected managed paths

## Fix

Updated the registration audit so `packages/omo-native` is treated as a managed native package. The audit still excludes native packages from the root `workspace:*` devDependency expectation, preserving the Wave 0 constraint that the native package is registered for workspace/typecheck coverage without introducing install-time Senpi coupling.

## Verification

Focused audit:

```text
Command: bun test script/package-registration-audit.test.ts
Result: 5 pass, 0 fail
Exit: 0
Artifact: .omo/evidence/20260620-omo-native-wave-0/package-registration-audit-fix-verification.txt
```

Root suite:

```text
Command: bun test
Result: 10072 pass, 2 skip, 0 fail
Exit: 0
Artifact: .omo/evidence/20260620-omo-native-wave-0/root-bun-test-after-package-registration-fix.txt
```

Native adapter smoke checks:

```text
Command: bun run build:native
Exit: 0
Artifact: .omo/evidence/20260620-omo-native-wave-0/build-native-after-registration-fix.txt

Command: bun run --cwd packages/omo-native typecheck
Exit: 0
Artifact: .omo/evidence/20260620-omo-native-wave-0/native-typecheck-after-registration-fix.txt
```

Manual QA / cleanup:

- Terminal TUI screenshot remains attached in the PR from the earlier Wave 0 manual QA: `.omo/evidence/20260620-omo-native-wave-0/terminal-tui.png`.
- No `ulw-qa-omo-native-wave0-terminal` or `omo-native` tmux QA session remained after cleanup check.
