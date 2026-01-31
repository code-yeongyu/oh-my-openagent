/**
 * Lazy MCP Loader - Shadow MCP implementation
 *
 * Implements lazy loading for MCPs to reduce startup overhead.
 * MCPs are only loaded when first accessed.
 */

export interface LazyMcpConfig {
  name: string
  type: "remote"
  url: string
  lazy: boolean
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
  validator?: () => void | Promise<void>
}

export interface McpStatus {
  name: string
  lazy: boolean
  loaded: boolean
  error?: string
  loadedAt?: Date
}

export interface RemoteMcpConfig {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export interface LazyMcpRegistry {
  register(config: LazyMcpConfig): void
  get(name: string): Promise<RemoteMcpConfig | undefined>
  getStatus(name: string): McpStatus | undefined
  getAllLoaded(): Record<string, RemoteMcpConfig>
  getAllStatuses(): McpStatus[]
}

interface InternalMcpEntry {
  config: LazyMcpConfig
  status: McpStatus
  loadedConfig?: RemoteMcpConfig
}

/**
 * Creates a lazy MCP registry that supports shadow MCP registration.
 *
 * Shadow MCPs are registered with metadata only and loaded on first access.
 */
export function createLazyMcpRegistry(): LazyMcpRegistry {
  const entries = new Map<string, InternalMcpEntry>()

  function register(config: LazyMcpConfig): void {
    const status: McpStatus = {
      name: config.name,
      lazy: config.lazy,
      loaded: !config.lazy, // Eager MCPs are marked as loaded immediately
    }

    const loadedConfig: RemoteMcpConfig | undefined = config.lazy
      ? undefined
      : {
          type: config.type,
          url: config.url,
          enabled: config.enabled,
          headers: config.headers,
          oauth: config.oauth,
        }

    if (!config.lazy) {
      status.loadedAt = new Date()
    }

    entries.set(config.name, {
      config,
      status,
      loadedConfig,
    })
  }

  async function get(name: string): Promise<RemoteMcpConfig | undefined> {
    const entry = entries.get(name)
    if (!entry) {
      return undefined
    }

    // Return cached config if already loaded
    if (entry.loadedConfig) {
      return entry.loadedConfig
    }

    // Load the MCP
    try {
      // Run validator if provided
      if (entry.config.validator) {
        await entry.config.validator()
      }

      const loadedConfig: RemoteMcpConfig = {
        type: entry.config.type,
        url: entry.config.url,
        enabled: entry.config.enabled,
        headers: entry.config.headers,
        oauth: entry.config.oauth,
      }

      entry.loadedConfig = loadedConfig
      entry.status.loaded = true
      entry.status.loadedAt = new Date()

      return loadedConfig
    } catch (error) {
      entry.status.error =
        error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  function getStatus(name: string): McpStatus | undefined {
    return entries.get(name)?.status
  }

  function getAllLoaded(): Record<string, RemoteMcpConfig> {
    const result: Record<string, RemoteMcpConfig> = {}

    for (const [name, entry] of entries) {
      if (entry.loadedConfig) {
        result[name] = entry.loadedConfig
      }
    }

    return result
  }

  function getAllStatuses(): McpStatus[] {
    return Array.from(entries.values()).map((entry) => entry.status)
  }

  return {
    register,
    get,
    getStatus,
    getAllLoaded,
    getAllStatuses,
  }
}

/**
 * Default timeout for lazy loading MCPs (10 seconds)
 */
export const LAZY_LOAD_TIMEOUT_MS = 10_000
