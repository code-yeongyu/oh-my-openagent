# schema

## OVERVIEW
Zod v4 source of truth for the layered `omo.json` contract; earned a file by its 28-file schema/test surface and its cross-package export hub role.

## WHERE TO LOOK

| Area | Location | Notes |
|------|----------|-------|
| Root contract | `config.ts` | Strict full/layer schemas, typed harness blocks, profiles, and migration bookkeeping fields. |
| Agents, categories, teams | `agent.ts`, `category.ts`, `team.ts` | Runtime selection and team definitions consumed by the task surface. |
| Task | `task.ts` | Concurrency, residency, wait, warnings, team, and DAG bounds; `resolveOmoTaskSettings` derives host-sized defaults. |
| Memory | `memory.ts` | Reflection, nudge, facts, dream, people, soul, sync, search, recall, write-notice blocks plus per-agent overrides. |
| Models | `model-catalog.ts`, `model-ref.ts`, `fallback-models.ts`, `reasoning-vocabulary.ts` | Catalog entries, reasoning vocabulary, fallback forms, and legacy field normalization. |
| Cross-cutting | `harness.ts`, `format-on-mutation.ts`, `git-master.ts`, `telemetry.ts` | Harness identifiers and settings shared by every adapter. |
| Barrel/tests | `index.ts`, `*.test.ts` | Public schema exports and per-block contract coverage. |

## CONVENTIONS

- Every configurable block ships two schemas: a strict full schema owning defaults and a strict partial `*Layer` schema for per-file overrides. Only the full schema may apply defaults; layers must stay defaultless so merging keeps precedence honest.
- Deprecated model/category spellings stay accepted as inputs and are folded into canonical fields through `z.preprocess` normalization rather than being rejected.
- Host-sensitive task defaults are computed, not hardcoded: residency and global concurrency scale with available parallelism, floored at 8 and capped at 16 for residency.
- Per-agent memory overrides are layer-shaped by design so an agent entry can partially override a resolved block.
- Nested settings get their own named schema and focused test instead of an untyped record.

## ANTI-PATTERNS

- Do not import harness adapters, filesystem, process, or clock services here; these modules stay pure declarations.
- Do not add defaults to a `*Layer` schema or drop `.strict()`; both silently break layer precedence and unknown-key reporting.
- Do not delete a deprecated input field without an explicit compatibility decision - existing user configs still send them.
- Do not implement merge precedence, profile selection, or catalog expansion inside a schema parser; those belong to `../loader` and `../models`.
- Do not change a default, bound, or enum without updating the matching schema test and the consumers that read the resolved value.
