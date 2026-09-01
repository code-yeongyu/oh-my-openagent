# PR #6485 scope correction — what the real execution path actually proves

Date: 2026-08-04. Author: MoerAI.

This file corrects an overclaim that earlier drafts of this PR made. It is written from
mechanical output captured in this same directory, not from reasoning about the code.

## What was previously claimed

That issue #6338 failed because the custom provider `azure-anthropic/claude-opus-4-8` was
unrecognized, so nothing stripped `temperature`, and that this PR fixes that case.

## What the real execution path shows

`packages/omo-opencode/src/plugin/chat-params.ts` is the boundary where OpenCode hands the
plugin the outgoing request parameters. Driving the REAL handler
(`chat-params-driver.ts`, output in `chat-params-integration.txt`) with the product reverted
to `upstream/dev`:

| model id | dev: temperature sent? |
|---|---|
| `azure-anthropic/claude-opus-4-8` | NO — already dropped on dev |
| `azure-anthropic/claude-opus-4-8-thinking` | **YES (0.1) — the real gap** |
| `anthropic/claude-opus-4-8` | NO — already dropped on dev |
| `openai/gpt-4o` (control) | YES (0.1), correctly — proves the driver is not vacuous |

`diag-capabilities.ts` explains why. `getModelCapabilities` resolves by canonical model ID
**regardless of provider**, so an unknown provider is not what breaks:

- `claude-opus-4-8` -> `resolutionMode: "snapshot-backed"`, `supportsTemperature: false`.
  The bundled snapshot already covers it, on any provider.
- `claude-opus-4-8-thinking` -> `resolutionMode: "heuristic-backed"`, `snapshot.source: "none"`,
  `supportsTemperature.source: "none"`. The reasoning suffix misses the snapshot, so nothing
  marks temperature unsupported and the value survives into the request.

## Corrected scope of this PR

This PR fixes **Opus 4.8 family model IDs that carry a reasoning/thinking suffix**, which miss
the bundled snapshot lookup. It does **not** change behavior for the plain `claude-opus-4-8`
ID reported in #6338 — current dev already handles that one.

Stated plainly: the literal model ID in #6338 no longer reproduces on current dev through the
real execution path. The defect this PR removes is the adjacent, still-live suffix case.

## Why the earlier unit RED overstated the impact

The unit RED/GREEN in `red-green-model-core-20260803.txt` exercised
`resolveCompatibleModelSettings` directly, supplying capabilities that do not match what the
integrated path supplies. `chat-params.ts` calls `getModelCapabilities` first and passes
snapshot-backed capabilities, which already carry `supportsTemperature: false` for the plain
ID. A unit RED is therefore not evidence of user-visible impact here; the chat.params driver
is.

## A harness that could NOT prove this, and was discarded

`live-request-driver.sh` drives real `opencode run` against a local mock model endpoint that
records the request body. It reports `TEMPERATURE_IN_REQUEST=false` both before and after the
fix. `diag-temp-forwarding.sh` shows why that is meaningless: a control model that fully
supports temperature (`azure-anthropic/general-chat-1`, agent temperature 0.1) also produces
`TEMPERATURE_IN_REQUEST=false`. OpenCode 1.18.11 does not forward an agent's configured
temperature into the request for a custom openai-compatible provider, so that harness cannot
observe this behavior at all.

Those files are retained for transparency. **Their output is a harness artifact and must not
be cited as evidence for or against this fix.**
