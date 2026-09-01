import { log } from "../../shared/logger"
import type { V2AgentInfo, V2PluginContext } from "./types"

/**
 * Agent bridge: run the V1 config handler (6-phase pipeline) on a synthetic
 * config document, harvest the `config.agent` map it produces, and register
 * each agent in the V2 agent draft.
 *
 * V1 -> V2 field mapping (V1 `AgentConfig` -> V2 `Agent.Info`):
 * - `prompt`        -> `system`
 * - `temperature`   -> `request.settings.temperature` (plus topP etc.)
 * - `disable`       -> agent omitted entirely
 * - `permission`    -> folded into `permissions` alongside tool restrictions
 * - `model`         -> parsed `providerID/id[#variant]` into `model`
 * - `mode`, `description`, `hidden`, `order` keep their names
 *
 * Registration mechanism: the V2 AgentDraft has no `add` method. Verified
 * live against beta-18721: `draft.update(id, fn)` CREATES the agent when the
 * id is missing (the probe's agent survived a service restart through the
 * API list), so registration is `draft.update(id, (agent) => Object.assign(agent, info))`.
 */

export type V1AgentConfig = Record<string, unknown>

export function toV2ModelRef(
  model: unknown,
): { id: string; providerID: string; variant?: string } | undefined {
  if (typeof model !== "string" || model.length === 0) return undefined
  const [providerID, rest] = model.includes("/") ? [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)] : [undefined, model]
  if (rest === undefined) return undefined
  const [id, variant] = rest.includes("#") ? [rest.slice(0, rest.indexOf("#")), rest.slice(rest.indexOf("#") + 1)] : [rest, undefined]
  if (!providerID) return undefined
  return { id, providerID, ...(variant ? { variant } : {}) }
}

export function toV2Permissions(
  agent: V1AgentConfig,
): Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> {
  const permissions: Array<{ action: string; resource: string; effect: "allow" | "deny" | "ask" }> = []
  const tools = agent["tools"]
  if (tools && typeof tools === "object" && !Array.isArray(tools)) {
    for (const [pattern, value] of Object.entries(tools as Record<string, unknown>)) {
      const effect =
        value === true || value === "allow"
          ? "allow"
          : value === "ask"
            ? "ask"
            : "deny"
      permissions.push({ action: "tool", resource: pattern, effect })
    }
  }
  const permission = agent["permission"]
  if (permission && typeof permission === "object" && !Array.isArray(permission)) {
    for (const [action, value] of Object.entries(permission as Record<string, unknown>)) {
      if (typeof value === "string") {
        permissions.push({ action, resource: "*", effect: value as "allow" | "deny" | "ask" })
      } else if (value && typeof value === "object") {
        for (const [resource, effect] of Object.entries(value as Record<string, unknown>)) {
          if (typeof effect === "string") {
            permissions.push({ action, resource, effect: effect as "allow" | "deny" | "ask" })
          }
        }
      }
    }
  }
  return permissions
}

export function toV2AgentInfo(id: string, agent: V1AgentConfig): V2AgentInfo {
  const request: V2AgentInfo["request"] = { settings: {}, headers: {}, body: {} }
  const settings = request?.settings as Record<string, unknown>
  for (const key of ["temperature", "topP", "topK", "maxOutputTokens", "reasoningEffort"]) {
    const value = agent[key]
    if (value !== undefined) settings[key] = value
  }
  const options = agent["options"]
  if (options && typeof options === "object" && !Array.isArray(options)) {
    for (const [key, value] of Object.entries(options as Record<string, unknown>)) {
      settings[key] = value
    }
  }

  const mode = agent["mode"]
  const info: V2AgentInfo = {
    id,
    name: id,
    model: toV2ModelRef(agent["model"]),
    request,
    description: typeof agent["description"] === "string" ? agent["description"] : undefined,
    mode: mode === "primary" || mode === "all" ? (mode as "primary" | "all") : "subagent",
    hidden: agent["hidden"] === true,
    permissions: toV2Permissions(agent),
  }
  const prompt = agent["prompt"]
  if (typeof prompt === "string") info.system = prompt
  if (typeof agent["color"] === "string") info.color = agent["color"]
  return info
}

export async function registerV2Agents(args: {
  readonly ctx: V2PluginContext
  readonly v1Agents: Record<string, V1AgentConfig>
  readonly defaultAgent?: string
}): Promise<void> {
  const entries = Object.entries(args.v1Agents)
  log("[v2-agent-bridge] registering agents", {
    count: entries.length,
    default: args.defaultAgent ?? "none",
  })
  await args.ctx.agent.transform((draft) => {
    for (const [id, agent] of entries) {
      if (agent["disable"] === true) continue
      const info = toV2AgentInfo(id, agent)
      draft.update(id, (existing) => {
        Object.assign(existing, info)
      })
    }
    if (args.defaultAgent) {
      draft.default(args.defaultAgent)
    }
  })
}
