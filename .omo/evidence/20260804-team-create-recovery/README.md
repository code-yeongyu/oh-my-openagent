# team_create recovery QA evidence

## Scope

This directory records the transcript diagnosis, failing-first regression proof,
focused and package verification, live isolated Senpi QA, and cleanup receipts
for the `team_create` inline-spec precedence fix.

## Security and isolation

- Raw provider credentials, auth headers, environment dumps, and private prompt
  bodies are omitted.
- Live QA must use a disposable Senpi agent directory and local mock provider.
- The real Senpi agent directory must have identical credential and whole-tree
  digests before and after QA.

## Status

Complete. See:

- `diagnosis.md`
- `red-focused-test.txt`
- `green-focused-test.txt`
- `lsp-diagnostics.txt`
- `live-senpi-qa.md`
- `verification-gates.txt`
- `self-review.md`
- `live-team-e2e-isolated-home/verdict.json`
