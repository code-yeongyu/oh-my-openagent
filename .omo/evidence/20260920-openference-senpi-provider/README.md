# Openference Senpi provider - QA evidence (registerProvider redesign)

**Date:** 2026-09-22
**Branch:** `feat/openference-providers`
**Scope:** the `openference-provider` component registering the Openference provider IN MEMORY through `pi.registerProvider(createProvider(...))` — no user-config reads-for-write, no `models.json`, no filesystem effects — plus the rebuilt plugin bundle.

## Expected impact map

| Surface | Expected | Verified |
|---|---|---|
| Credential gate | without `OPENFERENCE_API_KEY`/auth.json entry, nothing registers at all | yes (hostless; production-composition test) |
| Composition writes nothing | composing the REAL extension with a credential present registers on the API and touches no file | yes (`index.test.ts` production-roster suite) |
| Request auth | engine-owned: stored `/login` credential wins, env var authenticates ambient, neither = unavailable | yes (hostless resolve matrix + live runs 4/5) |
| Rebuilt bundle | committed `plugin/extensions/omo.js` current per CI's `build-extension --check` + `build-install --check` | yes (built with Bun 1.4.2 on Linux; both checks green) |
| Real engine, real bundle | `-e <plugin>` load lists all 19 catalog models | yes (run 6, live harness) |
| Live completion, env credential | `openference/GLM-5.2` answers through the registered provider | yes (run 4) |
| Live completion, stored credential ONLY | same completion with NO env var — the auth.json path works end-to-end | yes (run 5, review finding 3) |

## How it was run

Real harness: the machine's installed Senpi engine (2026.9.16-3, the engine `omo`
5.0.0-0.beta.68 spawns) driven directly, loading the REBUILT plugin package
(`packages/omo-senpi/plugin`, built with the Bun version CI pins, 1.4.2, on Linux so
the committed bundle carries the same source digest CI verifies):

```
agent dir: fresh temp dir pinned via OMO_/SENPI_/PI_CODING_AGENT_DIR (the engine's
           brand-legacy env names; getAgentDir() verified to honor them)
extension: senpi -e <plugin-path> --list-models / -p --provider openference --model "GLM-5.2"
credential: env var for run 4/6; engine-shaped auth.json { openference: { type: "api_key", key } }
            written programmatically for run 5, with the env var REMOVED
```

```bash
# run 4: live completion, env credential
OPENFERENCE_API_KEY=<real key> senpi -e <plugin> -p --provider openference --model "GLM-5.2" "Reply with exactly one word: ok"
# run 5: live completion, stored credential only (review finding 3)
#   auth.json: { "openference": { "type": "api_key", "key": <real key> } }; env var unset
senpi -e <plugin> -p --provider openference --model "GLM-5.2" "Reply with exactly one word: ok"
# run 6: model listing through the rebuilt bundle
OPENFERENCE_API_KEY=<dummy> senpi -e <plugin> --list-models
```

Raw captures:

- `run4-registerprovider-env-glm-5.2.txt` — stdout: `ok` (exit 0)
- `run5-registerprovider-authjson-glm-5.2.txt` — stdout: `ok` (exit 0), NO env credential —
  the stored `/login`-shaped credential alone authenticated the request through
  `auth.apiKey.resolve`, so a user who logs in instead of exporting the variable gets
  working models, not selectable-but-broken ones
- `run6-registerprovider-list-models.txt` — openference excerpt of the live listing:
  **19 models** with catalog-exact windows (GLM-5.2 262.1K/128K, DeepSeek-V4-Pro-0813
  1.0M/384K, MiMo-V2.6-Flash/Pro and SenseNova 6.7/6.8 Flash-Lite included)
- `run4-stderr.log` / `run5-stderr.log` — the extension's own continuation components
  observing the sessions (no provider errors)

## Why there is no regression

1. **No config mutation at all:** the component registers a complete pi-ai Provider in
   memory; `models.json` and every other user file are never opened for writing. The
   production-composition regression test asserts the pinned agent dir gains NOTHING
   (not even `models.json`) while the provider registers — the previous models.json
   writer is gone entirely, along with its temp-path collision surface.
2. **Old hosts keep working:** `registerProvider` is feature-detected; a host without it
   logs a warning and skips (same composition contract as other optional API surfaces).
3. **Composition suites:** `bun test packages/omo-senpi/src/extension/` green with the
   component registered (roster, flags, session-start ordering), and the full sweep
   across both adapters passes (392 tests) on the fused branch.
4. **Isolation:** every engine QA run pinned the temp agent dir through the brand env
   names; the host's real `~/.omo/agent` was never passed to any QA command (its
   settings.json/auth.json byte-verified unchanged), and the engine's bootstrapped
   `~/.senpi` default was removed after QA.

## Residuals (honest limits of this evidence)

- The 6 pre-existing Windows-checkout failures in `bun test packages/omo-senpi`
  (installer/source-refresh, RPC-on-Windows, init-deep-advisor UI) remain, verified
  identical on a clean `dev` stash; unrelated to this change. CI runs the full suite on
  Linux with the built plugin.
- The catalog snapshot refreshes through one unauthenticated command
  (`bun run packages/omo-senpi/scripts/generate-openference-models.ts`), documented in
  the component AGENTS.md; this evidence regenerated it to 19 models from the live
  listing.
