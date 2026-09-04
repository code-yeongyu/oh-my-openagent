const rawSisyphusLeadPattern = /^\s*"lead": \{ "kind": "subagent_type", "subagent_type": "sisyphus" \},\n/m

function routeNamedAgent(content, agentName, categoryName) {
  return content.replaceAll(`subagent_type="${agentName}"`, `category="${categoryName}"`)
}

function renameNamedAgent(content, agentName, replacementAgentName) {
  return content.replaceAll(`subagent_type="${agentName}"`, `subagent_type="${replacementAgentName}"`)
}

function dropRawSisyphusLead(content) {
  return content.replace(rawSisyphusLeadPattern, "")
}

export function applySenpiSkillRosterOverlay(skillName, content) {
  if (skillName === "review-work") {
    // The shared skill dispatches its single gate reviewer as `oracle`; omo-senpi ships a purpose-built
    // gate reviewer (category-routed deep -> unspecified-high), so hand the lane to it instead of a
    // generic category worker.
    return renameNamedAgent(content, "oracle", "omo-senpi-gate-reviewer")
  }
  if (skillName === "visual-qa") {
    return routeNamedAgent(content, "oracle", "unspecified-high")
  }
  if (skillName === "debugging") {
    return dropRawSisyphusLead(routeNamedAgent(content, "oracle", "deep"))
  }
  if (skillName === "refactor") {
    return dropRawSisyphusLead(routeNamedAgent(content, "plan", "deep"))
  }
  return content
}
