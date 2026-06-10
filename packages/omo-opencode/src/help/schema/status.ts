import { z } from "zod"

/**
 * Help JSON schema for the `status` surface.
 * Defines the structure of overall system status output.
 */
export const SessionStatusSchema = z
  .object({
    type: z.enum(["idle", "retry", "busy"]).describe("Current session state"),
    attempt: z.number().optional().describe("Retry attempt count"),
    message: z.string().optional().describe("Status detail message"),
    next: z.number().optional().describe("Next retry timestamp (epoch ms)"),
  })
  .meta({ ref: "SessionStatus" })

export const ProviderHealthSchema = z
  .object({
    id: z.string().describe("Provider identifier"),
    name: z.string().describe("Provider display name"),
    connected: z.boolean().describe("Whether the provider is connected"),
    defaultModel: z.string().nullable().describe("Default model ID"),
    modelsAvailable: z.number().describe("Number of available models"),
  })
  .meta({ ref: "ProviderHealth" })

export const McpHealthSchema = z
  .object({
    name: z.string().describe("MCP server name"),
    status: z.enum(["running", "stopped", "error"]).describe("Server run state"),
    error: z.string().nullable().optional().describe("Error message if status is error"),
  })
  .meta({ ref: "McpHealth" })

export const LspHealthSchema = z
  .object({
    id: z.string().describe("LSP server identifier"),
    running: z.boolean().describe("Whether the LSP server is running"),
    workspaceRoot: z.string().nullable().describe("Workspace root path"),
  })
  .meta({ ref: "LspHealth" })

export const SystemHealthSchema = z
  .object({
    opencode: z.object({
      version: z.string().describe("OpenCode version"),
      running: z.boolean().describe("Whether the server is running"),
      uptime: z.number().describe("Server uptime in seconds"),
    }).describe("OpenCode server health"),
    sessions: z.object({
      total: z.number().describe("Total session count"),
      active: z.number().describe("Active session count"),
      statuses: z.record(z.string(), SessionStatusSchema).optional().describe("Per-session statuses"),
    }).describe("Session overview"),
    providers: z.array(ProviderHealthSchema).describe("Provider connection statuses"),
    mcps: z.array(McpHealthSchema).describe("MCP server statuses"),
    lsps: z.array(LspHealthSchema).describe("LSP server statuses"),
    plugins: z.array(z.object({
      name: z.string().describe("Plugin name"),
      version: z.string().nullable().describe("Plugin version"),
      enabled: z.boolean().describe("Whether the plugin is loaded"),
    })).describe("Loaded plugins"),
  })
  .meta({ ref: "SystemHealth" })

export const StatusResultSchema = z
  .object({
    system: SystemHealthSchema.describe("Overall system health"),
    timestamp: z.number().describe("Snapshot timestamp (epoch ms)"),
  })
  .meta({ ref: "StatusResult" })

export type SessionStatus = z.infer<typeof SessionStatusSchema>
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>
export type McpHealth = z.infer<typeof McpHealthSchema>
export type LspHealth = z.infer<typeof LspHealthSchema>
export type SystemHealth = z.infer<typeof SystemHealthSchema>
export type StatusResult = z.infer<typeof StatusResultSchema>
