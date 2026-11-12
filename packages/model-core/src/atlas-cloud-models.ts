export const ATLAS_CLOUD_PROVIDER_ID = "atlascloud"

export const ATLAS_CLOUD_MODEL_IDS = {
  deepseekV4Flash: "deepseek-ai/deepseek-v4-flash",
  deepseekV4Pro: "deepseek-ai/deepseek-v4-pro",
  glm52: "zai-org/glm-5.2",
  gpt56Sol: "openai/gpt-5.6-sol",
  gpt56Terra: "openai/gpt-5.6-terra",
  katCoderAirV25: "kwaipilot/kat-coder-air-v2.5",
  katCoderProV25: "kwaipilot/kat-coder-pro-v2.5",
  kimiK3: "moonshotai/kimi-k3",
  minimaxM27: "minimaxai/minimax-m2.7",
  minimaxM3: "minimaxai/minimax-m3",
  mimoV25Pro: "xiaomi/mimo-v2.5-pro",
  qwen37Plus: "qwen/qwen3.7-plus",
} as const

export type AtlasCloudModel = {
  readonly id: string
  readonly name: string
  readonly context: number
  readonly output: number
  readonly input: readonly ("text" | "image" | "video")[]
  readonly reasoning?: boolean
  readonly temperature?: boolean
  readonly toolCall?: boolean
}

export const ATLAS_CLOUD_MODELS: readonly AtlasCloudModel[] = [
  { id: ATLAS_CLOUD_MODEL_IDS.katCoderProV25, name: "KAT Coder Pro V2.5", context: 262_144, output: 262_144, input: ["text", "image", "video"], reasoning: true, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.katCoderAirV25, name: "KAT Coder Air V2.5", context: 262_144, output: 262_144, input: ["text", "image", "video"], reasoning: true, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.kimiK3, name: "Kimi K3", context: 1_048_576, output: 1_048_576, input: ["text", "image", "video"], reasoning: true, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.gpt56Sol, name: "GPT 5.6 Sol", context: 1_050_000, output: 131_072, input: ["text", "image"] },
  { id: ATLAS_CLOUD_MODEL_IDS.gpt56Terra, name: "GPT 5.6 Terra", context: 1_050_000, output: 131_072, input: ["text", "image"] },
  { id: ATLAS_CLOUD_MODEL_IDS.glm52, name: "GLM 5.2", context: 1_048_576, output: 131_072, input: ["text"], reasoning: true, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.deepseekV4Pro, name: "DeepSeek V4 Pro", context: 1_048_576, output: 393_216, input: ["text"], reasoning: false, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.deepseekV4Flash, name: "DeepSeek V4 Flash", context: 1_048_576, output: 393_216, input: ["text"], reasoning: false, temperature: true, toolCall: true },
  { id: ATLAS_CLOUD_MODEL_IDS.qwen37Plus, name: "Qwen3.7 Plus", context: 1_000_000, output: 67_072, input: ["text", "image"] },
  { id: ATLAS_CLOUD_MODEL_IDS.mimoV25Pro, name: "MiMo V2.5 Pro", context: 1_024_000, output: 131_072, input: ["text"] },
  { id: ATLAS_CLOUD_MODEL_IDS.minimaxM3, name: "MiniMax M3", context: 524_300, output: 524_288, input: ["text"] },
  { id: ATLAS_CLOUD_MODEL_IDS.minimaxM27, name: "MiniMax M2.7", context: 196_608, output: 196_608, input: ["text"], reasoning: true, temperature: true, toolCall: true },
]

const ATLAS_CLOUD_MODEL_ID_BY_CANONICAL_ID: Readonly<Record<string, string>> = {
  "deepseek-v4-flash": ATLAS_CLOUD_MODEL_IDS.deepseekV4Flash,
  "deepseek-v4-pro": ATLAS_CLOUD_MODEL_IDS.deepseekV4Pro,
  "glm-5.2": ATLAS_CLOUD_MODEL_IDS.glm52,
  "gpt-5.6-sol": ATLAS_CLOUD_MODEL_IDS.gpt56Sol,
  "gpt-5.6-terra": ATLAS_CLOUD_MODEL_IDS.gpt56Terra,
  "kimi-k3": ATLAS_CLOUD_MODEL_IDS.kimiK3,
  "minimax-m2.7": ATLAS_CLOUD_MODEL_IDS.minimaxM27,
  "minimax-m3": ATLAS_CLOUD_MODEL_IDS.minimaxM3,
  "MiniMax-M3": ATLAS_CLOUD_MODEL_IDS.minimaxM3,
  "mimo-v2.5-pro": ATLAS_CLOUD_MODEL_IDS.mimoV25Pro,
  "qwen3.7-plus": ATLAS_CLOUD_MODEL_IDS.qwen37Plus,
}

export function resolveAtlasCloudModelID(modelID: string): string {
  return ATLAS_CLOUD_MODEL_ID_BY_CANONICAL_ID[modelID] ?? modelID
}
