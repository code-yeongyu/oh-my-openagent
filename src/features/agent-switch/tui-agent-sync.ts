import { getAgentConfigKey } from "../../shared/agent-display-names"
import { log, normalizeSDKResponse } from "../../shared"

type TuiClient = {
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

type AgentInfo = {
  name?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
}

function isCliClient(): boolean {
  return (process.env["OPENCODE_CLIENT"] ?? "cli") === "cli"
}

function resolveCyclePlan(args: {
  orderedAgentNames: string[]
  sourceAgent: string
  targetAgent: string
}): { command: "agent.cycle" | "agent.cycle.reverse"; steps: number } | undefined {
  const { orderedAgentNames, sourceAgent, targetAgent } = args
  if (orderedAgentNames.length < 2) {
    return undefined
  }

  const orderedKeys = orderedAgentNames.map((name) => getAgentConfigKey(name))
  const sourceKey = getAgentConfigKey(sourceAgent)
  const targetKey = getAgentConfigKey(targetAgent)

  const sourceIndex = orderedKeys.indexOf(sourceKey)
  const targetIndex = orderedKeys.indexOf(targetKey)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return undefined
  }

  const size = orderedKeys.length
  const forward = (targetIndex - sourceIndex + size) % size
  const backward = (sourceIndex - targetIndex + size) % size

  if (forward <= backward) {
    return { command: "agent.cycle", steps: forward }
  }

  return { command: "agent.cycle.reverse", steps: backward }
}

export async function syncCliTuiAgentSelectionAfterSwitch(args: {
  client: TuiClient
  sessionID: string
  sourceAgent: string | undefined
  targetAgent: string
  source: string
}): Promise<void> {
  const { client, sessionID, sourceAgent, targetAgent, source } = args

  if (!isCliClient()) {
    return
  }

  if (!sourceAgent || !client.app?.agents || !client.tui?.publish) {
    return
  }

  const sourceKey = getAgentConfigKey(sourceAgent)
  const targetKey = getAgentConfigKey(targetAgent)

  // Scope to Athena handoffs where CLI TUI can show stale local-agent selection.
  if (sourceKey !== "athena" || (targetKey !== "atlas" && targetKey !== "prometheus")) {
    return
  }

  try {
    const response = await client.app.agents()
    const agents = normalizeSDKResponse(response, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })

    const orderedPrimaryAgents = agents
      .filter((agent) => typeof agent.name === "string" && agent.mode !== "subagent" && agent.hidden !== true)
      .map((agent) => agent.name as string)

    const plan = resolveCyclePlan({
      orderedAgentNames: orderedPrimaryAgents,
      sourceAgent,
      targetAgent,
    })

    if (!plan || plan.steps <= 0) {
      return
    }

    for (let step = 0; step < plan.steps; step += 1) {
      await client.tui.publish({
        body: {
          type: "tui.command.execute",
          properties: {
            command: plan.command,
          },
        },
      })
    }

    log("[agent-switch] Synced CLI TUI local agent after handoff", {
      sessionID,
      source,
      sourceAgent,
      targetAgent,
      command: plan.command,
      steps: plan.steps,
    })
  } catch (error) {
    log("[agent-switch] Failed syncing CLI TUI local agent after handoff", {
      sessionID,
      source,
      sourceAgent,
      targetAgent,
      error: String(error),
    })
  }
}
