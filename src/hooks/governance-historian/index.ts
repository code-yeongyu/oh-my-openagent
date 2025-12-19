import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  type HistorianConfig,
  type SessionState,
  type ChangelogEntry,
  type FileChange,
  DEFAULT_HISTORIAN_CONFIG,
} from "./types"
import * as fs from "fs"
import * as path from "path"

export * from "./types"

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]
}

/**
 * Generate changelog filename
 */
function generateChangelogFilename(
  date: Date,
  agent: string,
  scope: string
): string {
  const dateStr = formatDate(date)
  const agentSlug = agent.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const scopeSlug = scope.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return `${dateStr}__${agentSlug}__${scopeSlug}.md`
}

/**
 * Infer scope from file paths
 */
function inferScope(files: string[]): string {
  if (files.length === 0) return "general"

  // Check for common patterns
  const patterns = [
    { regex: /context\/specs\/([^/]+)/, name: (m: string) => m },
    { regex: /\.cursor\/specs\/([^/]+)/, name: (m: string) => m },
    { regex: /src\/([^/]+)/, name: (m: string) => m },
    { regex: /docs\/([^/]+)/, name: (m: string) => `docs-${m}` },
    { regex: /tests?\//, name: () => "testing" },
  ]

  for (const file of files) {
    for (const pattern of patterns) {
      const match = file.match(pattern.regex)
      if (match) {
        return pattern.name(match[1] || "")
      }
    }
  }

  return "general"
}

/**
 * Generate changelog markdown content
 */
function generateChangelogContent(entry: ChangelogEntry): string {
  const lines: string[] = [
    `# Changelog: ${entry.date}`,
    "",
    `**Agent**: ${entry.agent}`,
    `**Scope**: ${entry.scope}`,
    `**Session**: ${entry.sessionId}`,
    "",
    "## Summary",
    "",
    entry.summary,
    "",
    "## Files Changed",
    "",
  ]

  for (const file of entry.files) {
    const icon = file.type === "created" ? "+" : file.type === "deleted" ? "-" : "~"
    lines.push(`- \`${icon}\` ${file.path}`)
  }

  return lines.join("\n")
}

/**
 * Creates the governance historian hook.
 * This hook tracks file modifications and creates changelog entries.
 *
 * @param ctx - Plugin context
 * @param config - Optional configuration override
 * @returns Hook handlers
 */
export function createGovernanceHistorianHook(
  ctx: PluginInput,
  config?: Partial<HistorianConfig>
) {
  const finalConfig: HistorianConfig = {
    ...DEFAULT_HISTORIAN_CONFIG,
    ...config,
  }

  if (!finalConfig.enabled) {
    log("Governance historian disabled")
    return null
  }

  // Track session states
  const sessionStates = new Map<string, SessionState>()
  
  // Track tool call args (callID -> args) for use in tool.execute.after
  const pendingToolCalls = new Map<string, Record<string, unknown>>()

  log("Governance historian initialized", {
    auto_create: finalConfig.auto_create,
    changelog_path: finalConfig.changelog_path,
  })

  /**
   * Get or create session state
   */
  function getSessionState(sessionId: string): SessionState {
    let state = sessionStates.get(sessionId)
    if (!state) {
      state = {
        modifiedFiles: new Set(),
        createdFiles: new Set(),
        startTime: new Date(),
        sessionId,
      }
      sessionStates.set(sessionId, state)
    }
    return state
  }

  /**
   * Create changelog entry for a session
   */
  async function createChangelog(state: SessionState): Promise<void> {
    const allFiles = [
      ...Array.from(state.createdFiles),
      ...Array.from(state.modifiedFiles),
    ]

    if (allFiles.length < finalConfig.min_changes) {
      log(`[historian] Skipping changelog: only ${allFiles.length} changes (min: ${finalConfig.min_changes})`)
      return
    }

    const scope = inferScope(allFiles)
    const agent = state.agent || "unknown"
    const date = new Date()

    const fileChanges: FileChange[] = [
      ...Array.from(state.createdFiles).map((p) => ({
        path: p,
        type: "created" as const,
        timestamp: date,
      })),
      ...Array.from(state.modifiedFiles).map((p) => ({
        path: p,
        type: "modified" as const,
        timestamp: date,
      })),
    ]

    const entry: ChangelogEntry = {
      date: formatDate(date),
      agent,
      scope,
      sessionId: state.sessionId,
      summary: `Session work by ${agent} on ${scope}. ${fileChanges.length} file(s) changed.`,
      files: fileChanges,
    }

    const filename = generateChangelogFilename(date, agent, scope)
    const changelogDir = path.join(ctx.directory, finalConfig.changelog_path)
    const changelogPath = path.join(changelogDir, filename)

    try {
      // Ensure changelog directory exists
      if (!fs.existsSync(changelogDir)) {
        fs.mkdirSync(changelogDir, { recursive: true })
      }

      // Write changelog
      const content = generateChangelogContent(entry)
      fs.writeFileSync(changelogPath, content, "utf-8")

      log(`[historian] Created changelog: ${filename}`)
    } catch (error) {
      log(`[historian] Failed to create changelog:`, error)
    }
  }

  return {
    "tool.execute.before": async (
      input: {
        tool: string
        sessionID: string
        callID: string
      },
      output: {
        args: Record<string, unknown>
      }
    ): Promise<void> => {
      // Only track write and edit tools
      if (!["write", "edit"].includes(input.tool)) {
        return
      }

      // Store args for use in tool.execute.after
      pendingToolCalls.set(input.callID, output.args)
    },

    "tool.execute.after": async (
      input: {
        tool: string
        sessionID: string
        callID: string
      },
      _output: {
        title: string
        output: string
        metadata: unknown
      }
    ): Promise<void> => {
      // Only track write and edit tools
      if (!["write", "edit"].includes(input.tool)) {
        return
      }

      // Get args from pending tool calls
      const args = pendingToolCalls.get(input.callID)
      pendingToolCalls.delete(input.callID)
      
      if (!args) {
        return
      }

      const state = getSessionState(input.sessionID)

      // Extract file path from args
      const filePath = (args.filePath || args.path) as string | undefined
      if (!filePath) {
        return
      }

      // Normalize path to be relative to project root
      let relativePath = filePath
      if (filePath.startsWith(ctx.directory)) {
        relativePath = filePath.slice(ctx.directory.length)
        if (relativePath.startsWith("/")) {
          relativePath = relativePath.slice(1)
        }
      }

      // Determine if created or modified
      if (input.tool === "write") {
        // Check if file existed before
        const fullPath = path.join(ctx.directory, relativePath)
        if (fs.existsSync(fullPath)) {
          state.modifiedFiles.add(relativePath)
        } else {
          state.createdFiles.add(relativePath)
        }
      } else {
        state.modifiedFiles.add(relativePath)
      }

      log(`[historian] Tracked ${input.tool}: ${relativePath}`)
    },

    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }): Promise<void> => {
      // Track agent from session info
      if (event.type === "session.created" || event.type === "session.updated") {
        const props = event.properties as {
          info?: { id?: string; agent?: string }
        } | undefined
        if (props?.info?.id) {
          const state = getSessionState(props.info.id)
          if (props.info.agent) {
            state.agent = props.info.agent
          }
        }
      }

      // Create changelog on session end
      if (event.type === "session.deleted" && finalConfig.auto_create) {
        const props = event.properties as { info?: { id?: string } } | undefined
        if (props?.info?.id) {
          const state = sessionStates.get(props.info.id)
          if (state) {
            await createChangelog(state)
            sessionStates.delete(props.info.id)
          }
        }
      }
    },
  }
}
