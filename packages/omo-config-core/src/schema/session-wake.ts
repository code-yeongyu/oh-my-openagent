import * as z from "zod"

/**
 * Waking a session that is not running (#13037). `same_device`: a send from this machine to a session here that is not
 * running starts it (default off). `wake_limit`: at most this many consecutive wakes of a session nobody attends, 0 (the
 * default) meaning no bound.
 */
export const OmoSessionWakeSettingsSchema = z
  .object({
    same_device: z.boolean().optional(),
    wake_limit: z.number().int().min(0).optional(),
  })
  .strict()

export type OmoSessionWakeSettings = z.infer<typeof OmoSessionWakeSettingsSchema>

export type ResolvedSessionWakeSettings = { readonly sameDevice: boolean; readonly wakeLimit: number }

export function resolveSessionWakeSettings(config: {
  readonly session_wake?: OmoSessionWakeSettings | undefined
}): ResolvedSessionWakeSettings {
  return {
    sameDevice: config.session_wake?.same_device ?? false,
    wakeLimit: config.session_wake?.wake_limit ?? 0,
  }
}
