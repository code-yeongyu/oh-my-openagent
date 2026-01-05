import { z } from "zod"

export const McpNameSchema = z.enum(["context7", "grep_app"])

export type McpName = z.infer<typeof McpNameSchema>
