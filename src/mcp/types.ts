import { z } from "zod"

export const McpNameSchema = z.enum(["websearch_exa", "context7", "grep_app"])

export type McpName = z.infer<typeof McpNameSchema>

// Allow any MCP name for extensibility (upstream compatibility)
export const AnyMcpNameSchema = z.string().min(1)

export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
