import type { Hooks } from "@opencode-ai/plugin"

import { log } from "../../shared"

import type { OhMyOpenCodeConfig } from "../../config"

import { writeAuditEntry } from "./audit"
import { resolveToolPermission } from "./resolve"
import {
  createSessionPermissionCache,
  type SessionPermissionCache,
  sharedSessionPermissionCache,
} from "./session-cache"

export type PermissionGateDeps = {
  pluginConfig: OhMyOpenCodeConfig
  cache?: SessionPermissionCache
}

function buildTargetPath(args: unknown, tool: string): string | undefined {
  if (!args || typeof args !== "object") return undefined
  const record = args as Record<string, unknown>
  if (tool === "bash") {
    const command = record["command"]
    return typeof command === "string" ? command : undefined
  }
  const filePath = record["filePath"] ?? record["path"] ?? record["file_path"]
  return typeof filePath === "string" ? filePath : undefined
}

function syntheticDenyMessage(tool: string): string {
  return `Permission denied for tool '${tool}' by the per-tool permission profile. Edit your permission schema (docs/security/permissions.md) to permit this call.`
}

export function createPermissionGateHook(deps: PermissionGateDeps): Hooks {
  const cache = deps.cache ?? sharedSessionPermissionCache()
  const sessionOverrideMap = (deps.pluginConfig.tools?.session_overrides ?? {}) as Record<
    string,
    "allow" | "ask" | "deny"
  >

  for (const [key, value] of Object.entries(sessionOverrideMap)) {
    const [sessionID, tool, ...rest] = key.split("\u0000")
    const targetPath = rest.length > 0 ? rest.join("\u0000") : ""
    if (!sessionID || !tool) continue
    cache.setUserOverride({
      sessionID,
      tool,
      targetPath: targetPath || undefined,
      value,
    })
  }

  return {
    "tool.execute.before": async (
      input: { tool?: string; sessionID?: string; callID?: string },
      output: { args?: unknown },
    ): Promise<void> => {
      if (!input.tool) return
      const sessionID = input.sessionID ?? "default"
      const targetPath = buildTargetPath(output?.args, normalizeTool(input.tool))
      const decision = resolveToolPermission({
        pluginConfig: deps.pluginConfig,
        tool: input.tool,
        targetPath,
        sessionID,
        cache,
      })

      // Always write an audit line for non-default-allow decisions so the
      // reviewer can see what the gate did without scanning the gate source.
      if (decision.source !== "default" || decision.value !== "allow") {
        writeAuditEntry(decision)
      }

      if (decision.value === "deny") {
        log("[permission-gate] deny", { tool: decision.tool, sessionID, callID: input.callID })
        throw new Error(syntheticDenyMessage(decision.tool))
      }

      if (decision.value === "ask") {
        // Record the ask decision so the next call for this
        // (session, tool, target-path) resolves to allow without another
        // decision. The gate does not block in this version; a follow-up adds
        // the in-band confirmation.
        cache.recordAskDecision({
          sessionID,
          tool: decision.tool,
          targetPath: decision.targetPath,
        })
        log("[permission-gate] ask (cached)", {
          tool: decision.tool,
          sessionID,
          callID: input.callID,
        })
      }

      // `allow` is a no-op once the audit is logged above.
    },
  }
}

function normalizeTool(tool: string): string {
  return tool.toLowerCase().replace(/^mcp_/, "")
}

export { resolveToolPermission, writeAuditEntry, createSessionPermissionCache }
