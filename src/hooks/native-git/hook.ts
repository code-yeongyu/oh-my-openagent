import type { PluginInput } from "@opencode-ai/plugin"
import type { NativeGitConfig } from "../../config"
import {
  appendNativeGitAuditRecord,
  getNativeGitChangeSummary,
  getNativeGitStatus,
} from "../../shared/git-worktree"
import { log } from "../../shared/logger"

const TRACKED_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "hashline_edit", "bash", "task"])

type NativeGitToolInput = {
  tool: string
  sessionID?: string
  callID?: string
}

type NativeGitEventInput = {
  event: {
    type: string
    properties?: unknown
  }
}

type NativeGitTrackResult = {
  dirty: boolean
  changedSinceLastCheck: boolean
  summary?: string
}

export const NATIVE_GIT_TASK_REMINDER = `
<system-reminder>
Native Git tracking detected uncommitted changes. Before final completion, use git-master to create atomic commits, for example:
task(category="quick", load_skills=["git-master"], prompt="Commit the current changes atomically following git-master conventions.")
</system-reminder>`

function getStatusKey(files: string[]): string {
  return files.slice().sort().join("\0")
}

function appendOutput(output: { output?: string }, text: string): void {
  output.output = `${output.output ?? ""}${text}`
}

function buildTrackingMessage(summary: string): string {
  return `
<system-reminder>
Native Git tracking detected uncommitted changes.

${summary.trim()}
</system-reminder>`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getStringProperty(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }
  return undefined
}

function getNativeGitToolInputFromEvent(input: NativeGitEventInput): NativeGitToolInput | null {
  if (!isRecord(input.event.properties)) {
    return null
  }

  if (input.event.type === "tool.execute" || input.event.type === "tool.result") {
    const tool = getStringProperty(input.event.properties, ["name", "tool"])
    if (!tool) {
      return null
    }

    return {
      tool,
      sessionID: getStringProperty(input.event.properties, ["sessionID", "sessionId"]),
      callID: getStringProperty(input.event.properties, ["callID", "callId", "call_id"]),
    }
  }

  if (input.event.type !== "message.part.updated") {
    return null
  }

  const part = input.event.properties.part
  if (!isRecord(part) || getStringProperty(part, ["type"]) !== "tool") {
    return null
  }

  const state = isRecord(part.state) ? part.state : undefined
  const status = state ? getStringProperty(state, ["status"]) : undefined
  if (status !== "completed") {
    return null
  }

  const tool = getStringProperty(part, ["tool", "name"])
  if (!tool) {
    return null
  }

  return {
    tool,
    sessionID:
      getStringProperty(part, ["sessionID", "sessionId"]) ??
      getStringProperty(input.event.properties, ["sessionID", "sessionId"]),
    callID: getStringProperty(part, ["callID", "callId", "call_id"]),
  }
}

export function createNativeGitHook(ctx: PluginInput, config: NativeGitConfig | undefined) {
  const mode = config?.mode ?? "tracked"
  const auditLog = config?.audit_log ?? true
  const lastStatusBySessionRepo = new Map<string, string>()

  function trackNativeGitChanges(input: NativeGitToolInput): NativeGitTrackResult {
    const tool = input.tool.toLowerCase()
    if (mode === "manual" || !TRACKED_TOOLS.has(tool)) {
      return { dirty: false, changedSinceLastCheck: false }
    }

    const status = getNativeGitStatus(ctx.directory)
    if (!status) {
      return { dirty: false, changedSinceLastCheck: false }
    }

    const sessionID = input.sessionID ?? "unknown"
    const stateKey = `${sessionID}:${status.repository.repoRoot}`
    if (!status.dirty) {
      lastStatusBySessionRepo.set(stateKey, "")
      return { dirty: false, changedSinceLastCheck: false }
    }

    const statusKey = getStatusKey(status.files)
    const changedSinceLastCheck = lastStatusBySessionRepo.get(stateKey) !== statusKey
    lastStatusBySessionRepo.set(stateKey, statusKey)

    const summary = getNativeGitChangeSummary(ctx.directory)
    if (changedSinceLastCheck) {
      if (auditLog) {
        appendNativeGitAuditRecord(status.repository, {
          tool,
          sessionID: input.sessionID,
          callID: input.callID,
          files: status.files,
          summary,
        })
      }

      log("[native-git] tracked uncommitted changes", {
        tool,
        sessionID: input.sessionID,
        fileCount: status.files.length,
      })
    }

    return { dirty: true, changedSinceLastCheck, summary }
  }

  return {
    event: async (input: NativeGitEventInput): Promise<void> => {
      if (mode === "manual") {
        return
      }

      const toolInput = getNativeGitToolInputFromEvent(input)
      if (!toolInput) {
        return
      }

      trackNativeGitChanges(toolInput)
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { output?: string; metadata?: Record<string, unknown> } | undefined,
    ): Promise<void> => {
      if (!output || mode === "manual") {
        return
      }

      const tool = input.tool.toLowerCase()
      if (!TRACKED_TOOLS.has(tool)) {
        return
      }

      const result = trackNativeGitChanges(input)
      if (result.changedSinceLastCheck && result.summary) {
        if (tool !== "task") {
          appendOutput(output, buildTrackingMessage(result.summary))
        }
      }

      if (tool === "task" && result.dirty) {
        appendOutput(output, NATIVE_GIT_TASK_REMINDER)
      }
    },
  }
}
