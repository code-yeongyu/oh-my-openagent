import { log } from "../../shared/logger"
import { scheduleRetry } from "./retry-state"
import { applyPendingSwitch } from "./applier"

type SessionClient = {
  session: {
    prompt?: (input: {
      path: { id: string }
      body: { agent: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    promptAsync: (input: {
      path: { id: string }
      body: { agent: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    messages: (input: { path: { id: string } }) => Promise<unknown>
    status?: () => Promise<unknown>
  }
}

export function schedulePendingSwitchApply(args: {
  sessionID: string
  client: SessionClient
}): void {
  const { sessionID, client } = args
  scheduleRetry({
    sessionID,
    source: "tool",
    onLimitReached: (attempts) => {
      log("[agent-switch] Retry limit reached; waiting for next trigger", {
        sessionID,
        attempts,
        source: "tool",
      })
    },
    retryFn: (attemptNumber) => {
      void applyPendingSwitch({
        sessionID,
        client,
        source: `retry:${attemptNumber}`,
      })
    },
  })
}
