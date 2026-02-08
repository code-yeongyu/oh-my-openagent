import {
  loadInteractiveBashSessionState,
  saveInteractiveBashSessionState,
  clearInteractiveBashSessionState,
} from "./storage";
import { OMO_SESSION_PREFIX, buildSessionReminderMessage } from "./constants";
import type { InteractiveBashSessionState } from "./types";
import { subagentSessions } from "../../features/claude-code-session-state";

type AbortSession = (args: { path: { id: string } }) => Promise<unknown>

function isOmoSession(sessionName: string | null): sessionName is string {
  return sessionName !== null && sessionName.startsWith(OMO_SESSION_PREFIX)
}

async function killAllTrackedSessions(
  abortSession: AbortSession,
  state: InteractiveBashSessionState,
): Promise<void> {
  for (const sessionName of state.tmuxSessions) {
    try {
      const proc = Bun.spawn(["tmux", "kill-session", "-t", sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await proc.exited
    } catch {
      // best-effort cleanup
    }
  }

  for (const sessionId of subagentSessions) {
    abortSession({ path: { id: sessionId } }).catch(() => {})
  }
}

export function createInteractiveBashSessionTracker(options: {
  abortSession: AbortSession
}): {
  getOrCreateState: (sessionID: string) => InteractiveBashSessionState
  handleSessionDeleted: (sessionID: string) => Promise<void>
  handleTmuxCommand: (input: {
    sessionID: string
    subCommand: string
    sessionName: string | null
    toolOutput: string
  }) => { reminderToAppend: string | null }
} {
  const { abortSession } = options
  const sessionStates = new Map<string, InteractiveBashSessionState>()

  function getOrCreateState(sessionID: string): InteractiveBashSessionState {
    const existing = sessionStates.get(sessionID)
    if (existing) return existing

    const persisted = loadInteractiveBashSessionState(sessionID)
    const state: InteractiveBashSessionState = persisted ?? {
      sessionID,
      tmuxSessions: new Set<string>(),
      updatedAt: Date.now(),
    }
    sessionStates.set(sessionID, state)
    return state
  }

  async function handleSessionDeleted(sessionID: string): Promise<void> {
    const state = getOrCreateState(sessionID)
    await killAllTrackedSessions(abortSession, state)
    sessionStates.delete(sessionID)
    clearInteractiveBashSessionState(sessionID)
  }

  function handleTmuxCommand(input: {
    sessionID: string
    subCommand: string
    sessionName: string | null
    toolOutput: string
  }): { reminderToAppend: string | null } {
    const { sessionID, subCommand, sessionName, toolOutput } = input

    const state = getOrCreateState(sessionID)
    let stateChanged = false

    if (toolOutput.startsWith("Error:")) {
      return { reminderToAppend: null }
    }

    const isNewSession = subCommand === "new-session"
    const isKillSession = subCommand === "kill-session"
    const isKillServer = subCommand === "kill-server"

    if (isNewSession && isOmoSession(sessionName)) {
      state.tmuxSessions.add(sessionName)
      stateChanged = true
    } else if (isKillSession && isOmoSession(sessionName)) {
      state.tmuxSessions.delete(sessionName)
      stateChanged = true
    } else if (isKillServer) {
      state.tmuxSessions.clear()
      stateChanged = true
    }

    if (stateChanged) {
      state.updatedAt = Date.now()
      saveInteractiveBashSessionState(state)
    }

    const isSessionOperation = isNewSession || isKillSession || isKillServer
    if (!isSessionOperation) {
      return { reminderToAppend: null }
    }

    const reminder = buildSessionReminderMessage(Array.from(state.tmuxSessions))
    return { reminderToAppend: reminder || null }
  }

  return { getOrCreateState, handleSessionDeleted, handleTmuxCommand }
}
