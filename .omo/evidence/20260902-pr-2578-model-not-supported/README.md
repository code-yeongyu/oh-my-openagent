# PR 2578 model-not-supported QA evidence

## What was tested

1. Deterministic classifier and fallback-handler path:
   - `bun test packages/model-core/src/model-error-classifier.test.ts packages/omo-opencode/src/plugin/event.model-fallback.test.ts packages/omo-opencode/src/plugin/event.model-fallback-pin-agent.test.ts packages/omo-opencode/src/plugin/event.model-fallback-2941.test.ts --bail`
   - `node_modules/.bin/tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
2. Real isolated OpenCode server surface:
   - built the local plugin with `bun run build`;
   - started `opencode serve` with isolated HOME and XDG data/config/cache/state roots;
   - loaded the local `dist/index.js`;
   - drove a custom provider error through `prompt_async`;
   - captured the real `/event` SSE stream;
   - compared the host OpenCode session count before and after.

## What was observed

- Focused suites: 64 pass, 0 fail, 133 assertions.
- The classifier test proves `{ name: "ModelNotSupportedError" }` with no message is retryable.
- The event-level regression proves a name-only `session.error` uses the stored active `opencode-go/kimi-k3` model when arming fallback instead of the hard-coded first model.
- Scoped OpenCode adapter typecheck passed.
- The isolated live server emitted `session.error` on the SSE wire for the unsupported-model provider response.
- Host OpenCode session count was unchanged: 1814 before and 1814 after.
- The live provider surface wrapped the provider payload as `APIError` with `message=model_not_supported`; therefore the exact name-only shape is covered deterministically at the plugin event boundary rather than being fabricated as a provider response.

## Why this is enough

The changed classifier is exercised directly, and the consuming OpenCode fallback handler is exercised with the exact missing-message/name-only event shape plus an already-selected active fallback model. The real harness separately proves that the relevant `session.error` lifecycle surface reaches the plugin in an isolated OpenCode server without touching host session state. Pin-agent and issue-2941 fallback regressions remain green.

## What was omitted

Raw server logs and the full SSE stream were not committed because they contain volatile session identifiers and repetitive runtime events. No credentials, auth headers, host configuration, or private paths are included.
