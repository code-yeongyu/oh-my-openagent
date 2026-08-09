# Ollama Troubleshooting

## Tool-call streaming failures

Historical Ollama reports include tool-using agent requests failing with an error such as:

```
JSON Parse error: Unexpected EOF
```

A current reproduction should exercise the registered `grep` and `task` surfaces.

## Current status

The OpenCode adapter currently uses `@opencode-ai/plugin` and `@opencode-ai/sdk`. The previous SDK-specific root-cause diagnosis does not describe this integration.

OMO agent overrides do not expose a supported `stream` setting. Disabling streaming there is not a current product workaround. A direct Ollama HTTP request can test the Ollama API, but it does not exercise OpenCode, OMO hooks, agent routing, or tool calls.

A fresh reproduction against the current OpenCode, OMO, and Ollama versions is required before the failing layer or a product workaround can be identified.

## Capture a current reproduction

1. Record the OpenCode, OMO, and Ollama versions and the exact Ollama model tag.
2. Start a clean session with the Ollama-backed model selected through your current OpenCode provider configuration.
3. Use a minimal prompt that requires a repository search through `grep`, then ask the agent to delegate a small follow-up through `task`.
4. Record whether ordinary text generation succeeds and which tool call first fails.
5. Save the complete error and relevant OpenCode/Ollama logs. Remove credentials before sharing them.

Do not treat a raw `curl` response as proof that the OMO agent path works or fails. The reproduction must pass through OpenCode and the registered OMO tool surface.

## Reporting the issue

Include:

- OpenCode, OMO, and Ollama versions
- Operating system and Ollama model tag
- The minimal prompt and the first failing tool name
- Redacted provider and agent configuration
- Full error text and relevant logs
- Whether the same model completes a no-tool prompt

These details are needed to determine whether the problem is in Ollama's response, the OpenCode provider integration, or OMO's tool-call path before documenting a supported workaround.
