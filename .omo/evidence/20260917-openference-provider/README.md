# Openference provider injection - QA evidence

**Date:** 2026-09-17
**Branch:** `feat/openference-provider`
**Scope:** new `openference` provider feature (`packages/omo-opencode/src/features/openference-provider/`) + one-line wiring in `src/plugin-handlers/config-handler.ts` (call to `applyOpenferenceProviderConfig`).

## Expected impact map

| Surface | Expected | Verified |
|---|---|---|
| opencode config hook (`config.provider` injection) | `openference` provider block appears only when a credential exists | yes (run 1 / run 2 below) |
| `opencode models` listing | 15 `openference/<id>` models appear with the bundled catalog when credentialed | yes (run 2) |
| No credential (env var absent, no auth.json entry) | config byte-identical, zero `openference` entries | yes (run 1) |
| Host data isolation | all writes land in the sandbox XDG dirs; real `~/.local/share/opencode/opencode.db` untouched by QA runs | yes (isolation proof) |
| Existing opengateway provider | unaffected (regression suites green) | yes (bun test results) |

## How it was run

OpenCode 1.18.31, plugin loaded in **source mode** per CONTRIBUTING.md:

```
XDG_DATA_HOME / XDG_CONFIG_HOME / XDG_CACHE_HOME / XDG_STATE_HOME -> omo-qa-openference/* (fresh temp sandbox)
OPENCODE_DISABLE_AUTOUPDATE=1, OPENCODE_DISABLE_MODELS_FETCH=1
opencode.json -> { "plugin": ["file:///.../packages/omo-opencode/src/index.ts"] }
```

Commands (both run twice, key set then unset):

```bash
# run 1: no credential
env -u OPENFERENCE_API_KEY opencode models   # 0 openference lines
# run 2: credential present
OPENFERENCE_API_KEY=sk-openference-qa-dummy opencode models   # 15 openference/ lines
```

Raw outputs: `run1-models-no-credential.txt`, `run2-models-with-credential.txt`.

## Why there is no regression

1. **Gating:** without a credential the handler returns before touching the config object (unit-tested in `features/openference-provider/index.test.ts` "leaves the config untouched when no credential is available" - byte-identical assertion).
2. **User config precedence:** every injected value uses `fillMissing`, so any user-written `provider.openference` field wins verbatim (unit-tested).
3. **Sibling provider untouched:** the opengateway feature and its config-handler integration test pass unchanged (`bun test packages/omo-opencode/src/plugin-handlers/` -> 237 pass, 0 fail; `features/` suite -> 2175 pass, 0 fail; audits -> 10 pass).
4. **Isolation proof:** the sandbox data dir shows a freshly created `opencode.db` (+shm/+wal) under `XDG_DATA_HOME`, so the QA process wrote exclusively inside the sandbox. The host `~/.local/share/opencode/opencode.db` timestamps move only with the interactive session that produced this evidence, not with the `opencode models` QA runs.

## Proof the intended change landed

- run 1 (no `OPENFERENCE_API_KEY`): `grep -c openference` -> **0**
- run 2 (`OPENFERENCE_API_KEY=sk-openference-qa-dummy`): **15** models listed:

```
openference/Auto
openference/DeepSeek-V4-Flash-0731
openference/DeepSeek-V4-Pro-0813
openference/DeepSeek-V4.1-Flash
openference/GLM-4.7-Flash
openference/GLM-5
openference/GLM-5.1
openference/GLM-5.2
openference/GLM-5.3
openference/GLM-5.3-Flash
openference/Kimi K2.6
openference/Kimi K2.7 Code
openference/MiniMax M3
openference/Nemotron-3-120B
openference/Qwen3.8 27b
```

Model IDs match the tracked `openference-models.json` catalog exactly.

## Live API verification

Live chat completion WAS exercised (run 3), using a real credential already configured on the QA host:

```bash
OPENFERENCE_API_KEY=<real host key> opencode run -m "openference/GLM-5.2" "Reply with exactly one word: ok"
```

Output (`run3-live-chat-glm-5.2.txt`): the session banner shows the model resolved as
`openference/GLM-5.2` and the live completion returned `ok` - proving the full chain:
credential gate -> provider injection -> catalog entry -> opencode's `@ai-sdk/openai-compatible`
loader -> live `POST https://api.openference.com/v1/chat/completions` -> response.

