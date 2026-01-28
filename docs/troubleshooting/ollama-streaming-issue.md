# Ollama Streaming Issue - JSON Parse Error

## Problem

When using Ollama as a provider with oh-my-opencode agents, you may encounter:

```
JSON Parse error: Unexpected EOF
```

This occurs when agents attempt tool calls (e.g., `explore` agent using `mcp_grep_search`).

## Root Cause

Ollama returns **NDJSON** (newline-delimited JSON) when `stream: true` is used in API requests:

```json
{"message":{"tool_calls":[{"function":{"name":"read","arguments":{"filePath":"README.md"}}}]}, "done":false}
{"message":{"content":""}, "done":true}
```

Claude Code SDK expects a single JSON object, not multiple NDJSON lines, causing the parse error.

### Why This Happens

- **Ollama API**: Returns streaming responses as NDJSON by design
- **Claude Code SDK**: Doesn't properly handle NDJSON responses for tool calls
- **oh-my-opencode**: Passes through the SDK's behavior (can't fix at this layer)

## Solutions

### Option 1: Disable Streaming (Recommended - Immediate Fix)

Configure your Ollama provider to use `stream: false`:

```json
{
  "provider": "ollama",
  "model": "qwen3-coder",
  "stream": false
}
```

**Pros:**
- Works immediately
- No code changes needed
- Simple configuration

**Cons:**
- Slightly slower response time (no streaming)
- Less interactive feedback

### Option 2: Use Non-Tool Agents Only

If you need streaming, avoid agents that use tools:

- ✅ **Safe**: Simple text generation, non-tool tasks
- ❌ **Problematic**: Any agent with tool calls (explore, librarian, etc.)

### Option 3: Wait for SDK Fix (Long-term)

The proper fix requires Claude Code SDK to:

1. Detect NDJSON responses
2. Parse each line separately
3. Merge `tool_calls` from multiple lines
4. Return a single merged response

**Tracking**: https://github.com/code-yeongyu/oh-my-opencode/issues/1124

## Workaround Implementation

Until the SDK is fixed, here's how to implement NDJSON parsing (for SDK maintainers):

```typescript
async function parseOllamaStreamResponse(response: string): Promise<object> {
  const lines = response.split('\n').filter(line => line.trim());
  const mergedMessage = { tool_calls: [] };

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.message?.tool_calls) {
        mergedMessage.tool_calls.push(...json.message.tool_calls);
      }
      if (json.message?.content) {
        mergedMessage.content = json.message.content;
      }
    } catch (e) {
      // Skip malformed lines
      console.warn('Skipping malformed NDJSON line:', line);
    }
  }

  return mergedMessage;
}
```

## Testing

To verify the fix works:

```bash
# Test with curl (should work with stream: false)
curl -s http://localhost:11434/api/chat \
  -d '{
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": "Read file README.md"}],
    "stream": false,
    "tools": [{"type": "function", "function": {"name": "read", "description": "Read a file", "parameters": {"type": "object", "properties": {"filePath": {"type": "string"}}, "required": ["filePath"]}}}]
  }'
```

## Related Issues

- **oh-my-opencode**: https://github.com/code-yeongyu/oh-my-opencode/issues/1124
- **Ollama API Docs**: https://github.com/ollama/ollama/blob/main/docs/api.md

## Getting Help

If you encounter this issue:

1. Check your Ollama provider configuration
2. Set `stream: false` as a workaround
3. Report any additional errors to the issue tracker
4. Provide your configuration (without secrets) for debugging
