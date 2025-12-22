import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import { getAgentForSession } from "../../features/claude-code-session-state/agent-registry"
import {
  type DocsDelegationConfig,
  DEFAULT_DOCS_DELEGATION_CONFIG,
  DOCS_PATH_PATTERNS,
  ALLOWED_AGENTS,
  EXCEPTED_PATHS,
} from "./types"

export * from "./types"

function isDocsPath(filePath: string, projectRoot: string): boolean {
  let relativePath = filePath
  if (filePath.startsWith(projectRoot)) {
    relativePath = filePath.slice(projectRoot.length)
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.slice(1)
    }
  }

  for (const pattern of DOCS_PATH_PATTERNS) {
    if (pattern.endsWith("/") && relativePath.startsWith(pattern)) {
      return true
    }
    if (pattern.includes("*")) {
      const parts = pattern.split("*")
      if (parts.length === 2) {
        const [prefix, suffix] = parts
        if (relativePath.startsWith(prefix) && relativePath.endsWith(suffix)) {
          return true
        }
      }
    }
    if (relativePath === pattern) {
      return true
    }
    if (relativePath.endsWith(".md") || relativePath.endsWith(".mdx")) {
      const filename = relativePath.split("/").pop() ?? ""
      if (filename === pattern) {
        return true
      }
    }
  }

  return false
}

function isExceptedPath(filePath: string, projectRoot: string): boolean {
  let relativePath = filePath
  if (filePath.startsWith(projectRoot)) {
    relativePath = filePath.slice(projectRoot.length)
    if (relativePath.startsWith("/")) {
      relativePath = relativePath.slice(1)
    }
  }

  for (const exceptedPath of EXCEPTED_PATHS) {
    if (relativePath.startsWith(exceptedPath)) {
      return true
    }
  }

  return false
}

function isAllowedAgent(sessionId: string): boolean {
  const currentAgent = getAgentForSession(sessionId)
  if (!currentAgent || currentAgent === "main") return false
  return ALLOWED_AGENTS.includes(currentAgent)
}

export function createGovernanceDocsDelegationHook(
  ctx: PluginInput,
  config?: Partial<DocsDelegationConfig>
) {
  const finalConfig: DocsDelegationConfig = {
    ...DEFAULT_DOCS_DELEGATION_CONFIG,
    ...config,
  }

  if (!finalConfig.enabled || finalConfig.mode === "disabled") {
    log("Governance docs delegation hook disabled")
    return null
  }

  log("Governance docs delegation hook initialized", { mode: finalConfig.mode })

  return {
    "tool.execute.before": async (
      input: {
        tool: string
        sessionID: string
        callID: string
      },
      output: {
        args: Record<string, unknown>
      }
    ): Promise<void> => {
      if (!["write", "edit"].includes(input.tool)) {
        return
      }

      const filePath = (output.args.filePath || output.args.path) as string | undefined
      if (!filePath) {
        return
      }

      if (!isDocsPath(filePath, ctx.directory)) {
        return
      }

      if (isExceptedPath(filePath, ctx.directory)) {
        return
      }

      if (isAllowedAgent(input.sessionID)) {
        return
      }

      const message = [
        `⚠️ [Governance] Documentation delegation ${finalConfig.mode === "block" ? "BLOCKED" : "WARNING"}`,
        `Tool: ${input.tool}`,
        `Path: ${filePath}`,
        `Documentation changes require delegation to document-writer.`,
        `Use: call_omo_agent(subagent_type="document-writer", run_in_background=false, prompt="...")`,
      ].join("\n")

      log(message)

      if (finalConfig.mode === "block") {
        throw new Error(
          `[Governance] Operation blocked: Documentation changes must be delegated to document-writer.\n` +
            `Path: ${filePath}\n` +
            `Remediation: call_omo_agent(subagent_type="document-writer", run_in_background=false, prompt="Write/update ${filePath}")`
        )
      }
    },
  }
}
