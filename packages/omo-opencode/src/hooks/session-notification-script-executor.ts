import { homedir } from "node:os"
import { resolve } from "node:path"
import { runProcessWithTreeTimeout } from "@oh-my-opencode/utils/process-tree"
import { logOperationFailure } from "./session-notification-log"

export interface NotificationScriptContext {
  scriptPath: string
  hookType: "idle" | "permission" | "question"
  sessionID?: string
  projectDir?: string
}

export async function executeNotificationScript(
  context: NotificationScriptContext,
  title: string,
  message: string,
  timeoutMs = 5_000
): Promise<void> {
  const scriptPath = context.scriptPath === "~"
    ? homedir()
    : context.scriptPath.startsWith("~/")
      ? resolve(homedir(), context.scriptPath.slice(2))
      : context.scriptPath
  const projectDir = context.projectDir || process.cwd()
  const input = JSON.stringify({
    type: context.hookType,
    sessionID: context.sessionID,
    projectDir,
    title,
    message,
  })

  const result = await runProcessWithTreeTimeout({
    args: [context.hookType],
    command: scriptPath,
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENCODE_PROJECT_DIR: projectDir,
      OPENCODE_SESSION_ID: context.sessionID || "",
    },
    maxBuffer: 64 * 1024,
    stdin: input,
    terminationGraceMs: 50,
    terminationWaitMs: 1_000,
    timeoutMs,
  })

  if (result.timedOut) {
    logOperationFailure("custom-script", `timed out after ${timeoutMs}ms`)
  } else if (result.exitCode !== 0) {
    logOperationFailure("custom-script", `exited with code ${result.exitCode}`)
  }
  if (result.termination?.survivorPids.length) {
    logOperationFailure("custom-script", "processes survived termination")
  }
}
