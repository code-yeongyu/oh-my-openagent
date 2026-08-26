# WHAT WAS TESTED

Issue #6873 (and Defect 1 of #7095): on Ubuntu 24.04+ with
`kernel.apparmor_restrict_unprivileged_userns=1`, `/usr/bin/bwrap` exists, so the Linux
availability check in `sandbox-platform.ts` selected the bwrap sandbox on existence alone. Every
reflection child then died at spawn with `bwrap: setting up uid map: Permission denied`, and the
reflection lane hard-failed on every trigger forever. The remediation hint compounded it by
pointing at `runtime/reflection-sessions/<runId>/child-stderr.log`, a file already pruned by the
time the hint rendered.

Surfaces under test:

1. `classifyBwrapSmoke` (pure classifier) — exit 0 => usable; nonzero exit, spawn error, and
   timeout => unusable with a non-empty reason carrying the bwrap stderr tail.
2. `probeBwrapUsability` (memoized real probe) — per-executable-path memoization, uid-map denial
   surfacing, and a non-executable path degrading to unusable instead of throwing.
3. `buildSandboxTransform` policy semantics on Linux — `auto` + unusable bwrap degrades to the
   identity transform with the existing `running unsandboxed because policy is auto` warning
   carrying the probe reason; `required` + unusable throws `SandboxUnavailableError`; a usable
   probe still wraps the child; `off` and an unresolved executable never probe; Darwin never probes.
4. `reflectionRemediation` — bwrap setup failures name `memory.reflection.sandbox` and the host
   user-namespace fix, and never reference `child-stderr.log`; generic `child_exit` keeps its
   existing child-log hint.

Commands run (worktree `fix-6873-bwrap-userns`, bun 1.4.0, macOS arm64):

1. `bun test packages/omo-senpi/src/components/memory/sandbox-bwrap-probe.test.ts packages/omo-senpi/src/components/memory/sandbox.test.ts packages/omo-senpi/src/components/memory/worker/remediation.test.ts packages/omo-senpi/src/components/memory/sandbox-facts.test.ts packages/omo-senpi/src/components/memory/sandbox-absent-paths.test.ts packages/omo-senpi/src/components/memory/sandbox-lock-invariants.test.ts`
2. `bun test packages/omo-senpi/src/components/memory`
3. `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
4. `node packages/omo-senpi/plugin/scripts/build-extension.mjs` then `--check`

# WHAT WAS OBSERVED

**RED first.** Before implementation, with only the tests written:

```
 19 pass
 6 fail
 1 error
Ran 25 tests across 3 files.

error: Cannot find module './sandbox-bwrap-probe' from '.../sandbox-bwrap-probe.test.ts'

(fail) reflection worker OS sandbox > #given Linux where bwrap exists but cannot create a user
       namespace #when auto policy is used #then spawn arguments pass through with a warning
       naming the probe reason
(fail) reflection worker OS sandbox > #given Linux where bwrap exists but cannot create a user
       namespace #when required policy is used #then the build fails closed with a typed error
(fail) reflectionRemediation > #given a bubblewrap sandbox setup failure > #when remediated #then
       the hint names the sandbox setting instead of the deleted child log
       Expected to contain: "memory.reflection.sandbox"
       Received: "inspect runtime/reflection-sessions/<runId>/child-stderr.log"
```

Each failure is for the right reason: the probe module did not exist, the degrade/fail-closed
branches were absent, and the hint still pointed at the deleted child log.

**GREEN after implementation.**

1. Scoped sandbox + remediation run: `51 pass, 0 fail, 133 expect() calls` across 6 files.
2. Full memory component suite: `926 pass, 0 fail, 3052 expect() calls` across 134 files (289s).
3. `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`: exit 0, no diagnostics.
4. `build-extension.mjs --check`: exit 0, `omo-senpi extension build is current`.

Pure-LOC after the change (250 ceiling): `sandbox-platform.ts` 208 (was 231; the probe wiring
pushed it to 259, so path/executable resolution was extracted into `sandbox-paths.ts`),
`sandbox-bwrap-probe.ts` 54, `sandbox-paths.ts` 50, `sandbox.ts` 78, `worker/remediation.ts` 27.

# WHY IT IS ENOUGH

- The issue's open question (degrade or fail closed?) is answered by two tests that pin opposite
  outcomes from the same unusable-probe fixture, so the policy split cannot regress silently.
- The over-degrade risk is pinned separately: a usable probe must still produce a wrapped child
  with `wasSandboxed === true`.
- The probe cost is bounded by test, not by hope: `off` policy and an unresolved executable both
  inject a throwing probe, so any future code path that probes when it must not fails the suite.
- Hermeticity is structural, not incidental. The default probe only spawns when the resolved
  executable actually exists on the running machine, so every existing test that injects a fake
  `which` returning `/usr/bin/bwrap` keeps existence-only semantics on hosts without bubblewrap,
  and the probe unit tests spawn purpose-built shell stand-ins in `mktemp` dirs rather than bwrap.
- The full 926-test memory suite covers both production consumers of the changed builder
  (`identity-runtime.ts` reflection transform, `wiring-runtime.ts` facts surface), so the blast
  radius is exercised rather than assumed.

Residual risk: a host where the smoke probe passes but a later real launch still fails setup
(kernel policy changed mid-process, or a per-invocation race). That path keeps the pre-existing
runtime failure behavior, now with the corrected remediation hint naming
`memory.reflection.sandbox` instead of a deleted log file. Re-probing per launch was rejected as a
child spawn per reflection trigger for a case no reporter has hit.

# WHAT WAS OMITTED

- No live Ubuntu 24.04 host with `apparmor_restrict_unprivileged_userns=1` was available in this
  environment, so the AppArmor denial is reproduced through shell stand-ins that emit the exact
  stderr from the issue report rather than through a real restricted kernel. The classifier is
  fed the verbatim `bwrap: setting up uid map: Permission denied` string from #6873.
- No live Senpi harness QA was run; the recorded gate is the hermetic unit/typecheck/bundle set
  above, and nothing beyond it is claimed.
- No secrets, tokens, or env dumps appear in this change or its artifacts; nothing needed redaction.
