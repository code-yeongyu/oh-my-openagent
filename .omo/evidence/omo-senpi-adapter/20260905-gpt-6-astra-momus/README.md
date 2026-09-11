# Evidence: momus runs GPT-6 Astra instead of GPT-5.6

Branch `feat/gpt-6-astra-momus` off `dev` @ `7c839408e`.

## What was tested

Every test run happened on **mengmotaMac** through the bunshin mesh, never on the authoring machine.
Each pass used a throwaway remote clone of the pushed branch, installed with the repo's own toolchain:

```
mkdir -p /tmp/astra-momus-<date> && cd $_ \
  && git clone -q --depth 50 -b feat/gpt-6-astra-momus https://github.com/code-yeongyu/oh-my-openagent.git omo \
  && cd omo && bun install --frozen-lockfile --ignore-scripts \
  && bun test packages/model-core \
  && bun test packages/senpi-task \
  && bun test packages/omo-opencode/src/agents \
  && bun test packages/omo-opencode/src/cli/model-fallback.test.ts \
  && bun run typecheck:packages
```

Surfaces driven and the behavior each was meant to prove:

- `packages/model-core` — the authoritative `AGENT_MODEL_REQUIREMENTS.momus` chain and its live
  resolution through `resolveModelWithFallback`, including the GitHub Copilot tier cap.
- `packages/senpi-task` — the independent hand transcription `AGENT_FALLBACK_CHAINS.momus` (length pin
  + entry-for-entry pin) and `resolveAgent` variant precedence over a variant-bearing rung.
- `packages/omo-opencode/src/agents` — momus prompt gating (`createMomusAgent`) and warm-cache
  registration order for Astra ids.
- `packages/omo-opencode/src/cli/model-fallback.test.ts` — the generated installer config for an
  OpenAI-only and a Copilot-only account.
- `bun run typecheck:packages` — the whole package graph.
- `resolution-proof.ts` (in this directory) — a small script resolving the shipped momus chain against
  five provider situations and asserting the two transcriptions are byte-identical.

## What was observed

**RED** (`RED.txt`), captured at commit `b6657a90a` with the rewritten tests but the production chain
still on GPT-5.6: 12 momus-related failures across model-core, senpi-task, and omo-opencode, plus 2
failures that are pre-existing on `dev` (see below). `2588 pass / 14 fail`.

**GREEN** (`GREEN.txt`), captured at commit `0c5b1afa9` on a fresh remote clone:

| Pass | Result |
|---|---|
| `bun test packages/model-core` | 382 pass, 0 fail |
| `bun test packages/senpi-task` | 1886 pass, 1 skip, **2 fail (pre-existing on dev)** |
| `bun test packages/omo-opencode/src/agents` | 314 pass, 0 fail |
| `bun test packages/omo-opencode/src/cli/model-fallback.test.ts` | 18 pass, 0 fail |
| `bun run typecheck:packages` | exit 0 |

`PROOF.txt` shows the shipped chain resolving to `openai-codex/gpt-6-astra` **xhigh** when native Astra
is available, `github-copilot/gpt-6-astra` **high** when only Copilot is, `opencode/gpt-6-astra` high on
an opencode-only account, native xhigh winning when native and Copilot are both present, and
`anthropic/claude-opus-5` max when no Astra rung exists — plus `matches: true` for the two independent
chain transcriptions.

**Pre-existing failures, not caused by this change** (`PREEXISTING-dev-failures.txt`): the two
`gated-categories.test.ts` cases pin the old `(requires gpt-5.6-sol)` annotation while `dev` already
ships `(requires gpt-6-astra or gpt-5.6-sol)`. Reproduced on a clean checkout of `7c839408e` on the same
machine before this branch touched anything. That file's gate belongs to the concurrent category-prompt
session and is deliberately untouched here.

## Why it is enough

The momus chain is transcribed in two independent places, and both transcriptions are pinned by tests
that fail loudly on drift (`fallback-chains.test.ts` pins length **and** every entry; the model-core test
pins the first four rungs and asserts no `gpt-5.6-*` rung survives). Resolution is proven behaviorally,
not just structurally: the Copilot cap, the native-over-Copilot preference, the opencode-only rung, and
the non-GPT tail are each exercised against `resolveModelWithFallback`, and the installer's generated
config is asserted for both single-provider accounts. Prompt gating was verified rather than assumed —
`createMomusAgent` already routed GPT-6 through `isGpt6Model` to `MOMUS_GPT_5_6_PROMPT`, and a new test
pins that for `github-copilot/gpt-6-astra` and `openai/gpt-6-astra-fast` (the ids momus can now actually
resolve to) instead of only the bare native id.

## What was omitted

- No live OpenCode/Codex/Senpi session was driven: this change touches only hardcoded fallback data,
  its two transcriptions, and prose. There is no hook, tool, schema, CLI, or installer code path added
  or removed, so the unit + resolution gates cover the whole blast radius.
- No secrets, tokens, env dumps, or auth headers appear in any artifact; the logs are test output only.
- The remote temp directories (`/tmp/astra-momus-red`, `/tmp/astra-momus-<date>`) were deleted after the
  receipts were pulled.

## bunshin receipt

```
$ rm -rf /tmp/astra-momus-red /tmp/astra-momus-20260905; echo RM_EXIT=$?; ls -d /tmp/astra-momus-* 2>&1 | head
RM_EXIT=0
ls: /tmp/astra-momus-*: No such file or directory
```

Machine: `mengmotaMac` (macos/aarch64, online), driven through the bunshin SDK; `bun test` and
`bun run typecheck:packages` never ran on the authoring workstation.
