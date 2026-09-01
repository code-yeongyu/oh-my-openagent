# Team Mode QA cleanup receipt

Captured immediately after the criterion-path isolated Team E2E run
(`.omo/evidence/20260816-team-mode-root-fix/team-e2e/`).

## Process and sandbox cleanup

```
ps aux | grep -E 'senpi.*(mock-1|omo-mock)' | grep -v grep | wc -l   -> 0
ls -d /tmp/omo-senpi-qa-* 2>/dev/null | wc -l                        -> 0
```

No orphan mock Senpi member processes, no leftover `omo-senpi-qa-*` sandbox roots.

## Credential isolation

`credentialIsolationClean: true` and
`wholeDirUnchanged: true` in the verdict: the run used an isolated HOME,
XDG config, agent directory, session directory, project and OMO config, plus a credential-free
`omo-mock/mock-1` provider extension. The real Senpi credentials were never read or written.

## Leaked PIDs

`leakedPids: 0`.

## Run history

Three consecutive PASS runs of the same unmodified harness against the same production code:
`team-e2e-green-final/`, `team-e2e-repeat/`, and `team-e2e/` (criterion path). All three report
`result: "PASS"` with `failed: []`, `leakedPids: 0`, and clean credential isolation.
