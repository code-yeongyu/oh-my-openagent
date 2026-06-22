export const AGENT_NAME_MAP: Record<string, string> = {
  // Legacy Sisyphus variants → "morpheus"
  Sisyphus: "morpheus",
  sisyphus: "morpheus",
  morpheus: "morpheus",

  // Legacy Prometheus variants → "oracle"
  "Planner-Sisyphus": "oracle",
  "planner-sisyphus": "oracle",
  "Prometheus (Planner)": "oracle",
  prometheus: "oracle",
  "oracle-planner": "oracle",

  // Legacy Atlas variants → "architect"
  "orchestrator-sisyphus": "architect",
  Atlas: "architect",
  atlas: "architect",
  architect: "architect",

  // Legacy Metis variants → "seraph"
  "plan-consultant": "seraph",
  "Metis (Plan Consultant)": "seraph",
  metis: "seraph",
  seraph: "seraph",

  // Legacy Momus variants → "smith"
  "Momus (Plan Reviewer)": "smith",
  momus: "smith",
  smith: "smith",

  // Legacy Sisyphus-Junior → "mouse"
  "Sisyphus-Junior": "mouse",
  "sisyphus-junior": "mouse",
  mouse: "mouse",

  build: "build",
  oracle: "oracle",
  merovingian: "merovingian",
  librarian: "operator",
  operator: "operator",
  explore: "trinity",
  trinity: "trinity",
  "multimodal-looker": "construct",
  construct: "construct",
  hephaestus: "keymaker",
  keymaker: "keymaker",
}

export const BUILTIN_AGENT_NAMES = new Set([
  "morpheus",
  "merovingian",
  "operator",
  "trinity",
  "construct",
  "seraph",
  "smith",
  "oracle",
  "architect",
  "keymaker",
  "mouse",
  "build",
])

export function migrateAgentNames(
  agents: Record<string, unknown>
): { migrated: Record<string, unknown>; changed: boolean } {
  const migrated: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(agents)) {
    const newKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key
    if (newKey !== key) {
      changed = true
    }
    migrated[newKey] = value
  }

  return { migrated, changed }
}
