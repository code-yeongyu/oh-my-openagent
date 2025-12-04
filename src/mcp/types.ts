import { z } from "zod"

export const McpNameSchema = z.enum(["websearch_exa", "context7"])

export type McpName = z.infer<typeof McpNameSchema>
