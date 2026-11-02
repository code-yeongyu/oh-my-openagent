import * as z from "zod"

// The advisor gate (#12112): a decision model judges whether the session is stuck and how, and only
// then an advisor model writes a plan the agent executes. Off by default: it sends session excerpts
// to two remote endpoints.

/** Environment variable names only; the key itself never lives in omo.json. */
const OmoAdvisorEnvNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

const OmoAdvisorThinkingSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])

const OmoAdvisorSettingsShape = {
  /** Run the advisor (default: false). */
  enabled: z.boolean(),
  /** Advisor model, `provider/model` (default: "anthropic/claude-opus-5-5"). */
  model: z.string().min(1),
  /** Thinking level of the advisor model (default: "medium"). */
  thinking: OmoAdvisorThinkingSchema,
  /** Category whose chain answers when `model` cannot start (default: "ultrabrain"). */
  category: z.string().min(1),
  /** Full URL of the `/v1/decisions` endpoint the gate questions are posted to. */
  decision_url: z.string().url(),
  /** Decision model id sent with every gate call. */
  decision_model: z.string().min(1),
  /** Name of the environment variable that holds the decision endpoint's bearer key. */
  api_key_env: OmoAdvisorEnvNameSchema,
  /** Stuck probability at or above which the advisor is asked (default: 0.7). */
  threshold: z.number().min(0).max(1),
  /** Minimum confidence of the trouble-kind label (default: 0.4). */
  kind_confidence: z.number().min(0).max(1),
  /** Tool results before the first gate call (default: 3). */
  min_calls: z.number().int().min(1).max(100),
  /** Ask the gate on every Nth tool result (default: 1, every result). */
  check_every: z.number().int().min(1).max(100),
  /** Tool results to wait after an advice before the gate may run again (default: 5). */
  cooldown: z.number().int().min(0).max(1000),
  /** Advice cap per session; 0 keeps the gate observing without ever asking the advisor (default: 10). */
  max_per_session: z.number().int().min(0).max(50),
  /** Recent tool calls kept per session; the gate reads the last 8, the advisor the last 12 (default: 24). */
  window: z.number().int().min(12).max(200),
  /** Upper bound for one advisor child, in seconds (default: 180). */
  timeout_seconds: z.number().int().min(10).max(900),
}

export const OmoAdvisorSettingsLayerSchema = z.object(OmoAdvisorSettingsShape).partial().strict()

export const OmoAdvisorSettingsSchema = OmoAdvisorSettingsLayerSchema.extend({
  enabled: z.boolean().default(false),
  model: z.string().min(1).default("anthropic/claude-opus-5-5"),
  thinking: OmoAdvisorThinkingSchema.default("medium"),
  category: z.string().min(1).default("ultrabrain"),
  decision_url: z.string().url().default("https://apis.opengateway.ai/v1/decisions"),
  decision_model: z.string().min(1).default("sionic-ai/jev-omni"),
  api_key_env: OmoAdvisorEnvNameSchema.default("OMO_ADVISOR_API_KEY"),
  threshold: z.number().min(0).max(1).default(0.7),
  kind_confidence: z.number().min(0).max(1).default(0.4),
  min_calls: z.number().int().min(1).max(100).default(3),
  check_every: z.number().int().min(1).max(100).default(1),
  cooldown: z.number().int().min(0).max(1000).default(5),
  max_per_session: z.number().int().min(0).max(50).default(10),
  window: z.number().int().min(12).max(200).default(24),
  timeout_seconds: z.number().int().min(10).max(900).default(180),
}).strict()

export type OmoAdvisorSettings = z.infer<typeof OmoAdvisorSettingsSchema>
export type OmoAdvisorSettingsLayer = z.infer<typeof OmoAdvisorSettingsLayerSchema>

export interface OmoAdvisorConfigView {
  readonly advisor?: OmoAdvisorSettingsLayer
}

export function resolveOmoAdvisorSettings(config: OmoAdvisorConfigView): OmoAdvisorSettings {
  return OmoAdvisorSettingsSchema.parse(config.advisor ?? {})
}
