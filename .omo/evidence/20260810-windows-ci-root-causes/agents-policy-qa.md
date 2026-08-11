# AGENTS no-bypass policy QA

## QA channel

This is a pure-prose instruction change. Per test discipline, it was reviewed through the actual diff and paired with live Codex harness QA. No test pins wording or sentence presence.

## Required behavior checklist

- PASS: explicitly forbids `gh pr merge --admin` and required-check overrides.
- PASS: says a check already red on `dev` is a base-branch defect and merge blocker.
- PASS: requires inspecting the latest `dev` run.
- PASS: requires reproducing on the matching platform and toolchain.
- PASS: requires a root fix in the current PR or a separate atomic PR.
- PASS: requires rebasing onto repaired `dev`, rerunning required checks, and recording evidence.
- PASS: states that reducing the failure count is not green.
- PASS: forbids `test.skip`, weakened assertions, retry loops, `continue-on-error`, platform or shell exclusion, and environment-specific workarounds.

## Reviewer-readable diff excerpt

```diff
+ Never bypass a red required check with `--admin`, a skipped or weakened test, retry masking, platform or shell exclusion, or an environment-specific workaround.
+ **NEVER use `gh pr merge --admin` or any required-check override.** Do not request or act on authorization to bypass a gate.
+ A required check that is already red on `dev` is a base-branch defect and remains a merge blocker. Inspect the latest `dev` run, reproduce the failure on the matching platform and toolchain, root-fix it in the current PR or a separate atomic PR, rebase onto the repaired `dev`, rerun every required check, and record the evidence.
+ Reducing the failure count is not a green result. Never make a gate disappear through `test.skip`, weakened assertions, retry loops, `continue-on-error`, platform or shell exclusion, or an environment-specific workaround.
```

## Harness pairing

The isolated live Codex app-server QA passed and is recorded in `codex-qa.md`. The prose itself was not tested through model wording because that would be nondeterministic and would pin prose rather than machine behavior.
