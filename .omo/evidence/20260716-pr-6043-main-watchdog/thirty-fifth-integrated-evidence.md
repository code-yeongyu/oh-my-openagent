# Thirty-Fifth Integrated Evidence

## Exact Source

- Prior pushed PR head: `db011b1a52ff2df6e68a8cd14942b17b2e221927`.
- Fresh fetched `origin/dev`: `a2ce120a11685672f4c67e5a6f550d35cbbba6e4`.
- Final merge source under exact deterministic verification:
  `9448b850a19fe67044a63bf33a8f79d339944cf1`.
- The merge commit's second parent equals the fetched dev tip: yes.
- Clean production OpenCode QA source:
  `1b3eb953339f1d188ba79eb286906068cef112c2`.
- `packages/omo-opencode` tree at both source commits:
  `4cd4225e4f815222e75ea7136bbb890790acb54a`.
- The only later base delta was `docs/reference/known-issues.md`; runtime tree
  identity is proven in `thirty-fifth-exact-integrity.txt`.

## What Was Tested

1. Three focused abort-ownership and delta-provenance test files at the final
   merge source.
2. The complete runtime-fallback suite at the final merge source.
3. Five main-session lifecycle, model-fallback boundary, plugin event, and
   session-state test files at the final merge source.
4. Strict OpenCode adapter typecheck, Biome, TypeScript no-excuse audit,
   diff integrity, and OpenCode QA harness self-check at the final merge
   source.
5. The production-duration isolated OpenCode server, SSE, and local fake
   provider scenario on the byte-identical OpenCode runtime tree.

## What Was Observed

- Focused: `17 pass, 0 fail`, 36 expectations across 3 files.
- Runtime-fallback: `332 pass, 0 fail`, 667 expectations across 48 files.
- Lifecycle and model boundaries: `66 pass, 0 fail`, 140 expectations across
  5 files.
- Typecheck, Biome, no-excuse, diff integrity, and harness self-check passed.
- Clean live receipt:
  `PASS source_head=1b3eb953339f1d188ba79eb286906068cef112c2
  real_db_unchanged=yes older_root_fallback=yes two_active_roots=yes
  deletion_restored_older=yes fallback_watchdog_rearmed=no
  later_user_abort=external`.
- One preceding live attempt exceeded its observation window. A temporary
  cancel-site probe found no cancellation before dispatch, and the diagnostic
  plus byte-clean rerun both passed. The probe was removed before the accepted
  run and is not present in the final tree.
- The fake provider, SSE watcher, OpenCode server, and temporary sandbox were
  terminated or removed after each run.

## Why It Is Enough

The exact final merge source passed all deterministic and static gates. The
real harness exercised the identical OpenCode runtime tree at the production
watchdog duration, including root restoration, fallback dispatch, genuine
later cancellation, database isolation, and cleanup. The only commit between
that clean live source and the final merge source changes known-issues prose,
so the tree-hash bridge is stronger than an assumption based on filenames.

## What Was Omitted

Temporary diagnostic stack logs, raw server output, local session identifiers,
database paths, environment dumps, credentials, and auth headers are omitted.
The harness uses only fixed local dummy credentials and a loopback provider.
