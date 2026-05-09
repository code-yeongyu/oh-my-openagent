function inferSubProvider(model: string): string | undefined {
  if (model.startsWith("claude-")) return "anthropic"
  if (model.startsWith("gpt-")) return "openai"
  if (model.startsWith("gemini-")) return "google"
  if (model.startsWith("grok-")) return "xai"
  if (model.startsWith("minimax-")) return "minimax"
  if (model.startsWith("kimi-")) return "moonshotai"
  if (model.startsWith("glm-")) return "zai"
  return undefined
}

const CLAUDE_VERSION_DOT = /claude-(\w+)-(\d+)-(\d+)/g
const GEMINI_31_PRO_PREVIEW = /gemini-3\.1-pro(?!-)/g
const GEMINI_3_FLASH_PREVIEW = /gemini-3-flash(?!-)/g

function claudeVersionDot(model: string): string {
  return model.replace(CLAUDE_VERSION_DOT, "claude-$1-$2.$3")
}

function applyGatewayTransforms(model: string): string {
  return claudeVersionDot(model).replace(
    GEMINI_31_PRO_PREVIEW,
    "gemini-3.1-pro-preview",
  )
}

export function transformModelForProvider(provider: string, model: string): string {
  if (provider === "vercel") {
    const slashIndex = model.indexOf("/")
    if (slashIndex !== -1) {
      const subProvider = model.substring(0, slashIndex)
      const subModel = model.substring(slashIndex + 1)
      return `${subProvider}/${applyGatewayTransforms(subModel)}`
    }

    const subProvider = inferSubProvider(model)
    if (subProvider) {
      return `${subProvider}/${applyGatewayTransforms(model)}`
    }

    return model
  }

  if (provider === "openrouter") {
    // OpenRouter uses nested IDs: openrouter/<upstream>/<model>, e.g.
    // openrouter/anthropic/claude-opus-4.7.
    // Apply the same gateway transforms as Vercel (claude dash->dot, gemini
    // preview suffixes) plus zai->z-ai sub-provider mapping.
    const subModel = applyGatewayTransforms(model)
      .replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")

    const slashIndex = subModel.indexOf("/")
    if (slashIndex !== -1) {
      const subProvider = subModel.substring(0, slashIndex).replace(/^zai$/, "z-ai")
      return `${subProvider}/${subModel.substring(slashIndex + 1)}`
    }

    const subProvider = inferSubProvider(model)?.replace(/^zai$/, "z-ai")
    if (subProvider) {
      return `${subProvider}/${subModel}`
    }

    return subModel
  }

  if (provider === "github-copilot") {
    return claudeVersionDot(model)
      .replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
      .replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
  }

  if (provider === "google") {
    return model
      .replace(GEMINI_31_PRO_PREVIEW, "gemini-3.1-pro-preview")
      .replace(GEMINI_3_FLASH_PREVIEW, "gemini-3-flash-preview")
  }

  if (provider === "anthropic") {
    // Installer writes hyphenated IDs (claude-opus-4-7) to the config. The
    // runtime provider-model-id-transform converts dash→dot when calling the
    // Anthropic API. Keeping the dotted form in the config breaks fresh
    // installs with ProviderModelNotFoundError because Anthropic's provider
    // registers models under hyphenated IDs.
    return model
  }

  return model
}
