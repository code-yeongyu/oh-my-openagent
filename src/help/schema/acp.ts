import { z } from "zod"

export const AcpCapabilitySchema = z.object({
  name: z.string().describe("Capability name"),
  version: z.string().describe("Capability version"),
  enabled: z.boolean().describe("Whether the capability is enabled"),
}).meta({ ref: "AcpCapability" })

export const AcpAgentSchema = z.object({
  id: z.string().describe("Agent identifier"),
  name: z.string().describe("Agent display name"),
  version: z.string().nullable().describe("Agent version"),
  capabilities: z.array(AcpCapabilitySchema).describe("Agent capabilities"),
  description: z.string().optional().describe("Agent description"),
}).meta({ ref: "AcpAgent" })

export const AcpConnectionSchema = z.object({
  id: z.string().describe("Connection ID"),
  agentId: z.string().describe("Connected agent ID"),
  state: z.enum(["connected", "disconnected", "error"]).describe("Connection state"),
  startedAt: z.number().describe("Connection start timestamp (epoch ms)"),
  messagesSent: z.number().describe("Messages sent over this connection"),
  messagesReceived: z.number().describe("Messages received over this connection"),
}).meta({ ref: "AcpConnection" })

export const AcpServerSchema = z.object({
  hostname: z.string().describe("Server hostname"),
  port: z.number().describe("Server port"),
  running: z.boolean().describe("Whether the ACP server is running"),
  uptime: z.number().describe("Server uptime in seconds"),
  agents: z.array(AcpAgentSchema).describe("Registered agents"),
  connections: z.array(AcpConnectionSchema).describe("Active connections"),
}).meta({ ref: "AcpServer" })

export const AcpResultSchema = z.object({
  server: AcpServerSchema.describe("ACP server status"),
  timestamp: z.number().describe("Snapshot timestamp (epoch ms)"),
}).meta({ ref: "AcpResult" })

export type AcpCapability = z.infer<typeof AcpCapabilitySchema>
export type AcpAgent = z.infer<typeof AcpAgentSchema>
export type AcpConnection = z.infer<typeof AcpConnectionSchema>
export type AcpServer = z.infer<typeof AcpServerSchema>
export type AcpResult = z.infer<typeof AcpResultSchema>
