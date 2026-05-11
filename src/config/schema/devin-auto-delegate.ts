import { z } from "zod"

export const DevinAutoDelegateConfigSchema = z.boolean()

export type DevinAutoDelegateConfig = z.infer<typeof DevinAutoDelegateConfigSchema>
