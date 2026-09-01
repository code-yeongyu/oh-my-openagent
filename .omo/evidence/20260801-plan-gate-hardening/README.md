# Evidence: plan-gate hardening for metis/momus

## What was tested
- Unit RED->GREEN (bun test packages/senpi-task packages/omo-senpi, 1657 pass): the invocation
  guard now requires an explicit USER ulw-plan request AND a .omo/plans/*.md artifact (any root,
  worktrees included); a SKILL.md read alone no longer opens the gate; denial messages carry no
  self-unlock coaching; the tracker's three channels (invoked / user-requested / plan-artifact)
  including ultrawork-mode + system-reminder stripping and apply_patch patch-body matching.
- Real-surface e2e (plan-gated-agents-e2e.mjs, REAL senpi process, isolated sandbox agent dir,
  mock provider - no live API):
  - e2e-denial.json: no request -> momus DENIED with the new missing-request message, zero child records.
  - e2e-read-unlock.json (new negative): ulw-plan SKILL.md read then momus spawn -> STILL DENIED,
    zero child records. This is the exact self-unlock observed live on 2026-08-01 (session
    019fbbd8, st_019fbbe3), now blocked.
  - e2e-sequence.json: user prompt requesting ulw-plan + write of .omo/plans/qa-plan.md -> momus
    ALLOWED (child completed); after a start-work SKILL.md read, metis DENIED; exactly one child record.
- Codex dual-maintained ulw-plan copies stay byte-identical (node --test ulw-plan-skill-contract.test.mjs PASS).
- tsgo --noEmit clean for packages/senpi-task and packages/omo-senpi.

## What was observed
- Each e2e JSON records result/checks plus realSenpiCredentialsUntouched=true (auth/models/trust
  digests identical before/after), proving the real ~/.senpi/agent credentials were not touched;
  sandboxes are removed by the driver (cleanup line on stderr).

## Why it is enough
- The failing-first unit proofs pin the exact regression each behavior names; the e2e proves the
  same conditions end to end on the real harness, including the historical bypass as a negative case.

## What was omitted
- Raw senpi stdout JSONL transcripts (may embed environment paths) are summarized by the driver's
  final JSON; stderr files contain only driver cleanup lines.
