export const SWITCHABLE_AGENT_NAMES = ["atlas", "prometheus", "sisyphus", "hephaestus"] as const

export type SwitchableAgentName = (typeof SWITCHABLE_AGENT_NAMES)[number]

export interface SwitchAgentArgs {
  agent: string
  context: string
}
