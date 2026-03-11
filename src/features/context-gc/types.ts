/**
 * Generic message info -- replaces @opencode-ai/sdk Message.
 * The GC algorithm accesses these fields via shape casts.
 */
export interface GcMessageInfo {
  id?: string
  sessionID?: string
  role?: string
  [key: string]: unknown
}

/**
 * Generic message part -- replaces @opencode-ai/sdk Part.
 * Fields represent the union of all shapes the GC accesses.
 */
export interface GcPart {
  type: string
  text?: string
  tool?: string
  callID?: string
  state?: { output?: string; input?: unknown; status?: string }
  thinking?: string
  [key: string]: unknown
}

export interface MessageWithParts {
  info: GcMessageInfo
  parts: GcPart[]
}

/**
 * GC configuration -- replaces OMC's ContextGcConfig Zod schema.
 * All fields optional with sensible defaults in the algorithm.
 */
export interface ContextGcConfig {
  tool_output_token_threshold?: number
  hot_turns?: number
  warm_turns?: number
  cold_turns?: number
  gone_turns?: number
  min_hot_turns?: number
  max_gone_per_cycle?: number
  gc_trigger_pct?: number
  gc_target_pct?: number
  gc_cooldown_ms?: number
  brain_write_through?: boolean
  disable_preemptive_compaction?: boolean
}

export type Logger = (message: string, data?: Record<string, unknown>) => void
