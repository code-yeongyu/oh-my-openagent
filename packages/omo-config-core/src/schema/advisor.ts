import * as z from "zod"

// The advisor gate (#12112): a decision model judges whether the session is wandering, and only then
// a configurable advisor model is asked for a short hint. Off by default: it sends session excerpts
// to two remote endpoints.

/** Environment variable names only; the key itself never lives in omo.json. */
const OmoAdvisorEnvNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)

const OmoAdvisorSettingsShape = {
  /** Run the advisor gate (default: false). */
  enabled: z.boolean(),
  /** Advisor model pin as `provider/model` (for example `anthropic/claude-opus-5-5`). Wins over `category`. */
  model: z.string().min(1),
  /** Category whose chain answers when no `model` is pinned (default: "ultrabrain"). */
  category: z.string().min(1),
  /** Full URL of the `/v1/decisions` endpoint the wandering question is posted to. */
  decision_url: z.string().url(),
  /** Decision model id sent with every gate call. */
  decision_model: z.string().min(1),
  /** Name of the environment variable that holds the decision endpoint's bearer key. */
  api_key_env: OmoAdvisorEnvNameSchema,
  /** Probability at or above which the gate asks the advisor model (default: 0.6). */
  threshold: z.number().min(0).max(1),
  /** Ask the gate after every N tool results (default: 5). */
  check_every: z.number().int().min(1).max(100),
  /** Tool results to wait after an advice before the gate may run again (default: 10). */
  cooldown: z.number().int().min(0).max(1000),
  /** Advice cap per session; 0 keeps the gate observing without ever asking the advisor (default: 3). */
  max_per_session: z.number().int().min(0).max(50),
  /** Recent events the gate and the advisor see (default: 24). */
  window: z.number().int().min(4).max(200),
  /** Upper bound for one advisor child, in seconds (default: 120). */
  timeout_seconds: z.number().int().min(10).max(600),
}

export const OmoAdvisorSettingsLayerSchema = z.object(OmoAdvisorSettingsShape).partial().strict()

export const OmoAdvisorSettingsSchema = OmoAdvisorSettingsLayerSchema.extend({
  enabled: z.boolean().default(false),
  category: z.string().min(1).default("ultrabrain"),
  decision_url: z.string().url().default("https://apis.opengateway.ai/v1/decisions"),
  decision_model: z.string().min(1).default("sionic-ai/jev-omni"),
  api_key_env: OmoAdvisorEnvNameSchema.default("OMO_ADVISOR_API_KEY"),
  threshold: z.number().min(0).max(1).default(0.6),
  check_every: z.number().int().min(1).max(100).default(5),
  cooldown: z.number().int().min(0).max(1000).default(10),
  max_per_session: z.number().int().min(0).max(50).default(3),
  window: z.number().int().min(4).max(200).default(24),
  timeout_seconds: z.number().int().min(10).max(600).default(120),
}).strict()

export type OmoAdvisorSettings = z.infer<typeof OmoAdvisorSettingsSchema>
export type OmoAdvisorSettingsLayer = z.infer<typeof OmoAdvisorSettingsLayerSchema>

export interface OmoAdvisorConfigView {
  readonly advisor?: OmoAdvisorSettingsLayer
}

/** Effective advisor settings; a partial layer is parsed through the full schema so defaults apply. */
export function resolveOmoAdvisorSettings(config: OmoAdvisorConfigView): OmoAdvisorSettings {
  return OmoAdvisorSettingsSchema.parse(config.advisor ?? {})
}
