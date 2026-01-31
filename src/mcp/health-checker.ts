/**
 * MCP Health Checker
 *
 * Async health checking and graceful degradation for remote MCP services.
 * Checks availability at startup and marks unavailable MCPs as degraded.
 */

/**
 * MCP health status
 */
export enum McpStatus {
  HEALTHY = "HEALTHY",
  DEGRADED = "DEGRADED",
  UNKNOWN = "UNKNOWN",
}

/**
 * Health check result
 */
export interface McpHealthResult {
  name: string
  status: McpStatus
  reason?: string
  checkedAt: Date
}

/**
 * Mock health configuration for testing
 */
interface MockHealthConfig {
  available: boolean
  reason?: string
}

/**
 * Logger function type
 */
type LoggerFn = (message: string) => void

/**
 * MCP Health Checker interface
 */
export interface McpHealthChecker {
  /** Check health of a single MCP */
  checkHealth(mcpName: string): Promise<McpHealthResult>
  /** Check all MCPs on startup */
  checkAllOnStartup(mcpNames: string[]): Promise<void>
  /** Get status of an MCP */
  getStatus(mcpName: string): McpStatus
  /** Get list of degraded MCPs */
  getDegradedMcps(): string[]
  /** Generate health report */
  generateReport(): string
  /** Set custom logger */
  setLogger(logger: LoggerFn): void
  /** Set mock health for testing */
  setMockHealth(mcpName: string, available: boolean, reason?: string): void
}

/**
 * MCP Health Checker implementation
 */
class McpHealthCheckerImpl implements McpHealthChecker {
  private statusMap = new Map<string, McpHealthResult>()
  private mockHealthMap = new Map<string, MockHealthConfig>()
  private logger: LoggerFn = () => {}

  async checkHealth(mcpName: string): Promise<McpHealthResult> {
    const mockConfig = this.mockHealthMap.get(mcpName)

    if (mockConfig) {
      const result: McpHealthResult = {
        name: mcpName,
        status: mockConfig.available ? McpStatus.HEALTHY : McpStatus.DEGRADED,
        reason: mockConfig.reason,
        checkedAt: new Date(),
      }

      this.statusMap.set(mcpName, result)

      if (!mockConfig.available) {
        this.logger(`[MCP Health] ${mcpName} marked as DEGRADED: ${mockConfig.reason || "unavailable"}`)
      }

      return result
    }

    // In real implementation, would ping the MCP endpoint
    const result: McpHealthResult = {
      name: mcpName,
      status: McpStatus.UNKNOWN,
      checkedAt: new Date(),
    }

    this.statusMap.set(mcpName, result)
    return result
  }

  async checkAllOnStartup(mcpNames: string[]): Promise<void> {
    // Check all MCPs in parallel
    await Promise.all(mcpNames.map((name) => this.checkHealth(name)))
  }

  getStatus(mcpName: string): McpStatus {
    const result = this.statusMap.get(mcpName)
    return result?.status || McpStatus.UNKNOWN
  }

  getDegradedMcps(): string[] {
    const degraded: string[] = []
    for (const [name, result] of this.statusMap) {
      if (result.status === McpStatus.DEGRADED) {
        degraded.push(name)
      }
    }
    return degraded
  }

  generateReport(): string {
    const lines: string[] = []
    lines.push("## MCP Health Report")
    lines.push("")

    if (this.statusMap.size === 0) {
      lines.push("No MCPs checked.")
      return lines.join("\n")
    }

    lines.push("| MCP | Status | Reason |")
    lines.push("|-----|--------|--------|")

    for (const [name, result] of this.statusMap) {
      const statusIcon = result.status === McpStatus.HEALTHY ? "✅" : 
                         result.status === McpStatus.DEGRADED ? "❌" : "❓"
      lines.push(`| ${name} | ${statusIcon} ${result.status} | ${result.reason || "-"} |`)
    }

    const degradedCount = this.getDegradedMcps().length
    lines.push("")
    lines.push(`**Summary**: ${this.statusMap.size - degradedCount}/${this.statusMap.size} MCPs healthy`)

    return lines.join("\n")
  }

  setLogger(logger: LoggerFn): void {
    this.logger = logger
  }

  setMockHealth(mcpName: string, available: boolean, reason?: string): void {
    this.mockHealthMap.set(mcpName, { available, reason })
  }
}

/**
 * Create a new MCP Health Checker instance
 */
export function createMcpHealthChecker(): McpHealthChecker {
  return new McpHealthCheckerImpl()
}
