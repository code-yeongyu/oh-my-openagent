# Atlas Cloud provider QA

Date: 2026-08-13

## Scope

This evidence covers the Atlas Cloud provider implementation for both supported host paths:

- OpenCode Ultimate: installer flag/TUI selection, OpenAI-compatible provider registration, model catalog, provider detection, model-ID qualification, and fallback routing.
- Codex Light / LazyCodex: Responses model-provider registration, generated installer/bootstrap parity, idempotence, cleanup ownership, and canonical LazyCodex README/logo synchronization.

The API key remained outside repository files. No key, authorization header, response ID, user config contents, or private environment dump is included here.

## Live Atlas Cloud compatibility check

Read-only catalog discovery observed:

- 468 total models from the Atlas Cloud catalog.
- 395 models visible in the console and 62 text models at the time of the check.
- The 12 coding models committed in `packages/model-core/src/atlas-cloud-models.ts` were present in the authenticated model list.
- Unauthenticated model and inference endpoints returned HTTP 401; invalid model requests returned HTTP 400.

One bounded, non-retried Responses request was sent with model `moonshotai/kimi-k3`, input `Reply with OK.`, and `max_output_tokens=8`. It returned HTTP 200 with a Responses object. The response was incomplete only because the deliberately small output cap was exhausted; usage was 109 input, 8 output, 117 total tokens. This proves the configured `wire_api = "responses"` path. The request was not repeated.

## OpenCode host proof

OpenCode CLI `1.15.13` was run from an ephemeral npm cache path with isolated `HOME` and XDG directories. No global package or real OpenCode database was changed.

`server-smoke.sh --self-test` passed:

- `GET /global/health`: healthy, version `1.15.13`.
- OpenAPI document: 113 paths.
- Unauthenticated `GET /session`: HTTP 401.

The production `addAtlasCloudProviderToOpenCodeConfig()` function then wrote an isolated config. Real `opencode debug config --pure` resolved:

- provider ID `atlascloud`;
- npm adapter `@ai-sdk/openai-compatible`;
- base URL `https://api.atlascloud.ai/v1`;
- API-key value as the environment placeholder `{env:ATLASCLOUD_API_KEY}`;
- 12 configured models.

Real `opencode models atlascloud --pure` exited 0 and listed all 12 provider-qualified model IDs. No API key was set and no inference request was made in this host-load proof.

The isolated OpenCode QA directory was moved to Trash after inspection.

## Codex host proof

Codex CLI `0.147.0-alpha.6.5` was run with isolated `CODEX_HOME` and the codex-qa local Responses mock.

- `install-verify.sh --self-test` passed with `OMO_SKIP_MATERIALIZE=1`: plugin cache present, `omo@sisyphuslabs` enabled, 9 component bins linked, agent TOMLs linked, and the driver's real-home guard passed.
- `app-server-drive.sh --self-test` completed a real Codex app-server Responses turn against the local mock.
- `app-server-drive.sh --plugin` installed the branch and completed a real turn. `sessionStart`, `userPromptSubmit`, and `stop` hooks completed; `missingHooks=[]` and `failedHooks=[]`.
- The driver reported the real `~/.codex/config.toml` unchanged before/after every isolated run.

The full dependency self-check reported only the missing local `tmux` executable. The app-server and install drivers used above do not require tmux. Expected isolated-host warnings were an unknown local mock model, untrusted project-local config, and a 401 from the optional remote featured-plugin lookup; none failed the local turn or hooks.

## Automated verification

Passing gates:

- Root TypeScript project: exit 0.
- Atlas-focused Bun suites: 154 passed, 0 failed, 474 assertions across 11 files.
- Generated Codex installer plus marketplace bootstrap Node suites: 32 passed, 0 failed.
- LazyCodex sync plus command-string audit: 16 passed, 0 failed.
- Codex installer freshness and publish-layout gates: 11 passed, 0 failed.
- Root Bun CLI, Node fallback CLI, and Codex installer builds: exit 0; rebuilding the committed Codex installer produced no tracked diff.
- Real packaged installer regression: installing twice registers Atlas Cloud once and does not select it as the default provider.

Behavior covered by the suites includes:

- OpenCode JSON and JSONC writes use an environment placeholder and preserve an existing user-owned `provider.atlascloud` object byte-for-byte.
- CLI and TUI installation both reach provider registration.
- Provider detection and availability include Atlas Cloud.
- Supported model IDs gain their upstream organization path before transport.
- Atlas Cloud is considered before the catch-all Vercel gateway only for supported fallback entries.
- Codex writes the canonical five-field Responses provider block without adding a root `model` or `model_provider`.
- Quoted and unquoted pre-existing Codex provider sections are preserved.
- Repeated Codex config updates and marketplace bootstrap runs are idempotent.
- Cleanup removes only an unchanged canonical managed section and preserves user-modified sections.
- LazyCodex README branding migrates to one managed section; a second sync is byte-identical and copies both official theme assets.

## Full-suite boundary

The broad `bun test` sweep progressed through thousands of passing tests and exposed one line-number allowlist drift introduced by the added documentation. The two exact allowlist entries were updated and the audit passed on rerun.

The remaining broad-suite/build failures are environmental prerequisites outside the Atlas Cloud paths:

- `packages/shared-skills/upstreams/open-design`, `taste-skill`, `ui-ux-pro-max`, and `designpowers` could not be fully materialized because GitHub clone/index-pack did not complete on this host.
- The complete Codex install asset test therefore found 0 of 27 expected `designpowers` reference files, while its new Atlas install-twice regression passed.
- Senpi skill/payload tests that require the same materialized sources could not assemble their full staged payload.
- The full build attempt reported two existing high-severity npm audit findings in nested dependencies. No automatic audit fix was run because that would be an unrelated dependency mutation.

The root CLI, Node fallback CLI, Codex installer, provider-specific tests, real OpenCode config load, and real Codex app-server/plugin paths do not depend on those missing third-party reference files and passed independently.

## Security and ownership review

- No secret is written to OpenCode or Codex config; only `ATLASCLOUD_API_KEY` references are persisted.
- No default model/provider is changed for Codex.
- Existing provider blocks are not overwritten.
- The single live compatibility request was bounded and not retried.
- LazyCodex remains a generated distribution repository. Provider source and README/logo synchronization live in `oh-my-openagent`; the closed distribution PR is not treated as an independently mergeable runtime implementation.
