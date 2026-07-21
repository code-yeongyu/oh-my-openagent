export function getGptPromptIdentity(model?: string): string {
  const modelID = model?.split("/").at(-1)?.toLowerCase()

  if (modelID?.includes("gpt-5.6-sol") || modelID?.includes("gpt-5-6-sol")) {
    return "GPT-5.6 Sol"
  }
  if (modelID?.includes("gpt-5.5") || modelID?.includes("gpt-5-5")) {
    return "GPT-5.5"
  }
  return "a GPT-family model"
}
