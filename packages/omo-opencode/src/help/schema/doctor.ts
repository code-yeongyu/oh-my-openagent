import { z } from "zod"

/**
 * Help JSON schema for the `doctor` surface.
 * Defines the structure of doctor diagnostic output.
 */
export const DoctorIssueSchema = z
  .object({
    title: z.string().describe("Short issue title"),
    description: z.string().describe("Detailed description of the issue"),
    fix: z.string().optional().describe("Suggested fix or remediation"),
    affects: z.array(z.string()).optional().describe("Components or areas affected"),
    severity: z.enum(["error", "warning"]).describe("Severity level of the issue"),
  })
  .meta({ ref: "DoctorIssue" })

export const CheckResultSchema = z
  .object({
    name: z.string().describe("Check display name"),
    status: z.enum(["pass", "fail", "warn", "skip"]).describe("Check outcome"),
    message: z.string().describe("Result summary message"),
    details: z.array(z.string()).optional().describe("Detailed diagnostic lines"),
    issues: z.array(DoctorIssueSchema).describe("Issues found by this check"),
    duration: z.number().optional().describe("Check execution time in milliseconds"),
  })
  .meta({ ref: "CheckResult" })

export const SystemInfoSchema = z
  .object({
    opencodeVersion: z.string().nullable().describe("Installed OpenCode version"),
    opencodePath: z.string().nullable().describe("Path to OpenCode binary"),
    pluginVersion: z.string().nullable().describe("oh-my-openagent plugin version"),
    loadedVersion: z.string().nullable().describe("Loaded plugin version at runtime"),
    bunVersion: z.string().nullable().describe("Bun runtime version"),
    configPath: z.string().nullable().describe("Path to active config file"),
    configValid: z.boolean().describe("Whether the config parses correctly"),
    isLocalDev: z.boolean().describe("Whether running in local development mode"),
  })
  .meta({ ref: "SystemInfo" })

export const LspServerInfoSchema = z
  .object({
    id: z.string().describe("LSP server identifier"),
    extensions: z.array(z.string()).describe("File extensions handled"),
  })
  .meta({ ref: "LspServerInfo" })

export const GhCliInfoSchema = z
  .object({
    installed: z.boolean().describe("Whether GitHub CLI is installed"),
    authenticated: z.boolean().describe("Whether GitHub CLI is authenticated"),
    username: z.string().nullable().describe("GitHub username if authenticated"),
  })
  .meta({ ref: "GhCliInfo" })

export const ToolsSummarySchema = z
  .object({
    lspServers: z.array(LspServerInfoSchema).describe("Detected LSP servers"),
    astGrepCli: z.boolean().describe("AST-Grep CLI availability"),
    astGrepNapi: z.boolean().describe("AST-Grep NAPI availability"),
    commentChecker: z.boolean().describe("Comment checker availability"),
    ghCli: GhCliInfoSchema.describe("GitHub CLI status"),
    mcpBuiltin: z.array(z.string()).describe("Built-in MCP server names"),
    mcpUser: z.array(z.string()).describe("User-configured MCP server names"),
  })
  .meta({ ref: "ToolsSummary" })

export const DoctorSummarySchema = z
  .object({
    total: z.number().describe("Total number of checks run"),
    passed: z.number().describe("Checks that passed"),
    failed: z.number().describe("Checks that failed"),
    warnings: z.number().describe("Checks with warnings"),
    skipped: z.number().describe("Checks that were skipped"),
    duration: z.number().describe("Total execution time in milliseconds"),
  })
  .meta({ ref: "DoctorSummary" })

export const DoctorResultSchema = z
  .object({
    results: z.array(CheckResultSchema).describe("All check results"),
    systemInfo: SystemInfoSchema.describe("System environment information"),
    tools: ToolsSummarySchema.describe("Tool and server availability summary"),
    summary: DoctorSummarySchema.describe("Aggregate check statistics"),
    exitCode: z.number().describe("Process exit code (0 = success)"),
  })
  .meta({ ref: "DoctorResult" })

export type DoctorIssue = z.infer<typeof DoctorIssueSchema>
export type CheckResult = z.infer<typeof CheckResultSchema>
export type SystemInfo = z.infer<typeof SystemInfoSchema>
export type LspServerInfo = z.infer<typeof LspServerInfoSchema>
export type GhCliInfo = z.infer<typeof GhCliInfoSchema>
export type ToolsSummary = z.infer<typeof ToolsSummarySchema>
export type DoctorSummary = z.infer<typeof DoctorSummarySchema>
export type DoctorResult = z.infer<typeof DoctorResultSchema>
