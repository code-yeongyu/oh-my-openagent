import { z } from "zod"

export const ExternalMcpAllowlistConfigSchema = z.record(
  z.string().min(1),
  z.array(z.string().min(1)),
)

export type ExternalMcpAllowlistConfig = z.infer<typeof ExternalMcpAllowlistConfigSchema>
