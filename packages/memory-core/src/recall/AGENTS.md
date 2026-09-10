# memory-core/src/recall — Recall and Nudge Gate

## OVERVIEW

Loads committed recall corpus data, plans and scores bounded candidates, renders nudges, and persists validated pending nudges for later injection. Distinct domain (score 8): the Kibitzer judge pipeline, with its own output contract and failure policy. Parent: [`packages/memory-core/AGENTS.md`](../../AGENTS.md).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Candidate planning and selection | `planner.ts`, `select.ts` |
| Corpus/provider integration | `provider.ts` |
| Nudge rendering and ledger | `render.ts`, `ledger.ts` |
| Pending-file validation/consumption | `gate.ts` |
| Kibitzer asset | `assets/assets.ts`, `assets/kibitzer-persona.md` |
| Public barrel | `index.ts` |

## CONVENTIONS

- Recall reads committed repository state and keeps candidate/nudge payloads bounded.
- The parent is authoritative: every nudge collected from the judge child is re-validated against the candidate set, ledger, hint shape, and cap - the child's own checks are defence in depth, not the gate.
- Pending payloads are self-describing (`version`, `sessionId`, `compactionEpoch`, `writtenAt`, `nudges`). A payload is valid only while the live compaction epoch still matches; epoch-less payloads are pre-release and treated as stale, and anything past the 24h TTL expires.
- Hints are standalone present-tense lines capped at 200 characters and rejected when secret-like or decision-commentary shaped.
- Session filenames are sanitized and ledger operations use atomic filesystem publication.

## ANTI-PATTERNS

- Do not surface a pending file from another session or a superseded compaction epoch.
- Do not let a stuck pending file break the turn; pending handling is fail-open.
- Do not include secrets, tokens, credentials, or judge commentary in a recall hint.

## QA

```bash
bun test packages/memory-core/src/recall/
```

`gate.test.ts` is the contract for epoch, TTL, and hint validation; extend it
whenever the pending payload shape changes.
