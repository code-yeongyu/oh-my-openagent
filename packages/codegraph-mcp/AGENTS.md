# codegraph-mcp — Freshness-Preserving CodeGraph Proxy

MCP-layer package shared by the OpenCode and Codex adapters. It owns the
external stdio process boundary around CodeGraph: initial repository readiness,
per-`projectPath` incremental refresh, JSON-RPC forwarding, and process cleanup.

- Keep harness-specific config and provisioning policy in the adapters.
- Keep CodeGraph command resolution, workspace storage, and download manifests
  in `@oh-my-opencode/utils`.
- Never return a known-stale secondary-project result. A refresh failure becomes
  a JSON-RPC error for that request, while the proxy remains alive.
- Preserve both newline-delimited and `Content-Length` MCP framing.
