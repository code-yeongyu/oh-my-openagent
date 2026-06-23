import type { McpStateMap } from "./diff"

type McpStatusLike = { status?: string } | undefined | null
type McpStatusResponseLike = { data?: Record<string, McpStatusLike> } | Record<string, McpStatusLike>

export interface McpStateFetcherClient {
  mcp: {
    status: (args: {
      query?: { directory?: string }
    }) => Promise<McpStatusResponseLike>
  }
}

export async function fetchRuntimeMcpStates(
  client: McpStateFetcherClient,
  directory: string,
): Promise<McpStateMap> {
  const result = await client.mcp.status({ query: { directory } })
  const map: Record<string, McpStatusLike> = isResponseWrapper(result)
    ? (result.data ?? {})
    : (result as Record<string, McpStatusLike>)
  const states: McpStateMap = new Map()
  for (const [name, value] of Object.entries(map)) {
    if (!value || typeof value !== "object") continue
    states.set(name, value.status === "disabled" ? "disabled" : "enabled")
  }
  return states
}

function isResponseWrapper(value: unknown): value is { data?: Record<string, McpStatusLike> } {
  return Boolean(value) && typeof value === "object" && "data" in (value as object)
}
