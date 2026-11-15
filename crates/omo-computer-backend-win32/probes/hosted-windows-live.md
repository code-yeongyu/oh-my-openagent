# Hosted Windows live ledger (`hosted-windows-live.tsv`)

**Status: OPEN.** This ledger is part 1 of the Windows live tier. The row it belongs to closes only when every
acceptance line passes, and part 2 still owes two of them:

- each leg's scenario run through the Windows live driver (`script/qa/computer/windows.ts`, added by the Windows
  driver rows), with `SET windows-full tier=<t> ...` and `blocked reason=backend_not_built` until a scenario exists;
- an owned Windows guest for every leg that does not read `CONFIRMS` here, with the guest job and its
  `runner_unavailable` watchdog. Placing that guest is a maintainers' decision; no machine is rented.

## Measured on the hosted runner

`WINDOWS_FULL_TIER=partial`. The hosted runner carries two legs; the other three are recorded drops for now,
each with the contradiction the runner itself reported as the reason, until an owned Windows guest exists:

| leg | verdict | carried by | reason |
|---|---|---|---|
| elevated (q1) | CONFIRMS | hosted runner | a Medium worker (S-1-16-8192) is refused by a High fixture while the High control lands |
| mixed-dpi (q4) | CONFIRMS | hosted runner | a second monitor through the pinned indirect display driver reads 144 effective DPI at 150 % |
| lock (q2) | CONTRADICTS | recorded drop, unobserved | the lock is read, but a SYSTEM `tscon` task cannot unlock the session |
| disconnect (q3) | CONTRADICTS | recorded drop, unobserved | the session reconnects by itself within a second, so a disconnected state cannot be held |
| secure-desktop (q5) | CONTRADICTS | recorded drop, unobserved | `ConsentPromptBehaviorAdmin=0`: elevation never prompts, so the secure desktop never appears |

## What a row says

One row per question, measured on the hosted `windows-latest` runner by
`.github/workflows/computer-live-windows-full.yml`:

| column | meaning |
|---|---|
| `question` | q1 elevated, q2 lock, q3 disconnect, q4 mixed DPI, q5 secure desktop |
| `leg` | the leg id the tier plan uses |
| `verdict` | `CONFIRMS` (the runner can carry the leg), `CONTRADICTS` (it cannot, read positively), `UNMEASURED` |
| `evidence` | the observation behind the verdict, with the runs that agreed |
| `rerun` | the probe command and the workflow job that measures it |
| `host` | runner label and image version |
| `measured_at` | when the ledger was built |

`script/qa/computer/probes/hosted-windows-live.ps1` only records facts (one JSON line per leg and run);
`script/qa/computer/pool/windows-full-verdicts.ts` owns every verdict rule:

- a behaviour finding needs its positive control in the same run (q1's High control arm, q4's primary monitor, q5's
  own worker in the process list);
- an absence finding needs an enumerated read plus a read of its cause (q5: the UAC policy values);
- an errored leg or a failed read is `UNMEASURED`, never a negative;
- repeated runs of a leg (q1 and q5 run twice) that disagree are `UNMEASURED`.

`CONFIRMS` plans the leg on the hosted runner; anything else plans it on the guest, or `blocked
reason=no_windows_host` while there is none.

## Rerun

```sh
bun script/qa/computer/pool/windows-full.ts --ledger host.jsonl session.jsonl lock.jsonl --out hosted-windows-live.tsv --host "<label>"
bun script/qa/computer/pool/windows-full.ts --validate crates/omo-computer-backend-win32/probes/hosted-windows-live.tsv
bun script/qa/computer/pool/windows-full.ts --plan crates/omo-computer-backend-win32/probes/hosted-windows-live.tsv --guest off
```

The facts files are the `windows-full-facts-*` artifacts of a workflow run.
