import { isDeepseekV41FlashModel, isGptModel } from "@oh-my-opencode/model-core"

import { SENPI_GPT_ULTRAWORK_DIRECTIVE, SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"

// Ultrawork speaks to a session through one of these prompts. Each is a whole prompt with its own
// source file, never a patch over another (#14441): `default` is written for models that need the
// procedure spelled out, `gpt` for models whose system prompt already owns reading, reporting and
// todo upkeep and that stall on instructions pulling two ways. DeepSeek V4.1 Flash runs a core copied
// from gpt-6.2 and reacts to conflicting instructions the same way, so it gets `gpt` too (#14442).
type UltraworkVariant = "default" | "gpt"

export const ULTRAWORK_DIRECTIVES: Readonly<Record<UltraworkVariant, string>> = {
  default: SENPI_ULTRAWORK_DIRECTIVE,
  gpt: SENPI_GPT_ULTRAWORK_DIRECTIVE,
}

function ultraworkVariantFor(modelId: string | undefined): UltraworkVariant {
  if (modelId === undefined) return "default"
  return isGptModel(modelId) || isDeepseekV41FlashModel(modelId) ? "gpt" : "default"
}

export function ultraworkDirectiveFor(modelId: string | undefined): string {
  return ULTRAWORK_DIRECTIVES[ultraworkVariantFor(modelId)]
}
