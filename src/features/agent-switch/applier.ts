import { normalizeAgentForPrompt } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import { clearPendingSwitch, getPendingSwitch } from "./state"
import { waitForSessionIdle } from "./session-status"
import { shouldClearAsAlreadyApplied } from "./apply-verification"
import { createFreshSession } from "./session-creator"
import {
  clearInFlight,
  clearRetryState,
  isApplyInFlight,
  markApplyInFlight,
  resetRetryStateForTesting,
  scheduleRetry,
} from "./retry-state"

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
    create?: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
    messages: (input: { path: { id: string } }) => Promise<unknown>
    status?: () => Promise<unknown>
  }
  app?: {
    agents?: () => Promise<unknown>
  }
  tui?: {
    publish?: (input: {
      body: {
        type: "tui.command.execute"
        properties: { command: string }
      }
    }) => Promise<unknown>
  }
}

async function tryPromptWithCandidates(args: {
  client: SessionClient
  sessionID: string
  agent: string
  context: string
  source: string
}): Promise<string> {
  const { client, sessionID, agent, context, source } = args
  const targetAgent = normalizeAgentForPrompt(agent)
  if (!targetAgent) {
    throw new Error(`invalid target agent for switch prompt: ${agent}`)
  }

  try {
    const promptInput = {
      path: { id: sessionID },
      body: {
        agent: targetAgent,
        parts: [{ type: "text" as const, text: context }],
      },
    }

    if (client.session.prompt) {
      await client.session.prompt(promptInput)
    } else {
      await client.session.promptAsync(promptInput)
    }

    if (targetAgent !== agent) {
      log("[agent-switch] Normalized pending switch agent for prompt", {
        sessionID,
        source,
        requestedAgent: agent,
        usedAgent: targetAgent,
      })
    }

    return targetAgent
  } catch (error) {
    log("[agent-switch] Prompt attempt failed", {
      sessionID,
      source,
      requestedAgent: agent,
      attemptedAgent: targetAgent,
      error: String(error),
    })
    throw error
  }
}

export async function applyPendingSwitch(args: {
  sessionID: string
  client: SessionClient
  source: string
}): Promise<void> {
  const { sessionID, client, source } = args
  const pending = getPendingSwitch(sessionID)
  if (!pending) {
    clearRetryState(sessionID)
    return
  }

  if (isApplyInFlight(sessionID)) {
    return
  }

  markApplyInFlight(sessionID)
  log("[agent-switch] Applying pending switch", {
    sessionID,
    source,
    agent: pending.agent,
  })

  try {
    const alreadyApplied = await shouldClearAsAlreadyApplied({
      client,
      sessionID,
      targetAgent: pending.agent,
    })
    if (alreadyApplied) {
      clearPendingSwitch(sessionID)
      clearRetryState(sessionID)
      log("[agent-switch] Pending switch already applied by user-turn evidence; clearing state", {
        sessionID,
        source,
        agent: pending.agent,
      })
      return
    }

    const idleReady = await waitForSessionIdle({ client, sessionID })
    if (!idleReady) {
      throw new Error("session not idle before applying agent switch")
    }

    const newSessionID = await createFreshSession({
      client,
      sourceSessionID: sessionID,
      targetAgent: pending.agent,
    })

    await tryPromptWithCandidates({
      client,
      sessionID: newSessionID,
      agent: pending.agent,
      context: pending.context,
      source,
    })

    clearPendingSwitch(sessionID)
    clearRetryState(sessionID)

    log("[agent-switch] Pending switch applied via fresh session", {
      sourceSessionID: sessionID,
      newSessionID,
      source,
      agent: pending.agent,
    })
  } catch (error) {
    clearInFlight(sessionID)
    log("[agent-switch] Pending switch apply failed", {
      sessionID,
      source,
      error: String(error),
    })
    scheduleRetry({
      sessionID,
      source,
      onLimitReached: (attempts) => {
        log("[agent-switch] Retry limit reached; waiting for next trigger", {
          sessionID,
          attempts,
          source,
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
}

export function clearPendingSwitchRuntime(sessionID: string): void {
  clearPendingSwitch(sessionID)
  clearRetryState(sessionID)
}

/** @internal For testing only */
export function _resetApplierForTesting(): void {
  resetRetryStateForTesting()
}
