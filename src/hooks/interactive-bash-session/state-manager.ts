import type { InteractiveBashSessionState } from "./types";
import { loadInteractiveBashSessionState } from "./storage";
import { OMO_SESSION_PREFIX } from "./constants";
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide";

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
      const proc = spawnWithWindowsHide(["tmux", "kill-session", "-t", sessionName], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {}
  }
}
