import type { PluginInput } from "@opencode-ai/plugin"

import { log } from "../../shared"
import { isGitCommitOrPush, isGitPush } from "./git-command-detector"
import { runGitleaksStagedScan, runGitleaksPrePushScan } from "./gitleaks-runner"
import { formatFindings, extractRemoteBranch } from "./result-formatter"

export interface SecretLeakGuardOptions {
  enabled?: boolean
  tool?: "gitleaks"
  block_on_detection?: boolean
  allowlist_paths?: string[]
}

export function createSecretLeakGuardHook(ctx: PluginInput, config?: SecretLeakGuardOptions) {
  const enabled = config?.enabled ?? true
  const blockOnDetection = config?.block_on_detection ?? true

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      if (!enabled) return
      if (input.tool.toLowerCase() !== "bash") return

      const command = output.args.command as string | undefined
      if (!command) return

      if (!isGitCommitOrPush(command)) return

      log("[secret-leak-guard] Intercepted git operation, scanning for secrets", {
        sessionID: input.sessionID,
        isGitPush: isGitPush(command),
      })

      const cwd = (output.args.workdir as string) ?? ctx.directory
      const result = isGitPush(command)
        ? await runGitleaksPrePushScan(cwd, extractRemoteBranch(command))
        : await runGitleaksStagedScan(cwd)

      if (!result.available) return

      if (result.findings.length > 0) {
        const report = formatFindings(result.findings)
        log("[secret-leak-guard] BLOCKED — secrets detected in staged changes", {
          sessionID: input.sessionID,
          findingCount: result.findings.length,
        })

        if (blockOnDetection) {
          throw new Error(
            `🔒 SECRET LEAK DETECTED — git operation blocked.\n\n` +
            `Found ${result.findings.length} potential secret(s):\n${report}\n\n` +
            `Remove the secrets before committing. ` +
            `Use environment variables or a secrets manager instead of hardcoding credentials.`
          )
        }
      }
    },
  }
}
