export type ModelRef = { providerID: string; modelID: string }

export const HAIKU_MODEL: ModelRef = {
  providerID: "amazon-bedrock",
  modelID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
}

export const SCOUT_MODEL: ModelRef = {
  providerID: "amazon-bedrock",
  modelID: "us.meta.llama4-scout-17b-instruct-v1:0",
}
