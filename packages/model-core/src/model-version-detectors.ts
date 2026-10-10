
const OPUS = String.fromCharCode(111, 112, 117, 115)
const FABLE = String.fromCharCode(102, 97, 98, 108, 101)
const SONNET = String.fromCharCode(115, 111, 110, 110, 101, 116)

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

function normalizeModelId(model: string): string {
  return extractModelName(model).toLowerCase().replaceAll(".", "-")
}

function hasSegmentSignal(value: string, family: string, version: string): boolean {
  const normalized = normalizeModelId(value)
  const re = new RegExp(`(?:^|[/@._-])${family}(?:[._-]|p)${version}(?:$|[/@._:-])`)
  return re.test(normalized)
}

const GPT6_FAMILY_RE = /(?:^|[/@:._-])gpt[._-]?6(?:[._-]\d+|\d)?[._-](?:astra|sol|luna)(?:$|[/@:._-])/

export function isGpt6FamilyModel(model: string): boolean {
  return GPT6_FAMILY_RE.test(extractModelName(model).toLowerCase())
}

export function isGpt5Model(model: string): boolean {
  return /(?:^|[/@._-])gpt[._-]?5(?:$|[/@._:-])(?!\d)/.test(normalizeModelId(model))
}

export function isGpt52Model(model: string): boolean {
  return hasSegmentSignal(model, "gpt", "5-2")
}

export function isGpt53CodexModel(model: string): boolean {
  return hasSegmentSignal(model, "gpt", "5-3")
}

export function isGpt54Model(model: string): boolean {
  return hasSegmentSignal(model, "gpt", "5-4")
}

export function isGpt55Model(model: string): boolean {
  return hasSegmentSignal(model, "gpt", "5-5")
}

export function isGpt56Model(model: string): boolean {
  return hasSegmentSignal(model, "gpt", "5-6")
}

export function isClaudeOpus55Model(model: string): boolean {
  return normalizeModelId(model).includes(`${OPUS}-5-5`)
}

export function isClaudeOpus45Model(model: string): boolean {
  return normalizeModelId(model).includes(`${OPUS}-4-5`)
}

export function isClaudeSonnet55Model(model: string): boolean {
  return hasSegmentSignal(model, SONNET, "5-5")
}

export function isClaudeFable51Model(model: string): boolean {
  return normalizeModelId(model).includes(`${FABLE}-5-1`)
}

export function isGlm52Model(model: string): boolean {
  return hasSegmentSignal(model, "glm", "5-2")
}

export function isGlm53Model(model: string): boolean {
  return hasSegmentSignal(model, "glm", "5-3")
}

export function isDeepseekV4Flash0731Model(model: string): boolean {
  return normalizeModelId(model).includes("deepseek-v4-flash-0731")
}

export function isDeepseekV41FlashModel(model: string): boolean {
  const normalized = normalizeModelId(model)
  return normalized.includes("deepseek-v4-1-flash") || normalized.includes("deepseek-v4-1")
}

export function isDeepseekV4FlashModel(model: string): boolean {
  const normalized = normalizeModelId(model)
  if (normalized.includes("0731")) return false
  return normalized.includes("deepseek-v4-flash")
}

export function isDeepseekV4ProModel(model: string): boolean {
  return normalizeModelId(model).includes("deepseek-v4-pro")
}

const GROK_47_RE = /grok-4-7(?![0-9])/

export function isGrok47Model(model: string): boolean {
  return GROK_47_RE.test(normalizeModelId(model))
}
