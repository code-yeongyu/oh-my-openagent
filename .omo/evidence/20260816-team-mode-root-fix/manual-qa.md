# PR B Team Mode manual QA

## What was tested

Command:

```text
TEAM_E2E_OUT_DIR="$PWD/.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-green-final" \
SENPI_BIN="$(command -v senpi)" \
node packages/omo-senpi/scripts/qa/team-e2e.mjs
```

Surface:

- real pinned Senpi CLI in print/JSON mode;
- isolated HOME, XDG config, agent directory, session directory, project, and OMO config;
- generated OMO Senpi bundles;
- credential-free `omo-mock/mock-1` provider extension;
- real Team Mode team creation, member RPC processes, mailboxes, task records, session JSONL,
  crash/restart, replacement delivery, quit/resume, and shutdown-approved non-revival.

## What was observed

Final verdict:

```json
{
  "result": "PASS",
  "failed": [],
  "credentialIsolationClean": true,
  "leakedPids": 0
}
```

All 22 behavior checks passed:

- two active members were created and listed;
- lead-to-member delivery enqueued and entered the member transcript;
- member-to-lead delivery entered the lead transcript at a real tool boundary;
- the lead inbox drained to processed with no reservation residue;
- no blocking `team_wait` behavior appeared;
- the crash window was reached with both lead and member alive;
- the member was killed while its message reservation remained uncommitted;
- restart restored the reservation to unread;
- replacement delivered the exact envelope once and removed residue;
- the restarted lead exited cleanly;
- structured liveness entered the lead transcript and its epoch was persisted;
- quit suspended the member, resume revived it with the same mailbox identity, and the lead poller ran;
- shutdown-approved members did not revive.

Exact artifact:

```text
.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-green-final/verdict.json
```

## Stability: second consecutive PASS

The same harness was re-run, unchanged, against unchanged production code to confirm the PASS is not
a one-off green:

```text
.omo/evidence/omo-senpi-adapter/20260816-team-mode-root-fix/pr-b/team-e2e-repeat/verdict.json
```

```json
{"result":"PASS","failed":[],"credentialIsolationClean":true,"wholeDirUnchanged":true,"leakedPids":0}
```

All 22 checks true again. `wholeDirUnchanged` is `true` in this run, confirming that the `false` value
in the first PASS came from unrelated concurrent writes into the shared evidence tree rather than from
Team Mode touching the isolated sandbox. Post-run cleanup: 0 orphan `omo-mock` processes,
0 residual `omo-senpi-qa-*` sandbox roots. Detail: `green/team-e2e-repeat.md`.

## Defects found and fixed during usage

The real surface exposed three additional root defects:

1. Startup-aware QA readiness
   - exact child-profile model admission adds a bounded Senpi catalog boot before the real child boot;
   - the old 30-second readiness bounds expired before the new verified startup could reach the test rendezvous;
   - readiness remains exact-state based, but its bound is now 60 seconds.

2. Impossible provider-level hang fixture
   - Senpi drains `steer` messages at a turn/tool boundary;
   - an infinite provider stream has no such boundary, so it could never prove member/liveness delivery;
   - the fixture now drives repeating real `task_list` boundaries and settles restart only after the structured liveness message enters model context.

3. Completed resident crash semantics
   - a completed turn does not mean the resident member process still exists;
   - a dead unsuspended resident with reattach disabled was silently converted to `rpc_detached`;
   - reconcile now preserves immutable completed turn status while recording `killed:true`, the abnormal reason, disposed residency, and `reconcile_lost`;
   - restart re-observes all parent-session records, and liveness carries both `lastKnownState:"completed"` and `killed:true`.

Each defect has failing-first and focused GREEN evidence under:

```text
.omo/evidence/20260816-team-mode-root-fix/red/
.omo/evidence/20260816-team-mode-root-fix/green/
```

## Why this is enough

The final run exercises the user-visible Team Mode lifecycle through the same pinned Senpi process,
generated bundles, extension loading, RPC, persistence, and message surfaces that production uses.
It proves both normal and abnormal paths and validates durable on-disk state, not only stdout or mocks.

## Isolation and omissions

- `credentialIsolationClean:true`: real Senpi auth, models, settings, and trust files stayed byte-equivalent
  after volatile interactive stamps were removed by the QA harness.
- `wholeDirUnchanged:false` is informational only: the real agent directory contains live logs,
  cache files, and concurrent session data written by the host. The harness deliberately gates the
  four credential files instead of pretending a whole-directory digest can identify QA pollution.
- `leakedPids:0`.
- Raw outputs contain no copied credentials, auth headers, or environment dumps.
