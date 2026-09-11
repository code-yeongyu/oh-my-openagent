# Kibitzer gate `session_create_failed` / ENOENT `memorian-persona.md` — root cause

Investigated 2026-09-09 against the live installation on mengmotaHost
(`omo-ai@5.0.0-0.beta.50`, engine `@code-yeongyu/senpi@2026.9.9`) and source `dev` at `72860584d`.

## Reported failure

```
✗ Kibitzer gate failed · session_create_failed
ENOENT: no such file or directory, open
  '/Users/yeongyu/.bun/install/global/node_modules/omo-ai/plugin/extensions/memorian-persona.md'
run b94f091d-b7bc-47ce-9e17-0d062767efe8
```

`~/.omo/omo-memory/agents/sisyphuslabs-d5fbf349/runtime/recall/runs/b94f091d-.../outcome.json`:
`{"status":"failed","cause":"session_create_failed","model":"openai/gpt-5.6-luna-fast","finishedAt":"2026-09-09T06:51:03.611Z"}`

## What the installed tree actually contains

- `plugin/extensions/` holds `kibitzer-persona.md` (mtime Sep 9 06:30 KST) and no `memorian-persona.md`.
- The installed `plugin/extensions/omo.js` reads `kibitzer-persona.md`
  (`systemPrompt:XI(pR(mR,"kibitzer-persona.md"),"utf8")`) and logs
  `kibitzer gate child session creation failed`.
- The string `memorian-persona` does not occur anywhere in the installed tree.

So the failing process was not executing the installed bundle.

## Mechanism (confirmed, not inferred)

The failing log line says `memorian gate child session creation failed` — the pre-rename wording —
while the installed bundle can only emit `kibitzer gate ...`. Counting both spellings in
`~/.omo/agent/omo-debug.log`:

| log message | occurrences |
|---|---|
| `memorian gate child session creation failed` (pre-rename bundle) | 155 |
| `kibitzer gate child session creation failed` (installed bundle) | 0 |

Every failure comes from a process that loaded the pre-rename bundle and kept it in memory. Session
`01a081ce-f65c-7d08-9eb5-814df9022bf2` started `2026-09-08T16:16:59Z` (= 09-09 01:16 KST), before the
beta.50 install at 09-09 06:30 KST; the gate fired at 15:51 KST and opened the retired filename in the
already-replaced tree. Recurrence is per gate fire in those processes, not per new session in the
current install: run `66436c68-1ccc-4af4-a47d-c84886231d7e` (07:46:35Z) is the same old wording and
the same retired path.

The same shape hit the compiled runtime on 2026-09-07 at
`~/.omo/binary-runtime/0.0.0-omob.579c175.fdccd62/plugin/extensions/memorian-persona.md`, where the
auto-update launcher's prune had removed an in-use runtime dir (fixed as a trigger by PR #7994; a
process still runs the deleted `0.0.0-omob.749b777.eab8c4b` dir today).

## Why the code is exposed

`packages/memory-core/src/{recall,facts,reflection}/assets/assets.ts` resolved
`dirname(fileURLToPath(import.meta.url))` and `readFileSync`'d a fixed filename **at child-launch
time**: `kibitzer-judge-spec.ts:41 systemPrompt: loadKibitzerPersona()`, reached from
`kibitzer-judge-run.ts:79`. `plugin/scripts/build-extension.mjs:110` documents the coupling — the
bundle inlines the code but the markdown is read from beside the bundle at runtime. The install tree
is mutable during a session (a global install replaces it in place; the omob launcher rebuilds and
prunes runtime dirs), so a swap, prune, or rename turns the next launch into an ENOENT. The rename
made it deterministic for every live pre-rename process.

## Independent latent defect found in the same path

`f4978b3b8` (2026-09-01, "require the memorian persona in packing validation") added
`extensions/memorian-persona.md` to `packages/omo-senpi/src/install/plugin-artifacts.ts` and the
generated `install.mjs`, but not to `script/build-omo-native.ts`, whose comment claims it mirrors that
list. Nothing locked the two. The published `omo-ai` payload gate therefore never required the gate
persona (nor `extensions/omo-task.js` / `extensions/omo-member.js`); those files ship only because
`PAYLOAD_DIRECTORIES` copies the whole `extensions` directory. `packages/omo-native/test/payload.test.ts`
carried the same gap. A staging regression would have shipped a package whose every gate fire ENOENTs,
with `--check-only` still green.

## Fix

1. `packages/memory-core/src/personas/manifest.ts` is the single definition of the four persona
   filenames; the three loaders derive from it.
2. `packages/memory-core/src/personas/load.ts` reads each asset at most once per process and serves
   the cached content afterwards, so a tree that changes under a live process cannot break a later
   child launch. A failed read is not cached, so a repaired tree recovers without a restart.
3. `primeMemoryPersonaAssets` (called from the memory component's `register`) reads all four personas
   while the process still sees the payload it launched from, and reports an unreadable asset once,
   naming it plus the actionable cause. No runtime fallback and no alternate filename is ever tried.
4. `plugin-artifacts.ts` derives its persona entries from the manifest and is exported as the one
   required-artifact list; `script/build-omo-native.ts` re-exports it instead of keeping a copy, and
   `payload.test.ts` requires the gate persona with a `--check-only` mutation.
5. `build-extension.test.mjs` locks the Node-side staging list (`persona-artifacts.mjs`) to the
   manifest, since Node cannot import the TypeScript module.

## Scope boundary

This does not repair sessions already running a retired bundle — nothing can hand a live process a
file that no longer exists, and a runtime fallback to the old filename is explicitly out of bounds.
Those processes need a restart; new processes are immune by construction. No configuration or cache
under `~/.omo` or `~/.config` references a persona path (verified by scan), so there is no stale-path
migration to perform.
