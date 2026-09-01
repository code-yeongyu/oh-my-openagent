# health-alert split + spinner de-tautologization

## FIX 1: read-only health derivation
- `worker/health-alert.ts` (new): `emitReflectionHealthAlert`,
  `REFLECTION_HEALTH_ENTRY_TYPE`, `ReflectionHealthEntry`. Function body copied
  verbatim -> behavior identical (streak>=3, fingerprint stable in >=2 of last 3,
  once-guard `${sessionId}:${fingerprint}`, `senpi-memory.health` entry type).
- `worker/health.ts`: now imports only `node:fs/promises`, `node:path`, and a type
  from memory-core. readdir/readFile only.
- Call sites: `worker/runner.ts` imports the emitter from `./health-alert`;
  `wiring.ts` imports via the `./worker` barrel, which re-exports the new module,
  so it required no edit.
- Guard tests in `worker/health.test.ts`: import allowlist + no appendEntry/
  safeNotify/writeFile/mkdir/rename/rm, and a byte-identical directory snapshot
  across a derivation that would have tripped alerting.

## FIX 2: non-vacuous spinner assertions
Literal glyphs pinned in identity assertions; modulo form retained ONLY at
`[3 % MEMORY_REFLECTING_FRAMES.length]` where wrap-around is the property tested.
RED proof: `red-corrupted-glyphs.txt` (frames[0]<->frames[1] swapped).
GREEN after restore: `green-restored-glyphs.txt`.

## Bundle decision (two-tier rule)
- `omo.js`: SOURCE digest SersWpE-IuRr0Qnu4TXLq_wFADflmOJgtoxRCRqXggs
  -> mdulbaBvBIE7LuLovXQCaZZwUaPBqDIQ3KKGLqEhR78. Changed => COMMITTED.
- `omo-task.js`: SOURCE digest rCXEyVMd... unchanged, BODY digest churned across
  two identical rebuilds => body-only churn => RESTORED, not committed.
- `packages/omo-codex/plugin/components/codegraph/dist/*`: untouched.

## Verification (final tree)
- `bun test packages/omo-senpi/src/components/memory` -> 590 pass, 0 fail, EXIT=0
- `bun run --cwd packages/omo-senpi typecheck` -> EXIT=0
- `build-extension.mjs --check` -> "build is current", EXIT=0
