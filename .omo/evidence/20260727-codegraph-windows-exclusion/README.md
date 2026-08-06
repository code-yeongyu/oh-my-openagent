# CodeGraph Windows exclusion release-blocker evidence

## What was tested

Release blocker: GitHub Actions publish run `30209883213` failed in `codex-compatibility (windows-latest)` because both CodeGraph exclusion tests reached the 5-second timeout.

Changed behavior:

- `.omo` and configured excluded workspaces must return `skipped-excluded`.
- Excluded workspaces must not run global zombie-process cleanup before returning.
- Eligible CodeGraph sessions must retain the managed sweep behavior.

## RED proof

Command:

```text
bun --cwd packages/omo-codex/plugin/components/codegraph test ./test/hook-exclusion.test.ts
```

Observed before the production fix:

```text
expect(received).toBe(expected)

Expected: 0
Received: 1

at test/hook-exclusion.test.ts:48:23
64 pass
1 fail
```

This deterministic assertion proved that an excluded `.omo` workspace invoked `sweepZombies` before the exclusion decision.

## GREEN proof

Local component command:

```text
bun --cwd packages/omo-codex/plugin/components/codegraph test ./test/hook-exclusion.test.ts
```

Observed after moving the sweep below disabled/exclusion gates:

```text
65 pass
0 fail
Ran 65 tests across 14 files.
tsc -p tsconfig.json --noEmit
```

Native Windows VM command:

```text
prlctl exec "Windows 11" --current-user cmd.exe /d /s /c "cd /d C:\Temp\omo-ci-fix\packages\omo-codex\plugin\components\codegraph && bun test .\test\hook-exclusion.test.ts"
```

Observed:

```text
3 pass
0 fail
Ran 3 tests across 1 file.
```

Full native Windows component command:

```text
prlctl exec "Windows 11" --current-user cmd.exe /d /s /c "cd /d C:\Temp\omo-ci-fix\packages\omo-codex\plugin\components\codegraph && bun test .\test"
```

Observed:

```text
65 pass
0 fail
213 expect() calls
Ran 65 tests across 21 files.
```

The Windows proof uses a clean `dev` clone with only the candidate source and regression test copied into it. Running from the Parallels shared filesystem was rejected as invalid evidence because Bun hit an unrelated shared-filesystem `realpath` error; the native `C:\Temp` checkout removed that artifact.

## Why this is enough

- The new assertion fails deterministically on every platform against the faulty ordering.
- The full CodeGraph component suite preserves eligible-session sweep behavior and package type safety.
- The exact test file that timed out in GitHub Actions passes on a native Windows filesystem and Bun runtime.
- The full Codex release gate passed:

```text
bun run test:codex
exit code: 0
final Node suite: 514 pass, 0 fail
```

- The first-party Codex app-server proof passed with a local mock model:

```text
bash .agents/skills/codex-qa/scripts/app-server-drive.sh --plugin
turnStatus: completed
assistantText: Hello from the codex-qa mock model.
missingHooks: []
failedHooks: []
hooks fired: sessionStart, stop, userPromptSubmit
```

- Isolation harness self-check passed:

```text
bash .agents/skills/codex-qa/scripts/lib/common.sh --self-check
PASS: isolated CODEX_HOME auto-removed on exit
PASS: mock model serves Responses SSE
PASS: real ~/.codex/config.toml unchanged
```

- LSP diagnostics requests timed out while the Deno server initialized. This is not hidden: package `tsc --noEmit`, the component suite, and the full Codex gate all passed and provide the type/diagnostic substitute.

## Isolation and cleanup

- Real `~/.codex` has not been used for QA.
- The app-server driver removed its isolated `CODEX_HOME`; the real `~/.codex/config.toml` checksum stayed unchanged.
- Windows temporary checkout: `C:\Temp\omo-ci-fix` (cleanup pending).
- Windows VM: `Windows 11` (stop pending).
- Local temporary release summary and ultrawork notepad are tracked separately in the release closeout.
