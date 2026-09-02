# Plan: Fix #6717 - `/exit` prints legacy `~/.senpi` resume path; branded install keeps writing to the engine directory

## Root cause

`packages/omo-native/bin/lib/launcher.js` `senpiEnvironment()` resolves the agent dir with
`canonicalAgentDir(env)`, whose precedence ladder honors inherited legacy variables
(`OMO_CODING_AGENT_DIR` > `SENPI_CODING_AGENT_DIR` > `PI_CODING_AGENT_DIR`). A leftover
`SENPI_CODING_AGENT_DIR=~/.senpi/agent` exported by a previous standalone senpi install therefore
wins over the brand profile (`configDir: ".omo"`), so the branded engine writes sessions/auth into
`~/.senpi/agent`. Because the live session dir differs from the branded default,
engine-side `usesDefaultSessionDir()` is false and `/exit` prints an explicit
`--session-dir …/.senpi/agent/…` resume hint. State splits: `~/.omo` holds only the migration
copy-forward while `~/.senpi/agent` keeps receiving live writes.

Secondary effect in the same bug family: `adoptLegacyFlatState()` computes its canonical target
with `canonicalAgentDir(env)`, so the same stale variable makes flat-state adoption a silent no-op
(canonical != default), perpetuating the split.

Already-fixed elsewhere since beta.5 (no action): the bundled extension resolves through the
brand-aware `resolveAgentHome()`; the remaining `SENPI_CODING_AGENT_DIR ?? ~/.senpi/agent`
fallback in `packages/omo-senpi/src/components/memory/wiring-static.ts:196` is the standalone-senpi
default inside the memory component and is correct for that context (out of scope).

## Fix (minimal, launcher-scoped)

1. `packages/omo-native/bin/lib/agent-dir.js`
   - Add `brandedAgentDir(env, home)`: an explicit `OMO_CODING_AGENT_DIR` wins; otherwise the
     canonical `~/.omo/agent` default. Legacy-brand variables are ignored as foreign-install
     leftovers (#6717). `canonicalAgentDir()` keeps its full precedence ladder (doctor/setup
     contract, pinned by existing tests, unchanged).
   - `adoptLegacyFlatState()` internally resolves its canonical target through `brandedAgentDir()`
     so a stale legacy variable no longer blocks the one-time carry-forward ("user pinned a
     directory" now means the brand-prefixed override only).
2. `packages/omo-native/bin/lib/launcher.js`
   - `senpiEnvironment()` uses `brandedAgentDir(env)`; both `OMO_CODING_AGENT_DIR` and
     `SENPI_CODING_AGENT_DIR` handed to the engine point at the branded answer (legacy name still
     travels so bare-senpi children share state).

Out of scope (deliberate): `doctor.js` / `setup-detect.js` / `setup-import.js` keep honoring
explicit legacy variables - pinned by their own tests as a supported detection/import feature;
changing them would expand the diff beyond the issue.

## Failing tests FIRST (given/when/then)

- `packages/omo-native/test/launcher.test.ts` new describe `#given a shell that still exports a legacy engine agent-dir variable`:
  1. `SENPI_CODING_AGENT_DIR` inherited -> engine env gets `~/.omo/agent` for BOTH names (RED today).
  2. `PI_CODING_AGENT_DIR` inherited -> same (RED today).
  3. Explicit `OMO_CODING_AGENT_DIR` still beats any legacy variable (GREEN guard, must stay green).
- `packages/omo-native/test/agent-dir.test.ts` new case: stale `SENPI_CODING_AGENT_DIR` no longer blocks flat-state adoption (RED today).

## Verification

1. RED: `bun test packages/omo-native/test/launcher.test.ts packages/omo-native/test/agent-dir.test.ts` - new cases fail.
2. Apply fix.
3. GREEN: same command; then full `bun test packages/omo-native/test` (payload.test.ts may need staged build via `bun run build:omo-native`; document if hit).
4. Typecheck: `bunx tsc -p packages/omo-native/tsconfig.json --noEmit`.
5. Entry smoke: `node packages/omo-native/bin/omo.js --version`.
6. Evidence dir `.omo/evidence/20260824-6717-exit-legacy-path/` with WHAT TESTED / OBSERVED / WHY ENOUGH / OMITTED; `git add -f`.

## Commit / PR

- Conventional commit: `fix(omo-native): resolve branded agent dir without inheriting legacy engine variables`
- Push `fork issue/6717-exit-legacy-senpi-path`; PR to `code-yeongyu/oh-my-openagent` `dev` from `AceRothstein71:issue/6717-exit-legacy-senpi-path`, English What/Why/Verified/Risk, ends `Fixes #6717`.
