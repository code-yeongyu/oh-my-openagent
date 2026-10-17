# Live OpenCode HTTP evidence for OMO #8469

Date: 2026-09-21

Verdict: **PASS** - 79 assertions passed, 0 failed.

## What was tested

The current worktree source was loaded directly into real OpenCode 1.14.31 as:

```text
file://<WORKTREE>/packages/omo-opencode/src/index.ts
```

The reusable driver started one isolated `opencode serve` process for each model below, called `GET /global/health` and `GET /agent`, and inspected the final agent configurations returned by OpenCode itself:

1. Target: `kimi-for-coding/k3-256k`
2. Positive K3 control: `opencode-go/kimi-k3`
3. K2 control: `opencode-go/kimi-k2.7-code`
4. Unrelated/default control: `anthropic/claude-sonnet-5`

For every scenario, the sandbox-local OMO config overrode the exact repository keys `sisyphus`, `sisyphus-junior`, `atlas`, and `metis`. The corresponding runtime names observed through `/agent` were `Sisyphus - ultraworker`, `Sisyphus-Junior`, `Atlas - Plan Executor`, and `Metis - Plan Consultant`.

Docker was unavailable in this Windows environment, so the Git Bash fallback was used.

Exact invocation:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -lc 'set -o pipefail; bash .omo/evidence/20260921-kimi-k3-256k-prompt-routing/live-opencode/qa-live-opencode.sh "$PWD" "$PWD/.omo/evidence/20260921-kimi-k3-256k-prompt-routing/live-opencode" 2>&1 | tee .omo/evidence/20260921-kimi-k3-256k-prompt-routing/live-opencode/command-transcript.txt'
```

## What was observed

All four health calls and all four `/agent` calls returned HTTP 200. The server-reported version was 1.14.31 in every scenario.

| Scenario | Sisyphus | Junior | Atlas | Metis | Resolved IDs |
|---|---|---|---|---|---|
| `kimi-for-coding/k3-256k` | `kimi-k3` | `kimi-k3` | `kimi-k3` | `base` | all exact |
| `opencode-go/kimi-k3` | `kimi-k3` | `kimi-k3` | `kimi-k3` | `base` | all exact |
| `opencode-go/kimi-k2.7-code` | `kimi-k2-7` | `kimi-k2-7` | `kimi-k2-7` | `kimi-k2-7` | all exact |
| `anthropic/claude-sonnet-5` | `default` | `default` | `default` | `base` | all exact |

The persisted prompt metadata provides additional independent checks:

- Target and positive-control Sisyphus hashes match: `98eec64195cfc105e22b6a8c1cabaee314cfb03c9774ecf3926e2bb1e6a81489` (27,278 bytes).
- Target and positive-control Junior hashes match: `5acc6aaf4ff71df809534d1258b4df848b6a9200de52bd95ad6dffab95b46abd` (7,954 bytes).
- Target and positive-control Atlas hashes match: `700df5647fed339ab7e7feedee6589045a2063f459a132596eb81afdb49cc83e` (28,600 bytes).
- Target and positive-control Metis base hashes match: `58ff8336284e59e3adbb5e17f477736a0dac699ecd82c9637b135bbea9a53218` (13,402 bytes).
- The K2 control produced different K2.7 prompt hashes for all four agents, while the unrelated control produced the existing default/base classifications.

Every returned model ID exactly equaled its configured model on all 16 agent surfaces. No silent fallback can explain the classifications.

## Isolation and cleanup

Before starting any server, the driver resolved the real host OpenCode database and queried `SELECT count(*) FROM session`. It queried the same database after all servers and sandbox cleanup:

```text
before=3
after=3
unchanged=true
```

Every server received an isolated `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME`. Auto-update and model fetching were disabled. Provider credential variables were removed from the server environment.

Each server's MSYS PID, Windows PID, and port were captured. Cleanup used Windows full-process-tree termination. For all four scenarios, the receipt records:

```text
method=tree-terminated
pid_gone=true
winpid_gone=true
port_http_closed=true
port_listener_gone=true
```

The final temporary sandbox check was `sandbox_removed=true`. No server process, listening port, or temporary path remained when the run finished.

## Why it is enough

`GET /agent` exposes the final prompts and models assembled by the real plugin inside the real OpenCode server. This drives the production detector, prompt resolver, configuration assembly, source plugin loading, and HTTP serialization path rather than a unit-only seam.

The target is compared against a known K3 route, a known K2 route, and an unrelated default route. Exact resolved model assertions prevent a fallback from creating a false positive. The Metis hash equality proves the new K3 spelling leaves Metis on the same base prompt as bare K3, while the K2 control still selects its K2.7 prompt.

## What was omitted

Raw prompt bodies, server logs, sandbox configuration files, credentials, authorization headers, private host paths, and the host database path were not persisted. Raw prompts and logs existed only inside the deleted sandbox. Persisted paths are rewritten as `<WORKTREE>`, `<EVIDENCE_DIR>`, `<TEMP_SANDBOX>`, and `<HOST_OPENCODE_DB>`.

No live provider request or model completion was made. This is intentional: the behavior under test is prompt and model routing, which is fully materialized before any provider call and is directly observable through `/agent`.

## Artifacts

- `qa-live-opencode.sh` - reusable isolated HTTP driver
- `command-transcript.txt` - sanitized final run transcript
- `classifications.tsv` - status, runtime name, resolved model, classification, byte count, and SHA-256 per agent
- `isolation-cleanup.txt` - host DB before/after plus per-process and per-port cleanup receipts
- `EVIDENCE.md` - this reviewer-readable report
