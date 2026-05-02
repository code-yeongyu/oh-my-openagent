import type { PluginInput } from "@opencode-ai/plugin"
import type { NativeGitConfig } from "../../config"
import {
  appendNativeGitAuditRecord,
  getNativeGitChangeSummary,
  getNativeGitStatus,
} from "../../shared/git-worktree"
import { log } from "../../shared/logger"

const TRACKED_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "hashline_edit", "bash", "task"])

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

export function createNativeGitHook(ctx: PluginInput, config: NativeGitConfig | undefined) {
  const mode = config?.mode ?? "tracked"
  const auditLog = config?.audit_log ?? true
  const lastStatusBySessionRepo = new Map<string, string>()

  return {
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

      const status = getNativeGitStatus(ctx.directory)
      if (!status) {
        return
      }

      const stateKey = `${input.sessionID}:${status.repository.repoRoot}`
      if (!status.dirty) {
        lastStatusBySessionRepo.set(stateKey, "")
        return
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

        if (tool !== "task") {
          appendOutput(output, buildTrackingMessage(summary))
        }

        log("[native-git] tracked uncommitted changes", {
          tool,
          sessionID: input.sessionID,
          fileCount: status.files.length,
        })
      }

      if (tool === "task") {
        appendOutput(output, NATIVE_GIT_TASK_REMINDER)
      }
    },
  }
}
