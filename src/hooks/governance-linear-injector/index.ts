import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"
import {
  type LinearInjectorConfig,
  type LinearIssueContext,
  type SessionIssueCache,
  DEFAULT_LINEAR_INJECTOR_CONFIG,
} from "./types"

export * from "./types"

/**
 * Extract Linear issue identifiers from text.
 * Matches patterns like LIF-123, ABC-456, etc.
 */
function extractIssueIdentifiers(text: string, teamPrefix: string): string[] {
  // Create regex for the team prefix pattern
  const pattern = new RegExp(`\\b(${teamPrefix}-\\d+)\\b`, "gi")
  const matches = text.match(pattern)
  if (!matches) return []

  // Deduplicate and normalize to uppercase
  return [...new Set(matches.map((m) => m.toUpperCase()))]
}

/**
 * Format issue context for injection into prompt.
 */
function formatIssueContext(issues: LinearIssueContext[]): string {
  if (issues.length === 0) return ""

  const lines: string[] = [
    "<linear_context>",
    "## Linear Issue Context",
    "",
  ]

  for (const issue of issues) {
    lines.push(`### ${issue.identifier}: ${issue.title}`)
    lines.push(`- **Status**: ${issue.status}`)
    lines.push(`- **URL**: ${issue.url}`)
    if (issue.branchName) {
      lines.push(`- **Branch**: \`${issue.branchName}\``)
    }
    if (issue.labels && issue.labels.length > 0) {
      lines.push(`- **Labels**: ${issue.labels.join(", ")}`)
    }
    if (issue.parentIdentifier) {
      lines.push(`- **Parent**: ${issue.parentIdentifier}`)
    }
    if (issue.description) {
      // Truncate description to first 200 chars
      const truncated =
        issue.description.length > 200
          ? issue.description.slice(0, 200) + "..."
          : issue.description
      lines.push(`- **Description**: ${truncated}`)
    }
    lines.push("")
  }

  lines.push("</linear_context>")
  return lines.join("\n")
}

/**
 * Creates the governance Linear injector hook.
 * This hook detects Linear issue references and injects context.
 *
 * @param ctx - Plugin context
 * @param config - Optional configuration override
 * @returns Hook handlers
 */
export function createGovernanceLinearInjectorHook(
  ctx: PluginInput,
  config?: Partial<LinearInjectorConfig>
) {
  const finalConfig: LinearInjectorConfig = {
    ...DEFAULT_LINEAR_INJECTOR_CONFIG,
    ...config,
  }

  if (!finalConfig.enabled) {
    log("Governance Linear injector disabled")
    return null
  }

  // Session caches
  const sessionCaches = new Map<string, SessionIssueCache>()

  log("Governance Linear injector initialized", {
    team_prefix: finalConfig.team_prefix,
    cache_issues: finalConfig.cache_issues,
  })

  /**
   * Get or create session cache
   */
  function getSessionCache(sessionId: string): SessionIssueCache {
    let cache = sessionCaches.get(sessionId)
    if (!cache) {
      cache = {
        issues: new Map(),
        injectedIdentifiers: new Set(),
      }
      sessionCaches.set(sessionId, cache)
    }
    return cache
  }

  /**
   * Fetch issue context from Linear MCP
   */
  async function fetchIssueContext(
    identifier: string
  ): Promise<LinearIssueContext | null> {
    try {
      const result = await ctx.client.mcp.call({
        server: "linear",
        method: "tools/call",
        params: {
          name: "linear_get_issue",
          arguments: { id: identifier },
        },
      })

      if (result.error) {
        log(`[linear-injector] Failed to fetch ${identifier}:`, result.error)
        return null
      }

      const data = result.data as {
        id?: string
        identifier?: string
        title?: string
        state?: { name?: string }
        description?: string
        branchName?: string
        url?: string
        parent?: { identifier?: string }
        labels?: { nodes?: Array<{ name?: string }> }
      }

      return {
        id: data.id || "",
        identifier: data.identifier || identifier,
        title: data.title || "Unknown",
        status: data.state?.name || "Unknown",
        description: data.description,
        branchName: data.branchName,
        url: data.url || `https://linear.app/issue/${identifier}`,
        parentIdentifier: data.parent?.identifier,
        labels: data.labels?.nodes?.map((l) => l.name || "").filter(Boolean),
      }
    } catch (error) {
      log(`[linear-injector] Error fetching ${identifier}:`, error)
      return null
    }
  }

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const cache = getSessionCache(input.sessionID)

      // Extract text from message parts
      const textParts = output.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text as string)
      const fullText = textParts.join("\n")

      // Find issue identifiers
      const identifiers = extractIssueIdentifiers(fullText, finalConfig.team_prefix)
      if (identifiers.length === 0) return

      // Filter out already injected identifiers
      const newIdentifiers = identifiers.filter(
        (id) => !cache.injectedIdentifiers.has(id)
      )
      if (newIdentifiers.length === 0) return

      log(`[linear-injector] Found new issue references: ${newIdentifiers.join(", ")}`)

      // Fetch issue contexts
      const contexts: LinearIssueContext[] = []
      for (const identifier of newIdentifiers) {
        // Check cache first
        let context = cache.issues.get(identifier)
        if (!context) {
          context = await fetchIssueContext(identifier)
          if (context && finalConfig.cache_issues) {
            cache.issues.set(identifier, context)
          }
        }
        if (context) {
          contexts.push(context)
          cache.injectedIdentifiers.add(identifier)
        }
      }

      if (contexts.length === 0) return

      // Format and inject context
      const contextText = formatIssueContext(contexts)
      const message = output.message as {
        agent?: string
        model?: { modelID?: string; providerID?: string }
        path?: { cwd?: string; root?: string }
        tools?: Record<string, boolean>
      }

      const success = injectHookMessage(input.sessionID, contextText, {
        agent: message.agent,
        model: message.model,
        path: message.path,
        tools: message.tools,
      })

      if (success) {
        log(`[linear-injector] Injected context for: ${contexts.map((c) => c.identifier).join(", ")}`)
      }
    },

    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }): Promise<void> => {
      // Clean up cache on session delete
      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } } | undefined
        if (props?.info?.id) {
          sessionCaches.delete(props.info.id)
        }
      }
    },
  }
}
