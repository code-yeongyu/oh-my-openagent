import { z } from "zod"

export const McpNameSchema = z.enum(["websearch_exa", "context7", "grep_app", "honeycomb", "cypress", "vault"])

export type McpName = z.infer<typeof McpNameSchema>
