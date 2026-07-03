# Tool Call Middleware Changes

## 2026-04-11

### What changed and why

- Refactor the built-in text-based tool-call protocols toward the `minpeter/ai-sdk-tool-call-middleware` architecture.
- Focus areas:
  - `morph xml` parsing/streaming should stop manufacturing invalid JS values from malformed XML.
  - `hermes` should move toward a shared JSON-mix style parser/stream model.
  - `yaml+xml` support should be added with minimal surface-area changes.

### Progress

- Completed:
  - `morph xml` now rejects malformed `array<object>` payloads instead of coercing them into invalid strings.
  - `hermes` now delegates parsing/streaming to a shared JSON-mix helper so delimiter-based protocols can share logic with less drift.
  - `yaml+xml` support is now wired into the protocol registry with parser/formatter/stream coverage.
  - The stream wrapper now preserves reconstructed outer tool-call/text content across provider-side stream errors instead of falling back to the raw provider message.
  - When a transport error happens after complete tool-call blocks were already recovered, the wrapper now finishes the turn as `toolUse` so the agent can execute those tools instead of dropping the whole turn.

### Files expected to change

- `packages/ai/src/tool-call-middleware/protocols/morph-xml.ts`
- `packages/ai/src/tool-call-middleware/protocols/hermes.ts`
- `packages/ai/src/tool-call-middleware/context-transformer.ts`
- `packages/ai/src/tool-call-middleware/types.ts`
- `packages/ai/src/tool-call-middleware/index.ts`
- `packages/ai/src/tool-call-middleware/stream-wrapper.ts`
- `packages/ai/test/tool-call-middleware/*`

### Why the extension system could not handle this

- The defect is in the provider-agnostic tool-call parsing layer inside `packages/ai`, not in coding-agent UX glue.
- Fixing malformed XML coercion, streaming parser behavior, and protocol registration requires changes to shared core parsing logic.

### Expected merge conflict zones

- `packages/ai/src/tool-call-middleware/protocols/*`
- `packages/ai/src/tool-call-middleware/types.ts`
- `packages/ai/test/tool-call-middleware/*`
