import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join, resolve, relative, isAbsolute } from "node:path"
import { HOOK_NAME, PROMETHEUS_AGENTS, ALLOWED_EXTENSIONS, ALLOWED_PATH_PREFIXES, BLOCKED_TOOLS, PLANNING_CONSULT_WARNING, PROMETHEUS_WORKFLOW_REMINDER } from "./constants"
import { findNearestMessageWithFields, findFirstMessageWithAgent, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { readBoulderState } from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"

export * from "./constants"

/**
 * Cross-platform path validator for Prometheus file writes.
 * Uses path.resolve/relative instead of string matching to handle:
 * - Windows backslashes (e.g., changes\\name\\tasks.md)
 * - Mixed separators (e.g., changes\\drafts/x.md)
 * - Case-insensitive directory/extension matching
 * - Workspace confinement (blocks paths outside root or via traversal)
 * - Nested project paths (e.g., changes/name/tasks.md, changes/drafts/x.md)
 */
function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  // 1. Resolve to absolute path
  const resolved = resolve(workspaceRoot, filePath)

  // 2. Get relative path from workspace root
  const rel = relative(workspaceRoot, resolved)

  // 3. Reject if escapes root (starts with ".." or is absolute)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  // 4. Check if path is in allowed directory (changes/)
  // Normalize the relative path to use forward slashes for consistent matching
  const normalizedRel = rel.replace(/\\/g, "/")
  const isInAllowedDir = ALLOWED_PATH_PREFIXES.some(prefix => {
    // Match prefix followed by a forward slash (after normalization)
    const pattern = new RegExp(`^${prefix}/`, "i")
    return pattern.test(normalizedRel)
  })
  if (!isInAllowedDir) {
    return false
  }

  // 5. Check extension matches one of ALLOWED_EXTENSIONS (case-insensitive)
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(
    ext => resolved.toLowerCase().endsWith(ext.toLowerCase())
  )
  if (!hasAllowedExtension) {
    return false
  }

  return true
}

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

const TASK_TOOLS = ["delegate_task", "task", "call_omo_agent"]

function getAgentFromMessageFiles(sessionID: string): string | undefined {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return undefined
  return findFirstMessageWithAgent(messageDir) ?? findNearestMessageWithFields(messageDir)?.agent
}

/**
 * Get the effective agent for the session.
 * Priority order:
 * 1. In-memory session agent (most recent, set by /start-work)
 * 2. Boulder state agent (persisted across restarts, fixes #927)
 * 3. Message files (fallback for sessions without boulder state)
 *
 * This fixes issue #927 where after interruption:
 * - In-memory map is cleared (process restart)
 * - Message files return "prometheus" (oldest message from /plan)
 * - But boulder.json has agent: "atlas" (set by /start-work)
 */
function getAgentFromSession(sessionID: string, directory: string): string | undefined {
  // Check in-memory first (current session)
  const memoryAgent = getSessionAgent(sessionID)
  if (memoryAgent) return memoryAgent

  // Check boulder state (persisted across restarts) - fixes #927
  const boulderState = readBoulderState(directory)
  if (boulderState?.session_ids.includes(sessionID) && boulderState.agent) {
    return boulderState.agent
  }

  // Fallback to message files
  return getAgentFromMessageFiles(sessionID)
}

export function createPrometheusMdOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = getAgentFromSession(input.sessionID, ctx.directory)

      if (!agentName || !PROMETHEUS_AGENTS.some(pa => pa.toLowerCase() === agentName.toLowerCase())) {
        return
      }

      const toolName = input.tool

      // Inject read-only warning for task tools called by Prometheus
       if (TASK_TOOLS.includes(toolName)) {
         const prompt = output.args.prompt as string | undefined
         if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
           output.args.prompt = PLANNING_CONSULT_WARNING + prompt
          log(`[${HOOK_NAME}] Injected read-only planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      // Block file-writing bash commands - allow read-only and mkdir
      if (toolName === "bash") {
        const command = (output.args.command as string) ?? ""
        
        // Blocked patterns: file creation/writing commands
        const blockedPatterns = [
          /[^2]>\s*[^&]/,         // Redirect write (but not 2>&1)
          /\s>>\s*/,              // Append redirect
          /\btouch\s+/,           // Create file
          /\btee\s+/,             // Write via tee
          /\bcp\s+.*\s+/,         // Copy files
          /\bmv\s+/,              // Move/rename
          /\brm\s+/,              // Delete
          /\bchmod\s+/,           // Change permissions
          /\bchown\s+/,           // Change owner
          /\bln\s+/,              // Create links
          /\binstall\s+/,         // Install command
          /\bdd\s+/,              // Direct write
          /\bsed\s+-i/,           // In-place edit
        ]
        
        const isBlocked = blockedPatterns.some(pattern => pattern.test(command))
        
        if (isBlocked) {
          log(`[${HOOK_NAME}] Blocked: Prometheus cannot execute file-writing bash commands`, {
            sessionID: input.sessionID,
            tool: toolName,
            command: command.slice(0, 100),
            agent: agentName,
          })
          throw new Error(
            `[${HOOK_NAME}] ${getAgentDisplayName("prometheus")} cannot execute file-writing commands. ` +
            `Blocked command pattern detected. Use Write/Edit tools for changes/*.md files only.`
          )
        }
        
        // Allow other bash commands (mkdir, ls, cat, git status, etc.)
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      if (!isAllowedFile(filePath, ctx.directory)) {
        log(`[${HOOK_NAME}] Blocked: Prometheus can only write to changes/*.md`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        throw new Error(
          `[${HOOK_NAME}] Prometheus (Planner) can only write/edit .md files inside changes/ directory. ` +
          `Attempted to modify: ${filePath}. ` +
          `Prometheus is a READ-ONLY planner. Use /start-work to execute the plan.`
        )
      }

      log(`[${HOOK_NAME}] Allowed: changes/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
