export type OllamaModelTier = "small" | "medium" | "large" | "vision";

export interface OllamaModelEntry {
  id: string;
  tier: OllamaModelTier;
  supportsTools: boolean;
  supportsVision: boolean;
}

export const OLLAMA_MODELS: OllamaModelEntry[] = [
  {
    id: "llama3.2:8b",
    tier: "small",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "qwen2.5-coder:7b",
    tier: "small",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "gemma3:8b",
    tier: "small",
    supportsTools: false,
    supportsVision: false,
  },
  {
    id: "qwen2.5-coder:32b",
    tier: "medium",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "mistral-small:24b",
    tier: "medium",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "llama3.1:14b",
    tier: "medium",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "llama3.1:70b",
    tier: "large",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "qwen2.5:72b",
    tier: "large",
    supportsTools: true,
    supportsVision: false,
  },
  {
    id: "deepseek-r1:70b",
    tier: "large",
    supportsTools: false,
    supportsVision: false,
  },
  {
    id: "llama3.2-vision:11b",
    tier: "vision",
    supportsTools: false,
    supportsVision: true,
  },
  {
    id: "gemma3:12b",
    tier: "vision",
    supportsTools: false,
    supportsVision: true,
  },
];

export const OLLAMA_SMALL_MODEL = "llama3.2:8b";
export const OLLAMA_MEDIUM_MODEL = "qwen2.5-coder:32b";
export const OLLAMA_LARGE_MODEL = "llama3.1:70b";
export const OLLAMA_VISION_MODEL = "llama3.2-vision:11b";

export function getOllamaModelForTier(tier: OllamaModelTier): string {
  switch (tier) {
    case "small":
      return OLLAMA_SMALL_MODEL;
    case "medium":
      return OLLAMA_MEDIUM_MODEL;
    case "large":
      return OLLAMA_LARGE_MODEL;
    case "vision":
      return OLLAMA_VISION_MODEL;
  }
}
