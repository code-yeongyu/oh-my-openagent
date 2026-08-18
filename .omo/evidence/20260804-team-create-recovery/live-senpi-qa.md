# Live Senpi QA

## What was tested

The real `senpi` CLI loaded the rebuilt worktree extension and a local mock
provider in disposable state. The mock emitted one `team_create` call whose
arguments intentionally contained both:

- `team_name: "stale-named-team"`
- a complete `inline_spec` named `e2eteam`

Invocation:

```sh
cd /Users/yeongyu/local-workspaces/omo-wt/fix/team-create-inline-precedence
QA_HOME=$(mktemp -d -t omo-team-create-qa-home.XXXXXX)
HOME="$QA_HOME" \
TEAM_E2E_OUT_DIR="$PWD/.omo/evidence/20260804-team-create-recovery/live-team-e2e-isolated-home" \
SENPI_BIN="$(command -v senpi)" \
node packages/omo-senpi/scripts/qa/team-e2e.mjs
rm -rf "$QA_HOME"
```

## What was observed

- Overall verdict: `PASS`
- `dual_field_calls`: 1
- `invalid_argument_results`: 0
- The sole `team_create` result had `details.kind: "created"`.
- Team `e2eteam` was created with two running members.
- Both members resolved to the local `omo-mock/mock-1` model.
- All team lifecycle, mailbox injection, crash recovery, and exactly-once
  durability checks passed.
- `credentialIsolationClean: true`
- `wholeDirUnchanged: true`
- `leakedPids: 0`

Primary artifacts:

- `live-team-e2e-isolated-home/main-stdout.json.log`
- `live-team-e2e-isolated-home/main-observed.json`
- `live-team-e2e-isolated-home/verdict.json`
- `live-team-e2e-isolated-home/crash-recovery.json`

## Why it is enough

This is the real Senpi process and worktree plugin surface, not a direct unit
call. It proves the exact over-specified payload now crosses the plugin
boundary once, creates the inline team, and does not enter the repeated
`invalid_arguments` loop recovered from the original Kimi sessions.

## Cleanup receipt

- The QA driver's owned process registry reported `leakedPids: 0`.
- The disposable HOME was removed by the shell `EXIT` trap.
- The QA driver's per-run Senpi sandboxes were recursively removed.
- No network model API was called; the provider was local and deterministic.

## Omitted

No credentials, auth headers, environment dumps, or user prompt history are
copied into this evidence directory.
