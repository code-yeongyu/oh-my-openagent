import type { InteractiveBashSessionState } from "./types";
import { loadInteractiveBashSessionState, saveInteractiveBashSessionState } from "./storage";
import { OMO_SESSION_PREFIX } from "./constants";
import { subagentSessions } from "../../features/claude-code-session-state";

export function getOrCreateState(sessionID: string, sessionStates: Map<string, InteractiveBashSessionState>): InteractiveBashSessionState {
  if (!sessionStates.has(sessionID)) {
    const persisted = loadInteractiveBashSessionState(sessionID);
    const state: InteractiveBashSessionState = persisted ?? {
      sessionID,
      tmuxSessions: new Set<string>(),
      updatedAt: Date.now(),
    };
    sessionStates.set(sessionID, state);
  }
  return sessionStates.get(sessionID)!;
}

export function isOmoSession(sessionName: string | null): boolean {
  return sessionName !== null && sessionName.startsWith(OMO_SESSION_PREFIX);
}

export async function killAllTrackedSessions(
  state: InteractiveBashSessionState,
): Promise<void> {
  for (const sessionName of state.tmuxSessions) {
    try {
      const proc = Bun.spawn(["tmux", "kill-session", "-t", sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {}
  }

  for (const sessionId of subagentSessions) {
    // Note: ctx is not available here, so we can't call ctx.client.session.abort
    // This will need to be handled in the hook where ctx is available
  }
}
