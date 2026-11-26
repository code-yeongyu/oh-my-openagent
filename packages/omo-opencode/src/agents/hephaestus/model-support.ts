const GPT_5_3_CODEX_RE = /^gpt-5[.-]3-codex(?:$|[.-])/i
const GPT_5_4_RE = /^gpt-5[.-]4(?:$|[.-])/i
const GPT_5_5_RE = /^gpt-5[.-]5(?:$|[.-])/i
const GPT_5_6_RE = /^gpt-5[.-]6(?:$|[.-])/i
const GPT_6_RE = /^gpt-6(?:$|[.-])/i
const HOSTED_VENDOR_PREFIX_RE = /^(?:[^./]+\.)+(gpt-5[.-].*)$/i

export class UnsupportedHephaestusModelError extends Error {
  readonly model: string | undefined

  constructor(model: string | undefined) {
    super(
      `Hephaestus only supports GPT-5.3 Codex, GPT-5.4, GPT-5.5, and GPT-5.6 models; received ${model ?? "no model"}.`,
    )
    this.name = "UnsupportedHephaestusModelError"
    this.model = model
  }
}

function extractModelName(model: string): string {
  const afterProvider = model.includes("/") ? (model.split("/").pop() ?? model) : model
  return HOSTED_VENDOR_PREFIX_RE.exec(afterProvider)?.[1] ?? afterProvider
}

export function isHephaestusSupportedModel(model: string | undefined): boolean {
  if (!model) return false
  const modelName = extractModelName(model)
  return (
    GPT_5_3_CODEX_RE.test(modelName) ||
    GPT_5_4_RE.test(modelName) ||
    GPT_5_5_RE.test(modelName) ||
    GPT_5_6_RE.test(modelName) ||
    GPT_6_RE.test(modelName)
  )
}

/** Native presets that are the whole deep-work prompt on their own: Hephaestus appends no role after them (#14186). */
const STANDALONE_PRESETS: ReadonlySet<string> = new Set(["gpt-6.2"])

export function isStandaloneHephaestusPreset(preset: string | undefined): boolean {
  return preset !== undefined && STANDALONE_PRESETS.has(preset)
}

export function assertHephaestusSupportedModel(model: string | undefined): void {
  if (!isHephaestusSupportedModel(model)) {
    throw new UnsupportedHephaestusModelError(model)
  }
}
