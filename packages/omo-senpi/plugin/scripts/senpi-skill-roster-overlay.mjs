const rawSisyphusLeadPattern = /^\s*"lead": \{ "kind": "subagent_type", "subagent_type": "sisyphus" \},\n/m

const REFACTOR_ORACLE_PROSE = [
  ["Consult oracle agent for help", "Consult a `deep-high` task for help"],
  [
    "- \\`oracle\\`: Read-only consultation for complex architectural decisions and debugging",
    "- \\`deep-high\\` category: Read-only consultation for complex architectural decisions and debugging",
  ],
  [
    "Do not put \\`oracle\\` / \\`librarian\\` / a deep lane into the team spec: oracle/librarian are team-ineligible",
    "Do not put \\`librarian\\` / a deep lane into the team spec: librarian is team-ineligible",
  ],
]

// Applied per file: a pair replaces its text wherever it appears. The sync then requires each pair's REPLACEMENT to
// occur exactly once across the whole skill (assertSenpiSkillRosterOverlay), so a reworded shared skill fails the
// sync instead of shipping the old name, and a skill file without these lines is not an error.
function replaceExactly(content, pairs) {
  return pairs.reduce((text, [from, to]) => text.split(from).join(to), content)
}

export function assertSenpiSkillRosterOverlay(skillName, contents) {
  if (skillName !== "refactor") return
  for (const [from, to] of REFACTOR_ORACLE_PROSE) {
    const count = contents.reduce((total, text) => total + text.split(to).length - 1, 0)
    if (count !== 1)
      throw new Error(`senpi roster overlay: expected one "${from}" in skill ${skillName}, found ${count}`)
  }
}

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
    // gate reviewer (category-routed deep-high -> unspecified-high), so hand the lane to it instead of
    // a generic category worker.
    return renameNamedAgent(content, "oracle", "omo-native-gate-reviewer")
  }
  if (skillName === "visual-qa") {
    return routeNamedAgent(content, "oracle", "unspecified-high")
  }
  if (skillName === "debugging") {
    // The oracle lane is a second opinion on a stuck hypothesis: the decision it settles is the one
    // the investigation could not settle from evidence, which is the deep-high gate.
    return dropRawSisyphusLead(routeNamedAgent(content, "oracle", "deep-high"))
  }
  if (skillName === "refactor") {
    // Senpi has no `oracle` agent; the read-only consultation the shared prose describes is the deep-high lane.
    return replaceExactly(dropRawSisyphusLead(routeNamedAgent(content, "plan", "deep-high")), REFACTOR_ORACLE_PROSE)
  }
  return content
}
