// Provider -> exportable model ids. The vocabulary must cover every rung a shipped builtin category
// can actually execute (`CATEGORY_FALLBACK_CHAINS`), otherwise the category-model insight reads as a
// wall of `custom` exactly on the rungs the product routes to; `product-identity.test.ts` pins that
// coverage. Masking stays PROVIDER-SPECIFIC: a model listed under one provider is still `custom`
// under a provider that does not ship it, and arbitrary user models are always `custom`.
export const KNOWN_MODELS = Object.freeze({
  "alibaba-token-plan": Object.freeze(["qwen3.6-flash", "qwen3.8-max-preview"]),
  "alibaba-token-plan-cn": Object.freeze(["qwen3.8-max-preview"]),
  anthropic: Object.freeze(["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]),
  "anthropic-api": Object.freeze(["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]),
  "bailian-coding-plan": Object.freeze(["qwen3.6-flash"]),
  deepseek: Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro"]),
  google: Object.freeze(["gemini-3.1-pro", "gemini-3.6-flash"]),
  "github-copilot": Object.freeze([
    "claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5", "gemini-3.1-pro",
    "gpt-5.6-sol", "gpt-5.6-terra", "grok-4.6",
  ]),
  "kimi-coding": Object.freeze(["k3", "kimi-for-coding-highspeed", "kimi-k3"]),
  "kimi-for-coding": Object.freeze(["k3", "kimi-for-coding-highspeed", "kimi-k3"]),
  moonshotai: Object.freeze(["kimi-k3"]),
  openai: Object.freeze(["gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra"]),
  "openai-codex": Object.freeze(["gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra"]),
  opencode: Object.freeze([
    "claude-fable-5", "claude-opus-5", "claude-sonnet-5", "gemini-3.1-pro", "gpt-5.6-sol",
    "gpt-5.6-terra", "grok-4.6", "kimi-k3",
  ]),
  "opencode-go": Object.freeze([
    "deepseek-v4-pro", "glm-5.2", "kimi-k3", "mimo-v2.5-pro", "minimax-m2.7", "minimax-m3",
  ]),
  "quotio-openai": Object.freeze(["gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra"]),
  "qwen-token-plan": Object.freeze(["qwen3.6-flash", "qwen3.8-max-preview"]),
  "qwen-token-plan-cn": Object.freeze(["qwen3.8-max-preview"]),
  vercel: Object.freeze([
    "claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5", "deepseek-v4-flash",
    "deepseek-v4-pro", "gemini-3.1-pro", "gemini-3.6-flash", "glm-5.2", "gpt-5.6-sol",
    "gpt-5.6-terra", "grok-4.6", "kimi-k3", "mimo-v2.5-pro", "minimax-m2.7", "minimax-m3",
    "qwen3.6-flash",
  ]),
  xai: Object.freeze(["grok-4.20-0309-non-reasoning", "grok-4.6"]),
  xiaomi: Object.freeze(["mimo-v2.5-pro"]),
  "zai-coding-plan": Object.freeze(["glm-5.2"]),
} as const)

export type KnownProvider = keyof typeof KNOWN_MODELS
export const KNOWN_PROVIDERS = Object.freeze(Object.keys(KNOWN_MODELS) as KnownProvider[])
