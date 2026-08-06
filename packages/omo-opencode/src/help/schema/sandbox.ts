import { z } from "zod"

/**
 * Help JSON schema for the `sandbox` surface.
 * Defines the structure of sandboxed execution environment output.
 */
export const SandboxConfigSchema = z
  .object({
    enabled: z.boolean().describe("Whether sandbox is enabled"),
    timeout: z.number().describe("Default execution timeout in seconds"),
    memory: z.string().nullable().optional().describe("Memory limit (e.g., '512MB')"),
    network: z.boolean().describe("Whether network access is allowed"),
    filesystem: z.object({
      read: z.array(z.string()).describe("Readable paths"),
      write: z.array(z.string()).describe("Writable paths"),
      tempDir: z.string().describe("Sandbox temporary directory"),
    }).describe("Filesystem access rules"),
  })
  .meta({ ref: "SandboxConfig" })

export const SandboxExecutionSchema = z
  .object({
    id: z.string().describe("Execution ID"),
    command: z.string().describe("Command that was executed"),
    exitCode: z.number().describe("Process exit code"),
    stdout: z.string().describe("Standard output"),
    stderr: z.string().describe("Standard error"),
    duration: z.number().describe("Execution duration in ms"),
    sandboxed: z.boolean().describe("Whether execution was sandboxed"),
  })
  .meta({ ref: "SandboxExecution" })

export const SandboxStatusSchema = z
  .object({
    active: z.boolean().describe("Whether the sandbox runtime is active"),
    uptime: z.number().describe("Runtime uptime in seconds"),
    executionsTotal: z.number().describe("Total executions since start"),
    executionsActive: z.number().describe("Currently active executions"),
    config: SandboxConfigSchema.describe("Sandbox configuration"),
  })
  .meta({ ref: "SandboxStatus" })

export const SandboxResultSchema = z
  .object({
    status: SandboxStatusSchema.describe("Sandbox runtime status"),
    recentExecutions: z.array(SandboxExecutionSchema).optional().describe("Recent execution records"),
  })
  .meta({ ref: "SandboxResult" })

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>
export type SandboxExecution = z.infer<typeof SandboxExecutionSchema>
export type SandboxStatus = z.infer<typeof SandboxStatusSchema>
export type SandboxResult = z.infer<typeof SandboxResultSchema>
