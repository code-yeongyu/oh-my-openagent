import { isGpt5_5Model } from "./types"

function isOpus47Model(model: string): boolean {
  const modelName = model.includes("/") ? (model.split("/").pop() ?? model) : model
  return modelName.toLowerCase().includes("claude-opus-4-7")
}

export function getFrontierToolSchemaPermission(model: string): Record<string, "deny"> {
  return isOpus47Model(model) || isGpt5_5Model(model)
    ? { grep: "deny" as const, glob: "deny" as const }
    : {}
}
