# X-search backtest summary

## Run

- Record completed in sequential chunks for all 20 queries, variants `v1,v2`, and carriers `fast,reasoning`; each lane invocation used `--timeout-ms 300000`.
- Record exit: 0; stdout bytes: 0; stderr bytes: 0 (the CLI genuinely emits no normal output). Offline exit: 0; stdout bytes: 0; stderr bytes: 0. See `exit.txt`.
- Offline replay was run twice independently from copied fixtures; JSON was byte-equal after removing only `run.timestamp`: **true**.
- Frozen winner: `v1:fast` (calibration Jaccard mean=0.5, median=0.5, n=14).
- Current defaults are `v1:fast`; winner matches both defaults, so no client change was needed.

## Aggregates by lane / variant / carrier

| Lane | Variant | Carrier | Jaccard mean | Jaccard median | Jaccard n | Recall mean | Recall median | Recall n |
|---|---|---|---:|---:|---:|---:|---:|---:|
| api-direct | v1 | fast | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| api-direct | v1 | reasoning | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| api-direct | v2 | fast | 0.5 | 0.5 | 20 | 0.5 | 0.5 | 20 |
| api-direct | v2 | reasoning | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| grok-cli | v1 | fast | NA | NA | 0 | NA | NA | 0 |
| grok-cli | v1 | reasoning | NA | NA | 0 | NA | NA | 0 |
| grok-cli | v2 | fast | NA | NA | 0 | NA | NA | 0 |
| grok-cli | v2 | reasoning | NA | NA | 0 | NA | NA | 0 |
| omo-tool | v1 | fast | 0.5 | 0.5 | 20 | 0.5 | 0.5 | 20 |
| omo-tool | v1 | reasoning | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| omo-tool | v2 | fast | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| omo-tool | v2 | reasoning | 0.45 | 0.0 | 20 | 0.45 | 0.0 | 20 |
| web | v1 | fast | 0.85 | 1.0 | 20 | 0.85 | 1.0 | 20 |
| web | v1 | reasoning | 0.8 | 1.0 | 20 | 0.8 | 1.0 | 20 |
| web | v2 | fast | 0.85 | 1.0 | 20 | 0.85 | 1.0 | 20 |
| web | v2 | reasoning | 0.85 | 1.0 | 20 | 0.85 | 1.0 | 20 |

## Parity verdict

Target: holdout median Jaccard >= 0.6 against the reference lane (Grok CLI when available, otherwise api-direct). For the frozen candidate `v1:fast`, api-direct was used because grok-cli was blocked; holdout Jaccard mean=0.5, median=0.5, n=6. Target not met.

## Cost and blocked lanes

- Derived fixture cost: $2.70731614 (source: fixtures); cap: $6.00; within_cap: **True**.
- Blocked lanes: grok-cli (all variant/carrier combinations), with `grokProbe.status=blocked_auth` and reason: sign-in prompt or probe timeout (orchestrator verified not logged in at 06:42Z). No refresh endpoint was called.
