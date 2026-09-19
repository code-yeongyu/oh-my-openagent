import type { ExtensionAPI } from "@code-yeongyu/senpi";

/**
 * FreeInference.org provider — explicit from https://doc.freeinference.org/models
 * Harvard SEAS MadSys Lab, free for research, OpenAI-compatible.
 * Base URLs: https://freeinference.org/v1 (OpenAI) and https://freeinference.org/anthropic
 * Auth: Authorization: Bearer $FREEINFERENCE_API_KEY, filtered by access level via GET /v1/models
 */
const BASE_URL = "https://freeinference.org/v1";
const API_KEY_ENV = "FREEINFERENCE_API_KEY";

const MODELS = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash (1M ctx, 393K out) - Agentic coding [Free]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.44, output: 1.32, cacheRead: 0.014, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 393216,
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1 (200K ctx, 128K out) - General coding, bilingual [Free]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 131072,
  },
  {
    id: "minimax-m2.5",
    name: "MiniMax M2.5 (205K ctx, 131K out) - General reasoning [Free]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 205000,
    maxTokens: 131072,
  },
  {
    id: "minimax-m3",
    name: "MiniMax M3 (1M ctx, 131K out, multimodal) - Long context [Free]",
    reasoning: true,
    input: ["text", "image", "video"] as const,
    cost: { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash (1M ctx, 131K out) - Coding, always-on thinking [Free]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.08, output: 0.32, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  {
    id: "qwen3.6-35b",
    name: "Qwen3.6 35B (262K ctx, 8K out, multimodal) - Fast non-thinking [Free]",
    reasoning: false,
    input: ["text", "image", "video"] as const,
    cost: { input: 0.08, output: 0.28, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
  },
  {
    id: "diffusiongemma",
    name: "DiffusionGemma 26B (262K ctx, 8K out) - Fast local [Free]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.02, output: 0.08, cacheRead: 0.01, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 8192,
  },
  {
    id: "glm-5.2",
    name: "GLM-5.2 (1M ctx, 131K out) - Switchable thinking [Pro]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3 (1M ctx, 131K out) - Strongest coding, always-on [Pro]",
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0.25, output: 1.0, cacheRead: 0.02, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 131072,
  },
  {
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code (262K ctx, 131K out, multimodal) - Coding agents [Pro]",
    reasoning: true,
    input: ["text", "image", "video"] as const,
    cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
    contextWindow: 262144,
    maxTokens: 131072,
  },
  {
    id: "bge-m3",
    name: "BGE-M3 (8K ctx, Embedding) - Codebase indexing via /v1/embeddings [Free]",
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 8192,
  },
] as const;

export function registerFreeInferenceProvider(pi: ExtensionAPI) {
  const apiKey = `$${API_KEY_ENV}`;
  pi.registerProvider("freeinference.org", {
    baseUrl: BASE_URL,
    apiKey,
    api: "openai-completions",
    models: MODELS as any,
    async refreshModels(ctx: any) {
      try {
        const key = process.env[API_KEY_ENV]?.trim() ?? "";
        if (!key) return MODELS as any;
        const res = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: ctx.signal,
        });
        if (!res.ok) return MODELS as any;
        const data = (await res.json()) as any;
        return (data.data as any[]).map((m: any) => {
          const isEmbedding = m.output_modalities?.includes("embedding");
          const reasoning = !isEmbedding && (m.supported_sampling_parameters || []).some((p: string) => ["thinking", "reasoning_effort"].includes(p));
          const input = (m.input_modalities || ["text"]) as ("text" | "image" | "video")[];
          const pricing = m.pricing || {};
          return {
            id: m.id,
            name: m.name || m.id,
            reasoning,
            input,
            cost: {
              input: parseFloat(pricing.prompt || "0"),
              output: parseFloat(pricing.completion || "0"),
              cacheRead: parseFloat(pricing.input_cache_reads || "0"),
              cacheWrite: parseFloat(pricing.input_cache_writes || "0"),
            },
            contextWindow: m.context_length || 8192,
            maxTokens: isEmbedding ? 8192 : m.max_output_length || 8192,
          };
        });
      } catch {
        return MODELS as any;
      }
    },
  });
  pi.registerProvider("freeinference", {
    baseUrl: BASE_URL,
    apiKey: `$${API_KEY_ENV}`,
    api: "openai-completions",
    models: MODELS as any,
  });
}
