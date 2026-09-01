type RemoteMcpConfig = {
  readonly type: "remote"
  readonly url: string
  readonly enabled: boolean
  readonly headers?: Record<string, string>
  readonly oauth: false
}

export function createContext7Config(env: Record<string, string | undefined> = process.env): RemoteMcpConfig {
  const context7ApiKey = normalizeContext7ApiKey(env.CONTEXT7_API_KEY)

  return {
    type: "remote" as const,
    url: "https://mcp.context7.com/mcp",
    enabled: true,
    ...(context7ApiKey ? { headers: { Authorization: `Bearer ${context7ApiKey}` } } : {}),
    oauth: false as const,
  }
}

function normalizeContext7ApiKey(value: string | undefined): string | null {
  if (value === undefined || isPlaceholderContext7ApiKey(value)) return null
  return value.trim()
}

function isPlaceholderContext7ApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[<>"'`]/g, "").replace(/[\s_-]+/g, " ")
  return normalized.length === 0 || normalized === "your api key"
}

export const context7 = createContext7Config()
