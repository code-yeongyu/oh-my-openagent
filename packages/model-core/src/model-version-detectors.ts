// Segment-scoped version detectors. Matchers bound the version with a segment edge so a future
// id like opus-5-50 or deepseek-v4-1-pro can never inherit another model's preset; Claude-family
// entries use the runtime's own signal shapes (fable/mythos markers, deepseek aliases) so the
// plugin and the runtime classify the same id the same way.

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model
}

function normalizeModelId(model: string): string {
  return model.toLowerCase().replaceAll(".", "-").replace(/\s+/g, "-")
}

function hasSegmentSignal(value: string, family: string, version: string): boolean {
  const normalized = extractModelName(value).toLowerCase().replaceAll(".", "-")
  const re = new RegExp(`(?:^|[/@._-])${family}(?:[._-]|p)${version}(?:$|[/@._:-])`)
  return re.test(normalized)
}

function hasClaudeMarker(model: string, markers: readonly string[]): boolean {
  const normalized = normalizeModelId(model)
  return markers.some((marker) => {
    const needle = marker.replaceAll(".", "-")
    let index = normalized.indexOf(needle)
    while (index !== -1) {
      const after = normalized[index + needle.length]
      if (after === undefined || !/[0-9]/.test(after)) return true
      index = normalized.indexOf(needle, index + 1)
    }
    return false
  })
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

// The runtime's Claude signal markers: Anthropic spells versions with dots or dashes, and the
// Mythos line shares each Fable release's prompting guide, so Mythos ids classify as Fable.
const OPUS_55_MARKERS = ["opus-5-5", "opus-5.5"] as const
const OPUS_5_MARKERS = ["opus-5"] as const
const OPUS_45_MARKERS = ["opus-4-5", "opus-4.5"] as const
const FABLE_51_MARKERS = ["fable-5-1", "fable-5.1", "mythos-5-1", "mythos-5.1"] as const
const FABLE_5_MARKERS = ["fable-5", "mythos-5"] as const
const SONNET_55_MARKERS = ["sonnet-5-5", "sonnet-5.5"] as const
const HAIKU_55_MARKERS = ["haiku-5-5", "haiku-5.5"] as const

export function isClaudeOpus55Model(model: string): boolean {
  return hasClaudeMarker(model, OPUS_55_MARKERS)
}

export function isClaudeOpus5Model(model: string): boolean {
  return hasClaudeMarker(model, OPUS_5_MARKERS)
}

export function isClaudeOpus45Model(model: string): boolean {
  return hasClaudeMarker(model, OPUS_45_MARKERS)
}

export function isClaudeSonnet55Model(model: string): boolean {
  return hasClaudeMarker(model, SONNET_55_MARKERS)
}

export function isClaudeFable51Model(model: string): boolean {
  return hasClaudeMarker(model, FABLE_51_MARKERS)
}

export function isClaudeHaiku55Model(model: string): boolean {
  return hasClaudeMarker(model, HAIKU_55_MARKERS)
}

export function isGlm52Model(model: string): boolean {
  return hasSegmentSignal(model, "glm", "5-2")
}

export function isGlm53Model(model: string): boolean {
  return hasSegmentSignal(model, "glm", "5-3")
}

// DeepSeek V4 id shapes mirror the runtime: v4-1-flash / v4p1-flash / the official `deepseek-flash`
// alias classify as V4.1 Flash; the 0731 dated snapshot and the pro line stay distinct.
const DEEPSEEK_V41_FLASH_RE = /(?:^|[/@:._-])deepseek[._-]v4(?:[._-]1|p1)[._-]flash(?:$|[/@:._-])/
const DEEPSEEK_OFFICIAL_FLASH_ALIAS_RE = /(?:^|[/@:._-])deepseek[._-]flash(?:$|[/@:._-])/
const DEEPSEEK_V4_FLASH_RE = /(?:^|[/@:._-])deepseek[._-]v4[._-]flash(?:$|[/@:._-])/
const DEEPSEEK_V4_FLASH_0731_RE = /(?:^|[/@:._-])deepseek[._-]v4[._-]flash[._-]0731(?:$|[/@:._-])/
const DEEPSEEK_V4_PRO_RE = /(?:^|[/@:._-])deepseek[._-]v4[._-]pro(?:$|[/@:._-])/

export function isDeepseekV4Flash0731Model(model: string): boolean {
  return DEEPSEEK_V4_FLASH_0731_RE.test(normalizeModelId(model))
}

export function isDeepseekV41FlashModel(model: string): boolean {
  const normalized = normalizeModelId(model)
  return DEEPSEEK_V41_FLASH_RE.test(normalized) || DEEPSEEK_OFFICIAL_FLASH_ALIAS_RE.test(normalized)
}

export function isDeepseekV4FlashModel(model: string): boolean {
  return DEEPSEEK_V4_FLASH_RE.test(normalizeModelId(model))
}

export function isDeepseekV4ProModel(model: string): boolean {
  return DEEPSEEK_V4_PRO_RE.test(normalizeModelId(model))
}

const GROK_47_RE = /grok-4-7(?![0-9])/

export function isGrok47Model(model: string): boolean {
  return GROK_47_RE.test(extractModelName(model).toLowerCase().replaceAll(".", "-"))
}
