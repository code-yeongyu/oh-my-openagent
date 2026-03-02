import { z } from "zod"

export const TtsrConfigSchema = z.object({
  /** Enable TTSR stream rule monitoring (default: true) */
  enabled: z.boolean().default(true),
  /** How to handle partial output when aborting (default: "discard") */
  contextMode: z.enum(["discard", "keep"]).default("discard"),
  /** When to trigger interrupts (default: "always") */
  interruptMode: z.enum(["always", "prose-only", "tool-only", "never"]).default("always"),
  /** How repeat triggers are handled (default: "once") */
  repeatMode: z.enum(["once", "after-gap"]).default("once"),
  /** Number of turns before repeat trigger allowed (default: 10) */
  repeatGap: z.number().int().min(1).default(10),
  /** Maximum retries per rule per session (default: 3) */
  maxRetriesPerRule: z.number().int().min(1).max(10).default(3),
})

export type TtsrConfig = z.infer<typeof TtsrConfigSchema>
