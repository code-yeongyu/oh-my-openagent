import { posix, win32 } from "node:path"

import * as z from "zod"

const AtomicBinaryPathSchema = z
  .string()
  .min(1)
  .refine((value) => posix.isAbsolute(value) || win32.isAbsolute(value), {
    message: "binary_path must be an absolute path to the atomic executable",
  })

const OmoAtomicContextShape = {
  /** Inject Atomic vault context into the model prompt while Atomic is active (default: true). */
  enabled: z.boolean(),
  /** Maximum number of context entries per retrieval (default: 5). */
  limit: z.number().int().min(1).max(20),
  /** Character budget of one injected context block (default: 8000). */
  budget_chars: z.number().int().min(256).max(16_000),
  /** Timeout of one context retrieval in milliseconds (default: 1000). */
  timeout_ms: z.number().int().min(100).max(5000),
  /** How long a retrieved context block is reused, in milliseconds; 0 disables the cache (default: 15000). */
  cache_ttl_ms: z.number().int().min(0).max(60_000),
}

const OmoAtomicRecordingShape = {
  /** Record agent turns into the Atomic graph while Atomic is active (default: true). */
  enabled: z.boolean(),
  /** Who records: `auto` defers to an active Atomic-installed recorder, `omo` always records, `external` never does (default: "auto"). */
  owner: z.enum(["auto", "omo", "external"]),
  /** Timeout of one recording call in milliseconds (default: 30000). */
  timeout_ms: z.number().int().min(1000).max(120_000),
}

export const OmoAtomicContextSettingsLayerSchema = z.object(OmoAtomicContextShape).partial().strict()

export const OmoAtomicContextSettingsSchema = z
  .object({
    enabled: OmoAtomicContextShape.enabled.default(true),
    limit: OmoAtomicContextShape.limit.default(5),
    budget_chars: OmoAtomicContextShape.budget_chars.default(8000),
    timeout_ms: OmoAtomicContextShape.timeout_ms.default(1000),
    cache_ttl_ms: OmoAtomicContextShape.cache_ttl_ms.default(15_000),
  })
  .strict()

export const OmoAtomicRecordingSettingsLayerSchema = z.object(OmoAtomicRecordingShape).partial().strict()

export const OmoAtomicRecordingSettingsSchema = z
  .object({
    enabled: OmoAtomicRecordingShape.enabled.default(true),
    owner: OmoAtomicRecordingShape.owner.default("auto"),
    timeout_ms: OmoAtomicRecordingShape.timeout_ms.default(30_000),
  })
  .strict()

/** One config layer's `atomic` block: every key optional and no defaults, so an empty block overrides nothing. */
export const OmoAtomicSettingsLayerSchema = z
  .object({
    /** Opt in to the Atomic CLI integration. Only the user config may set it (default: false). */
    enabled: z.boolean(),
    /** Absolute path of the `atomic` executable; unset resolves `atomic` on PATH. Only the user config may set it. */
    binary_path: AtomicBinaryPathSchema,
    context: OmoAtomicContextSettingsLayerSchema,
    recording: OmoAtomicRecordingSettingsLayerSchema,
  })
  .partial()
  .strict()

export const OmoAtomicSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    binary_path: AtomicBinaryPathSchema.optional(),
    context: OmoAtomicContextSettingsSchema.default(() => OmoAtomicContextSettingsSchema.parse({})),
    recording: OmoAtomicRecordingSettingsSchema.default(() => OmoAtomicRecordingSettingsSchema.parse({})),
  })
  .strict()

export type OmoAtomicContextSettings = z.infer<typeof OmoAtomicContextSettingsSchema>
export type OmoAtomicRecordingSettings = z.infer<typeof OmoAtomicRecordingSettingsSchema>
export type OmoAtomicSettings = z.infer<typeof OmoAtomicSettingsSchema>
export type OmoAtomicSettingsLayer = z.infer<typeof OmoAtomicSettingsLayerSchema>

export interface OmoAtomicConfigView {
  readonly atomic?: OmoAtomicSettings
}

/** The effective Atomic settings of a loaded config, applying defaults when the section is absent. */
export function resolveOmoAtomicSettings(config: OmoAtomicConfigView): OmoAtomicSettings {
  return config.atomic ?? OmoAtomicSettingsSchema.parse({})
}
