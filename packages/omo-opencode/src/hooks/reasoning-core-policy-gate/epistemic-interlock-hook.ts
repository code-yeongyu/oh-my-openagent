import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import type { ReasoningCoreClient } from "./reasoning-core-client"
import {
  isEpistemicInterlockCandidate,
  evaluateEpistemicInterlockGate,
  type EpistemicInterlockGateConfig,
} from "./epistemic-interlock-gate"
import type { CandidateAction } from "./types"

const PROMETHEUS_AGENT_KEY = "prometheus"

export interface EpistemicInterlockGateHook {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => Promise<void>
}

interface EpistemicInterlockDeps {
  getSessionAgent: typeof getSessionAgent
  getAgentConfigKey: typeof getAgentConfigKey
}

const DEFAULT_DEPS: EpistemicInterlockDeps = {
  getSessionAgent,
  getAgentConfigKey,
}

export function createEpistemicInterlockGateHook(args: {
  client: ReasoningCoreClient
  config?: EpistemicInterlockGateConfig
}, deps: EpistemicInterlockDeps = DEFAULT_DEPS): EpistemicInterlockGateHook {
  const { client, config } = args

  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      const sessionAgent = deps.getSessionAgent(input.sessionID)
      const agentKey = resolveAgentKeyWithGetter(sessionAgent, deps.getAgentConfigKey)

      const candidate: CandidateAction = {
        tool: input.tool,
        sessionID: input.sessionID,
        agent: agentKey,
        args: output.args,
      }

      if (!isEpistemicInterlockCandidate(candidate)) return

      const verdict = await evaluateEpistemicInterlockGate({
        client,
        candidate,
        config,
      })

      if (!verdict.allow) {
        throw new Error(verdict.reason ?? "Epistemic interlock blocked: constraint violated")
      }
    },
  }
}

function resolveAgentKeyWithGetter(
  sessionAgent: string | undefined,
  getKey: (agentName: string) => string,
): string | undefined {
  if (!sessionAgent) return undefined

  const normalizedAgent = sessionAgent.trim().toLowerCase()
  if (normalizedAgent === PROMETHEUS_AGENT_KEY || normalizedAgent.includes(PROMETHEUS_AGENT_KEY)) {
    return PROMETHEUS_AGENT_KEY
  }

  const configKey = getKey(sessionAgent)
  if (configKey === PROMETHEUS_AGENT_KEY || configKey.includes(PROMETHEUS_AGENT_KEY)) {
    return PROMETHEUS_AGENT_KEY
  }

  return configKey
}
