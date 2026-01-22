import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { HOOK_NAME, REMINDER_MESSAGE, TOOLS_REQUIRING_DIAGNOSTICS, DIAGNOSTICS_TOOL } from "./constants"

export * from "./constants"

interface SessionState {
  /** Files modified since last lsp_diagnostics check */
  modifiedFiles: Set<string>
  /** Last time lsp_diagnostics was run */
  lastDiagnosticsAt: number | null
  /** Whether diagnostics passed (no errors) */
  diagnosticsPassed: boolean
}

const sessionStates = new Map<string, SessionState>()

function getSessionState(sessionID: string): SessionState {
  let state = sessionStates.get(sessionID)
  if (!state) {
    state = {
      modifiedFiles: new Set(),
      lastDiagnosticsAt: null,
      diagnosticsPassed: false,
    }
    sessionStates.set(sessionID, state)
  }
  return state
}

/**
 * Creates the LSP Diagnostics Enforcer hook.
 *
 * This hook tracks file modifications and ensures lsp_diagnostics is run
 * before tasks can be marked as completed. It injects reminders when
 * the agent attempts to complete tasks without running diagnostics.
 */
export function createLspDiagnosticsEnforcerHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: {
        sessionID: string
        tool: string
        args?: Record<string, unknown>
      },
      output: {
        result?: unknown
        output: string
      }
    ): Promise<void> => {
      const { sessionID, tool } = input
      const args = input.args ?? {}
      const state = getSessionState(sessionID)

      // Track file modifications
      if (TOOLS_REQUIRING_DIAGNOSTICS.includes(tool as typeof TOOLS_REQUIRING_DIAGNOSTICS[number])) {
        const filePath = args.filePath as string | undefined
        if (filePath) {
          state.modifiedFiles.add(filePath)
          state.diagnosticsPassed = false
          log(`[${HOOK_NAME}] File modified, diagnostics required`, { sessionID, filePath })
        }
      }

      // Track when lsp_diagnostics is run
      if (tool === DIAGNOSTICS_TOOL) {
        state.lastDiagnosticsAt = Date.now()
        // Check if diagnostics passed (no errors in output)
        const outputStr = typeof output.result === "string" ? output.result : JSON.stringify(output.result)
        const hasErrors = /error|Error|ERROR/.test(outputStr) && !/0 errors?|no errors?/i.test(outputStr)
        state.diagnosticsPassed = !hasErrors
        
        if (state.diagnosticsPassed) {
          state.modifiedFiles.clear()
          log(`[${HOOK_NAME}] Diagnostics passed, clearing modified files`, { sessionID })
        } else {
          log(`[${HOOK_NAME}] Diagnostics found errors`, { sessionID })
        }
      }

      // Check when todowrite marks a task as completed
      if (tool === "todowrite") {
        const todos = args.todos as Array<{ status?: string }> | undefined
        const hasCompletedTask = todos?.some(t => t.status === "completed")
        
        if (hasCompletedTask && state.modifiedFiles.size > 0 && !state.diagnosticsPassed) {
          log(`[${HOOK_NAME}] Task marked complete without diagnostics`, { 
            sessionID, 
            modifiedFiles: Array.from(state.modifiedFiles) 
          })
          output.output += `\n\n${REMINDER_MESSAGE}`
        }
      }
    },
  }
}
