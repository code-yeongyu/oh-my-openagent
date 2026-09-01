import * as z from "zod"

export const HARNESS_IDS = ["codex", "opencode", "omo"] as const

export type HarnessId = (typeof HARNESS_IDS)[number]

export const OMO_CONFIG_HARNESS_IDS = ["opencode", "senpi", "codex"] as const

export const OmoHarnessIdSchema = z.enum(OMO_CONFIG_HARNESS_IDS)

export type OmoHarnessId = z.infer<typeof OmoHarnessIdSchema>
