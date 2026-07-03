# packages/ai/src/tool-call-middleware

Text-format tool-call protocols for providers that don't support native function calling. Wraps `openai-completions` streams and parses `<tool_call>` / XML / delimiter formats back into pi's canonical `toolCall` events. Fork-modified — see `changes.md`.

## FILES

```
tool-call-middleware/
├── index.ts                    # Public exports — wrap()/registry/types
├── types.ts                    # Protocol interface (parse, format, stream)
├── context-transformer.ts      # System-prompt + message rewriting per protocol
├── stream-wrapper.ts           # Wraps AssistantMessageEventStream → re-parses chunks
├── protocols/
│   ├── hermes.ts               # Hermes <tool_call>{json}</tool_call> (Qwen, Mistral fine-tunes)
│   ├── morph-xml.ts            # <fn><arg>val</arg></fn> XML (Gemini-style)
│   ├── yaml-xml.ts             # YAML body inside XML tags
│   ├── gemma4.ts               # Gemma 4 delimiter format `<|tool_call>call:name{…}<tool_call|>`
│   ├── json-mix.ts             # Shared JSON-mix helper (Hermes + delimited variants)
│   └── xml-tool-tag-scanner.ts # Streaming XML tag boundary scanner
├── TESTING.md                  # Manual test commands per protocol (OpenRouter live API)
└── changes.md                  # Fork tracker: morph-xml strict mode, yaml+xml, stream error preservation
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Add a new text-tool protocol | `protocols/<name>.ts` + register in `index.ts` + extend the `ToolCallFormat` union/whitelist (see ADD A PROTOCOL step 4) |
| Fix a parser bug | `protocols/<name>.ts` (parse step) |
| Fix streaming partial-arg bug | `protocols/<name>.ts` (stream step) + `stream-wrapper.ts` |
| System-prompt format for tools | `context-transformer.ts` (per-protocol prompt injector) |
| Cross-provider stream error fallback | `stream-wrapper.ts` — preserves reconstructed outer text+toolCalls on transport error |

## ADD A PROTOCOL (5 steps)

1. Implement `Protocol` interface in `protocols/<name>.ts` (parse, format, stream).
2. Add system-prompt rendering for tools to `context-transformer.ts`.
3. Export from `index.ts` and register in the protocol registry.
4. Add `"<name>"` to the `ToolCallFormat` union in `types.ts` (this dir), the literal whitelist in `getToolCallFormat()` in `index.ts`, and the `toolCallFormat` TypeBox union in `packages/coding-agent/src/core/model-registry.ts` (validates `~/.senpi/agent/models.json`).
5. Add manual test command to `TESTING.md` and an automated test under `packages/ai/test/tool-call-middleware/<name>*.test.ts`.

## CONVENTIONS

- **Stream-error preservation** (2026-04-11): when a provider stream errors AFTER complete tool-call blocks were reconstructed, finish the turn as `toolUse` so the agent still executes those tools. Do NOT fall back to the raw provider message.
- **Strict parsing**: reject malformed XML/JSON instead of coercing into invalid strings (precedent: `morph-xml` array<object> handling).
- **Delegate to `json-mix.ts`** for any new JSON-inside-delimiters protocol — minimizes drift across Hermes-family parsers.
- **`xml-tool-tag-scanner.ts`** is the canonical streaming boundary detector; reuse it for any XML-tag-based protocol.

## ANTI-PATTERNS

- Coercing malformed input into a "best-effort" string — produces invalid downstream `tool_call.arguments`. Reject instead.
- Duplicating Hermes-style parsing in a new file — extract a shared helper in `json-mix.ts`.
- Forgetting to inject the protocol-specific system-prompt block in `context-transformer.ts` — model never emits tool calls.
- Writing tests against live OpenRouter without `describe.skipIf(!process.env.OPENROUTER_API_KEY)` gating.

## NOTES

- `TESTING.md` documents the canonical live-API test commands per protocol (Qwen for Hermes, Gemini for MorphXML, Gemma 4 for delimiter). Update it when adding new protocols.
- This package's middleware is fork-modified — see `changes.md` for the architectural rewrite toward `minpeter/ai-sdk-tool-call-middleware` style.
- `compat.toolCallFormat` on a custom model in `~/.senpi/agent/models.json` is what activates middleware for that model.
