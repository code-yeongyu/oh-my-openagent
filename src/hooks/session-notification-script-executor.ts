import type { PluginInput } from "@opencode-ai/plugin"
import { homedir } from "os"

interface ScriptExecutionContext {
  hookType: string
  sessionID?: string
  projectDir?: string
  title: string
  message: string
}

export async function executeNotificationScript(
  ctx: PluginInput,
  scriptPath: string,
  context: ScriptExecutionContext
): Promise<void> {
  const resolvedPath = scriptPath.startsWith("~")
    ? scriptPath.replace("~", homedir())
    : scriptPath

  const jsonInput = JSON.stringify({
    type: context.hookType,
    sessionID: context.sessionID,
    projectDir: context.projectDir,
    title: context.title,
    message: context.message,
  })

  const env = {
    ...process.env,
    OPENCODE_PROJECT_DIR: context.projectDir || process.cwd(),
    OPENCODE_SESSION_ID: context.sessionID || "",
  }

  try {
    await ctx.$`echo ${jsonInput} | ${resolvedPath} ${context.hookType}`.env(env).nothrow().quiet()
  } catch (error) {
    console.error(`Failed to execute notification script: ${error}`)
  }
}
