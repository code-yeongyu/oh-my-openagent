export type GptPromptIdentityKey =
  | "gpt-5.5"
  | "gpt-5.6-sol"
  | "gpt-6-astra"
  | "gpt-6-sol"
  | "gpt-6.1-sol"
  | "gpt-6-luna"
  | "gpt-family"

const GPT_PROMPT_IDENTITIES: Record<GptPromptIdentityKey, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-6-astra": "GPT-6 Astra",
  "gpt-6-sol": "GPT-6 Sol",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-6-luna": "GPT-6 Luna",
  "gpt-family": "a GPT-family model",
}

// GPT-6 tier ids with an optional one-digit point release (`gpt-6.1-sol`, `gpt-6-1-sol`, Venice's dotless
// `gpt-61-sol`), ending at a word boundary so `gpt-6-lunar` or `gpt-611-sol` are not taken for a tier.
const GPT_6_FAMILY_RE = /gpt-6(?:[.-](\d)|(\d))?-(astra|sol|luna)(?![a-z0-9])/

const GPT_6_IDENTITY_KEYS: Record<string, GptPromptIdentityKey> = {
  astra: "gpt-6-astra",
  sol: "gpt-6-sol",
  luna: "gpt-6-luna",
  "1-sol": "gpt-6.1-sol",
}

export function getGptPromptIdentityKey(model?: string): GptPromptIdentityKey {
  const modelID = model?.split("/").at(-1)?.toLowerCase()

  const gpt6 = modelID ? GPT_6_FAMILY_RE.exec(modelID) : null
  if (gpt6) {
    const pointRelease = gpt6[1] ?? gpt6[2]
    return GPT_6_IDENTITY_KEYS[pointRelease ? `${pointRelease}-${gpt6[3]}` : gpt6[3]!] ?? "gpt-family"
  }
  if (modelID?.includes("gpt-5.6-sol") || modelID?.includes("gpt-5-6-sol")) {
    return "gpt-5.6-sol"
  }
  if (modelID?.includes("gpt-5.5") || modelID?.includes("gpt-5-5")) {
    return "gpt-5.5"
  }
  return "gpt-family"
}

export function getGptPromptIdentity(model?: string): string {
  return GPT_PROMPT_IDENTITIES[getGptPromptIdentityKey(model)]
}
