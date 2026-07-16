# PR #6082 GPT-5.6 Copilot fallback QA

## What was tested

- The focused fallback/model compatibility suites, including the mixed custom-provider and Copilot regression in `delegate-core`.
- The same focused surface plus the overlapping runtime-fallback and plan-inheritance tests in a synthetic merge of PR head `2704556aa27ed870f239d53b2da5037099224b2c` with requested base `82bb52a900a414d4fdd56e334ab6b31a2478f92d`.
- `bun run typecheck:packages` across the package workspace.
- A real isolated OpenCode server loaded the PR plugin from this worktree and exposed its agent registry for two warm-cache scenarios: Copilot-only, and Copilot plus Vercel AI Gateway.
- A direct resolver probe exercised the provider-ordering edge that caused a long custom provider ID to lose to the shorter Copilot provider ID.

## What was observed

- The exact requested-base merge tree (`9653d2aff1867e84fb03b035463dd6d087b5bd37`) passed 211 focused tests. The custom-provider regression selects `long-custom-provider/gpt-5.6-sol` with `xhigh` ahead of the later Copilot `high` rung; the suite also covers Vercel/Copilot provider priority, runtime-fallback inheritance, Prometheus materialization, plan inheritance, OpenCode registration, and Senpi consumption.
- Package typechecking passed.
- Copilot-only selected GPT-5.6 Sol `high` for Hephaestus and Momus, with no Copilot GPT-5.x agent receiving `xhigh` or `max`.
- With Copilot and Vercel available, Momus selected `vercel/openai/gpt-5.6-sol` with `xhigh`, while Hephaestus selected Copilot GPT-5.6 Sol with `high`.
- The live OpenCode session count was unchanged before and after QA, and every temporary server and sandbox root was removed.

## Why it is enough

The focused tests cover fallback-table shape, provider transforms, variant compatibility, OpenCode registration, Senpi consumption, the repaired cross-provider ordering, and PR #6095's inherited Plan/Prometheus runtime fallback behavior. The isolated server proves the user-visible OpenCode registry behavior without a real provider call. The resolver probe covers the exact provider-ID-length-dependent defect that the live registry cannot express because static agent registration uses `model-core`, while delegated task resolution uses `delegate-core`.

The real OpenCode QA was run against source head `2704556aa27ed870f239d53b2da5037099224b2c`. The evidence-only commit that publishes this directory does not change any production or test source, so the driven plugin tree is byte-identical to the reviewed implementation.

## Artifacts

- `exact-82bb-focused-tests.txt`: exact `82bb52a9` merge tests, including #6095 overlap.
- `exact-82bb-typecheck-packages.txt`: exact `82bb52a9` merge package typecheck output.
- `copilot-only-agents-selected.json`: selected live agent registry rows.
- `copilot-vercel-agents-selected.json`: mixed-provider live agent registry rows.
- `custom-provider-resolver.json`: exact repaired resolver result.
- `isolation-and-cleanup.txt`: host DB and sandbox cleanup receipt.
- `versions-and-refs.txt`: tool versions and tested Git refs.
- `run.stdout.txt`: concise harness verdict.

## What was omitted

No real model API request was made. Provider credentials were fake loopback-compatible values, and no auth headers, tokens, environment dumps, or private logs were captured.
