import { z } from "zod"
import { EngineNameSchema } from "../../mcp/idm-browser/types"

export const BrowserAutomationProviderSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "playwright-cli",
])

export const AiPrimitivesConfigSchema = z.object({
  model: z.string().optional(),
  category: z.string().optional(),
  fallback_chain: z.array(z.string()).optional(),
  use_prompt_caching: z.boolean().default(true),
})

export const ProxySessionConfigSchema = z.object({
  mode: z.enum(["sticky", "rotating"]).default("sticky"),
  duration_minutes: z.number().int().positive().default(30),
  country: z.string().length(2).default("IT"),
  city: z.string().nullable().default(null),
})

export const ProxyFallbackConfigSchema = z.object({
  on_burned_profile: z.enum(["rotate_session", "rotate_endpoint", "none"]).default("rotate_session"),
  on_403_or_challenge: z.enum(["rotate_session", "rotate_endpoint", "none"]).default("rotate_session"),
})

export const ProxyConfigSchema = z.object({
  provider: z.enum(["oxylabs", "smartproxy", "iproyal", "custom"]).default("oxylabs"),
  protocol: z.enum(["http", "socks5"]).default("http"),
  endpoint: z.string().default("pr.oxylabs.io:7777"),
  credentials: z.string(),
  session: ProxySessionConfigSchema.optional(),
  fallback: ProxyFallbackConfigSchema.optional(),
})

export const BehaviorConfigSchema = z.object({
  mode: z.enum(["auto", "always", "never"]).default("auto"),
  trust_cf_clearance: z.boolean().default(true),
  min_action_delay_ms: z.number().int().nonnegative().default(200),
})

export const PoolConfigSchema = z.object({
  max_concurrent_contexts: z.number().int().positive().default(5),
  context_idle_timeout_ms: z.number().int().positive().default(300_000),
  engine_idle_close_ms: z.number().int().positive().default(1_800_000),
  memory_high_watermark_mb: z.number().int().positive().default(8192),
  block_resources: z.array(z.string()).default(["image", "media", "font"]),
})

export const VisionLlmConfigSchema = z.object({
  use_layer2_provider: z.boolean().default(true),
  model_override: z.string().nullable().default(null),
})

export const CaptchaConfigSchema = z.object({
  enabled_solvers: z.array(z.enum([
    "skip", "playwright-captcha", "whisper-audio", "vision-llm", "manual", "capsolver",
  ])).default(["skip", "playwright-captcha", "whisper-audio", "vision-llm", "manual", "capsolver"]),
  vision_llm: VisionLlmConfigSchema.optional(),
  capsolver_api_key: z.string().optional(),
  max_solver_cost_eur: z.number().nonnegative().default(0.10),
  manual_timeout_ms: z.number().int().positive().default(300_000),
})

export const CredentialsConfigSchema = z.object({
  provider: z.enum(["1password", "bitwarden", "keychain", "env"]).optional(),
  items: z.record(z.string(), z.string()).default({}),
})

export const BrowserAutomationConfigSchema = z.object({
  provider: BrowserAutomationProviderSchema.default("playwright"),
  engine: EngineNameSchema.default("camoufox"),
  force_engine: EngineNameSchema.optional(),
  headless: z.boolean().default(true),
  ai_primitives: AiPrimitivesConfigSchema.optional(),
  behavior: BehaviorConfigSchema.optional(),
  proxy: ProxyConfigSchema.optional(),
  pool: PoolConfigSchema.optional(),
  captcha: CaptchaConfigSchema.optional(),
  credentials: CredentialsConfigSchema.optional(),
})

export type BrowserAutomationProvider = z.infer<
  typeof BrowserAutomationProviderSchema
>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>
