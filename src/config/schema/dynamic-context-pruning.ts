import { z } from "zod"

export const DynamicContextPruningConfigSchema = z.object({
  /** Enable dynamic context pruning (default: false) */
  enabled: z.boolean().default(false),
  /** Notification level: off, minimal, or detailed (default: detailed) */
  notification: z.enum(["off", "minimal", "detailed"]).default("detailed"),
  /** Turn protection - prevent pruning recent tool outputs */
  turn_protection: z
    .object({
      enabled: z.boolean().default(true),
      turns: z.number().min(1).max(10).default(3),
    })
    .optional(),
  /** Tools that should never be pruned */
  protected_tools: z.array(z.string()).default([
    "task",
    "todowrite",
    "todoread",
    "lsp_rename",
    "session_read",
    "session_write",
    "session_search",
  ]),
  /** Pruning strategies configuration */
  strategies: z
    .object({
      /** Remove duplicate tool calls (same tool + same args) */
      deduplication: z
        .object({
          enabled: z.boolean().default(true),
        })
        .optional(),
      /** Prune write inputs when file subsequently read */
      supersede_writes: z
        .object({
          enabled: z.boolean().default(true),
          /** Aggressive mode: prune any write if ANY subsequent read */
          aggressive: z.boolean().default(false),
        })
        .optional(),
      /** Prune errored tool inputs after N turns */
      purge_errors: z
        .object({
          enabled: z.boolean().default(true),
          turns: z.number().min(1).max(20).default(5),
        })
        .optional(),
    })
    .optional(),
})

export type DynamicContextPruningConfig = z.infer<
  typeof DynamicContextPruningConfigSchema
>
