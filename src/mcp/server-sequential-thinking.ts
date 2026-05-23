import type { LocalMcpConfig } from "./lsp"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"

type ServerSequentialThinkingOptions = {
  readonly resolveExecutable?: RuntimeExecutableResolver
}

// Wires the official @modelcontextprotocol/server-sequential-thinking package
// into oh-my-openagent's builtin MCP set. The server exposes one tool —
// `sequentialthinking` — that lets a model externalise a multi-step plan and
// revise individual steps without burning thinking-budget tokens. This is most
// useful for the small, no-thinking-mode models in our fallback chains
// (gpt-5-nano, minimax, kimi etc.) where the model otherwise has nowhere to
// stash partial reasoning between tool calls.
//
// The server is stateless (no on-disk state, no env vars), so we just hand it
// to `npx -y` and let it warm up on demand. When npx is not on PATH we mark
// the MCP disabled rather than scheduling a launch that would fail at the
// first request and confuse the user.
export function createServerSequentialThinkingConfig(
  options: ServerSequentialThinkingOptions = {},
): LocalMcpConfig {
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const npx = resolveExecutable("npx")
  return {
    type: "local",
    command: [npx.command, "-y", "@modelcontextprotocol/server-sequential-thinking"],
    enabled: npx.available,
  }
}
