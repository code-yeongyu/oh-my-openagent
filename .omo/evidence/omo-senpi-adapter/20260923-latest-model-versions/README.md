# Real Senpi smoke: current model requirement chains

## WHAT WAS TESTED

- `node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs --repo-root "$PWD" --slug 20260923-latest-model-versions` selected this directory.
- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`: exit 0, `SELF-TEST OK`.
- `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs`: exit 0. The plugin was freshly built by `bun run test:senpi` before this run.

## WHAT WAS OBSERVED

The driver reported `result: PASS`, `ultraworkInjected: true`, and `certificationEnvironmentObserved: true`. It launched fresh real Senpi processes with the local mock provider and the worktree plugin. Its full JSON receipt is [drive.json](drive.json).

`commentChecker` was `SKIPPED-no-binary`. On this Darwin host, the driver reports `DIRECTORY_IDENTITY_UNAVAILABLE`: `isolationCertified`, `realHomeIsolationCertified`, `realSenpiUntouched`, and `realOmoUntouched` are false. These are not claimed as isolation passes. Protected-state snapshots were complete with no reported errors, and all changed-path arrays were empty. The driver implementation certifies directory identity only on Linux.

The receipt records the sandbox agent directory and project path. The driver removed its task-owned sandbox in `finally`; an existence check after exit returned `QA_SANDBOX_REMOVED`. Its synchronous child invocations had settled before driver exit.

## WHY IT IS ENOUGH

This proves the current plugin loads and its ultrawork hook reaches a fresh real Senpi session. Resolver tests separately prove the changed model selections. It does not certify whole-home isolation on Darwin or remote inference on each provider.

## WHAT WAS OMITTED

No paid inference, interactive UI QA, or comment-checker result is claimed. No credential material is included. Directory-identity certification remains unverified on this platform.
