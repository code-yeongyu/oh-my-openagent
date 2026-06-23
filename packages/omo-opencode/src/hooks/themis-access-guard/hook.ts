import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { isPathInThemisScope } from "./path-scope-validator"
import { validateResponseContract } from "./response-contract-validator"

const THEMIS_AGENT_KEY = "themis"
const WRITE_TOOLS = new Set(["write", "edit"])

interface ThemisAccessGuardDeps {
  getSessionAgent: typeof getSessionAgent
  log: typeof log
}

const DEFAULT_DEPS: ThemisAccessGuardDeps = {
  getSessionAgent,
  log,
}

function isThemisSession(sessionID: string, getSessionAgentFn: typeof getSessionAgent): boolean {
  const agent = getSessionAgentFn(sessionID)
  if (!agent) return false
  return agent.toLowerCase().includes(THEMIS_AGENT_KEY)
}

function extractFilePath(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  const a = args as Record<string, unknown>
  return (a.file_path ?? a.path ?? a.filePath) as string | undefined
}

export function createThemisAccessGuardHook(deps: ThemisAccessGuardDeps = DEFAULT_DEPS) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown }
    ): Promise<void> => {
      const { tool, sessionID } = input

      if (!WRITE_TOOLS.has(tool.toLowerCase())) return
      if (!isThemisSession(sessionID, deps.getSessionAgent)) return

      const filePath = extractFilePath(output.args)
      if (!filePath) return

      if (!isPathInThemisScope(filePath)) {
        deps.log("[themis-access-guard] path scope violation", { sessionID, filePath })
        throw new Error(
          `Themis access denied: writes are restricted to .sisyphus/deliberations/*.md. ` +
          `Attempted path: ${filePath}`
        )
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { output: string }
    ): Promise<void> => {
      const { tool, sessionID } = input

      if (!WRITE_TOOLS.has(tool.toLowerCase())) return
      if (!isThemisSession(sessionID, deps.getSessionAgent)) return

      try {
        validateResponseContract(output.output)
      } catch (err) {
        deps.log("[themis-access-guard] response contract violation", { sessionID, error: err })
        throw err
      }
    },
  }
}
