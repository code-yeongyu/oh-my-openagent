# PR B: restore Team Mode process boundaries and terminal outcomes

## Goal

Root-fix the Senpi Team Mode failure cluster on current `dev` after PR #6879: member processes must expose only member-safe controls, generic descendants must not inherit member identity, create and respawn must use one extension profile, unavailable process models must fail before a durable running state, and RPC prompt/turn errors must terminalize instead of hanging or becoming empty success.

This PR supersedes the Team Mode portion of #6801 while preserving Ivan Smetanin's authorship for the member-boundary and descendant-identity increment. It does not carry forward the withdrawn whole-extension rejection explanation.

## Tier

HEAVY: session/RPC child handling, member permissions, process inheritance, model admission, and concurrent lifecycle outcomes.

## Success criteria

1. An explicit member process registers no normal OMO task/lead/team lifecycle or control surface; `omo-member.js` remains the sole owner of member-scoped `task_send`.
2. Generic RPC descendants strip every `SENPI_TASK_MEMBER*` variable and `omo-member.js`; explicit member launches restore fresh member identity, task id, team config, and member extension.
3. Create and respawn produce the same stable-deduplicated extension array: member extension first, inherited entries afterward in original order.
4. Process mode probes exact provider/model visibility with the same Senpi launcher, cwd, env, `--no-extensions`, and explicit extensions before spawning the real child. Missing models fail with typed `model_unavailable` before a lasting running task exists.
5. Initial RPC `prompt success:false`, assistant `stopReason:error|aborted`, missing fresh assistant output, and stale prior-turn text all become typed terminal errors with retained diagnostics.
6. Focused tests go RED before each production increment, then GREEN. Changed-file LSP, package typechecks/tests, generated bundles, root typecheck/test/build, `test:senpi`, review-work, CI, and Cubic pass.
7. Isolated real Team E2E passes team creation, member startup, lead/member delivery, backlog drain, reclaim, crash/restart, quit/resume, credential isolation, and zero leaked processes or sandbox roots.

## Increment B1 — member boundary and descendant identity

RED:

```bash
bun test \
  packages/omo-senpi/src/components/task/index.test.ts \
  packages/senpi-task/src/runners/rpc/spawn.test.ts \
  --bail
```

Production:

- add `packages/senpi-task/src/team/member-extension/identity.ts`;
- export identity constants and `isTeamMemberProcess`;
- return from the OMO task component before any normal task/team registration in explicit member processes;
- strip member env/config and `omo-member.js` from generic descendants;
- preserve explicit-member positive controls.

Commit: `fix(omo-senpi): confine team member task surface`  
Author: Ivan Smetanin `<smetanin23@yandex.ru>`

## Increment B2 — canonical extension assembly

RED:

```bash
bun test \
  packages/omo-senpi/src/components/task/team-service.test.ts \
  packages/senpi-task/src/team/runtime.test.ts \
  packages/senpi-task/src/team/member-respawn.test.ts \
  --bail
```

Production:

- remove duplicate member entry injection from `team-service.ts`;
- use one stable-deduplicated `[member, ...inherited]` rule for create and respawn;
- preserve inherited extension ordering.

Commit: `fix(senpi-task): normalize team member extension assembly`

## Increment B3 — process model admission

RED:

```bash
bun test \
  packages/senpi-task/src/runners/rpc/model-admission.test.ts \
  packages/omo-senpi/scripts/qa/task-rpc-launch-parity.test.ts \
  --bail
```

Production:

- use the same resolved Senpi launcher/profile to execute credential-free `--list-models`;
- exact-match provider and model id;
- proceed only when visible;
- return typed `model_unavailable` before real child spawn when absent;
- do not persist or pass credentials and do not invent a broad effective-resource-profile abstraction.

Commit: `fix(senpi-task): admit process models before rpc launch`

## Increment B4 — RPC prompt and turn terminalization

RED:

```bash
bun test \
  packages/senpi-task/src/runners/rpc/handle.test.ts \
  packages/senpi-task/src/runners/rpc/protocol-client.test.ts \
  packages/senpi-task/src/runners/rpc-process.test.ts \
  packages/senpi-task/src/manager/child-handle.test.ts \
  --bail
```

Production:

- validate initial prompt response;
- terminate and reject start on `success:false`;
- track fresh per-turn assistant text and terminal error facts;
- align RPC outcome classification with in-process behavior;
- never allow stale text or no output to become success;
- subscribe before triggering and await exact signals with bounded timeouts.

Commit: `fix(senpi-task): terminalize rpc prompt and turn failures`

## Generated artifact and verification

Regenerate with CI Bun 1.3.12 and verify:

```bash
npm exec --yes --package=bun@1.3.12 -- bash -c 'node packages/omo-senpi/plugin/scripts/build-extension.mjs'
npm exec --yes --package=bun@1.3.12 -- bash -c 'node packages/omo-senpi/plugin/scripts/build-extension.mjs --check'
```

Run:

```bash
bun run test:senpi
bun run typecheck
bun test
bun run build
```

Real surface:

```bash
TEAM_E2E_OUT_DIR="$PWD/.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e" \
SENPI_BIN="$(command -v senpi)" \
node packages/omo-senpi/scripts/qa/team-e2e.mjs
```

PASS only when the verdict is PASS, failed checks are empty, credential isolation is clean, leakedPids is zero, and cleanup removes every spawned sandbox/process.

## Delivery

- Five-lane review-work must pass unconditionally.
- PR target: `dev`.
- Merge method: merge commit.
- PR body maps #6801 review concerns to this PR's commits and corrected root-cause explanation.

## Stop condition

Stop this lane immediately when every RED→GREEN increment, retained QA artifact, local gate, review, CI, and Cubic check passes, the PR merge commit is on `dev`, and the PR B worktree and QA resources are removed.
