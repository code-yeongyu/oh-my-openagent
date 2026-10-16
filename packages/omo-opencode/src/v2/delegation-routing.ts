import { AGENT_DISPLAY_NAMES, getAgentConfigKey } from "../shared/agent-display-names"

export const OMO_DELEGATION_RULE = [
  "OMO delegation routing: delegate ONLY through tools.task in the current Code Mode catalog.",
  "Discover tools.task with search before calling it; use its actual category and load_skills schema.",
  "Do not use native subagent or another delegation entry point for OMO agents.",
  "If tools.task is unavailable, stop and report the missing route; never silently fall back.",
  "This rule applies only to OMO agents. Native general, build, plan, and custom agents retain native subagent behavior.",
].join("\n")

export type OmoRoutingEvent = {
  agent?: string
  system: Array<{ type: "text"; text: string }>
  tools?: Record<string, unknown>
}

export function createOmoDelegationRouting(additionalOwnedIDs: readonly string[] = []) {
  // Only explicit OMO definitions establish ownership. Generated Markdown and
  // config.agent also contain native/custom agents, so neither is a scope test.
  const additional = new Set(additionalOwnedIDs.map((id) => id.toLowerCase()))
  return (event: OmoRoutingEvent, options: { hideNativeTool?: boolean } = {}): void => {
    for (let index = event.system.length - 1; index >= 0; index--) {
      if (event.system[index].type === "text" && event.system[index].text === OMO_DELEGATION_RULE) {
        event.system.splice(index, 1)
      }
    }
    if (typeof event.agent !== "string") return
    const id = event.agent.startsWith("oh-my-openagent/")
      ? event.agent.slice("oh-my-openagent/".length)
      : event.agent
    if (["general", "build", "plan"].includes(id.toLowerCase())) return
    if (!Object.hasOwn(AGENT_DISPLAY_NAMES, getAgentConfigKey(id)) && !additional.has(id.toLowerCase())) return
    event.system.push({ type: "text", text: OMO_DELEGATION_RULE })
    // Opt-in only: callers must prove event.tools is fresh per inference.
    // Never remove from the global registry. Native permissions enforce the
    // configured deny even when this optional presentation filter is disabled.
    if (options.hideNativeTool === true && event.tools) delete event.tools.subagent
  }
}
