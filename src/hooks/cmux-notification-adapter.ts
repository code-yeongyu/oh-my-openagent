import { spawn } from "bun"
import type { ResolvedMultiplexer } from "../shared/tmux"
import { isConnectionRefusedText } from "../tools/interactive-bash/tmux-path-resolver"

const DEFAULT_NOTIFY_TIMEOUT_MS = 1200

export interface CmuxNotifyCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type CmuxNotifyCommandExecutor = (input: {
  args: string[]
  environment: Record<string, string>
  timeoutMs: number
}) => Promise<CmuxNotifyCommandResult>

export interface CmuxNotificationAdapter {
  canSendViaCmux: () => boolean
  hasDowngraded: () => boolean
  send: (title: string, message: string) => Promise<boolean>
}

function toCommandEnvironment(
  runtime: ResolvedMultiplexer,
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const merged: Record<string, string | undefined> = {
    ...process.env,
    ...environment,
  }

  if (runtime.cmux.socketPath) {
    merged.CMUX_SOCKET_PATH = runtime.cmux.socketPath
  }
  if (runtime.cmux.workspaceId) {
    merged.CMUX_WORKSPACE_ID = runtime.cmux.workspaceId
  }
  if (runtime.cmux.surfaceId) {
    merged.CMUX_SURFACE_ID = runtime.cmux.surfaceId
  }

  const commandEnvironment: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === "string") {
      commandEnvironment[key] = value
    }
  }

  return commandEnvironment
}

async function runCmuxNotifyCommand(input: {
  args: string[]
  environment: Record<string, string>
  timeoutMs: number
}): Promise<CmuxNotifyCommandResult> {
  const proc = spawn(input.args, {
    stdout: "pipe",
    stderr: "pipe",
    env: input.environment,
  })

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const timedOut = await Promise.race([
    proc.exited.then(() => false).catch(() => false),
    new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // ignore
        }
        resolve(true)
      }, input.timeoutMs)
    }),
  ])

  if (timeoutHandle) {
    clearTimeout(timeoutHandle)
  }

  const exitCode = timedOut ? null : await proc.exited.catch(() => null)
  const stdout = await new Response(proc.stdout).text().catch(() => "")
  const stderr = await new Response(proc.stderr).text().catch(() => "")

  return {
    exitCode,
    stdout,
    stderr,
    timedOut,
  }
}

function buildCmuxNotifyArgs(runtime: ResolvedMultiplexer, title: string, message: string): string[] {
  const cmuxPath = runtime.cmux.path ?? "cmux"
  const args: string[] = [cmuxPath, "notify", "--title", title, "--body", message]

  if (runtime.cmux.workspaceId) {
    args.push("--workspace", runtime.cmux.workspaceId)
  }

  if (runtime.cmux.surfaceId) {
    args.push("--surface", runtime.cmux.surfaceId)
  }

  return args
}

function shouldDowngrade(result: CmuxNotifyCommandResult): boolean {
  if (result.timedOut) {
    return true
  }

  if (result.exitCode === 0) {
    return false
  }

  const combinedOutput = `${result.stderr}\n${result.stdout}`
  if (isConnectionRefusedText(combinedOutput)) {
    return true
  }

  return true
}

export function createCmuxNotificationAdapter(args: {
  runtime: ResolvedMultiplexer
  environment?: Record<string, string | undefined>
  timeoutMs?: number
  executeCommand?: CmuxNotifyCommandExecutor
}): CmuxNotificationAdapter {
  const {
    runtime,
    environment = process.env,
    timeoutMs = DEFAULT_NOTIFY_TIMEOUT_MS,
    executeCommand = runCmuxNotifyCommand,
  } = args

  let downgradedToDesktop = false

  const canSendViaCmux = (): boolean => {
    if (downgradedToDesktop) return false
    if (runtime.notificationBackend !== "cmux") return false
    if (!runtime.cmux.path) return false
    if (!runtime.cmux.socketPath) return false
    if (!runtime.cmux.reachable) return false
    if (!runtime.cmux.notifyCapable) return false
    return true
  }

  const hasDowngraded = (): boolean => downgradedToDesktop

  const send = async (title: string, message: string): Promise<boolean> => {
    if (!canSendViaCmux()) {
      return false
    }

    const commandEnvironment = toCommandEnvironment(runtime, environment)
    const commandResult = await executeCommand({
      args: buildCmuxNotifyArgs(runtime, title, message),
      environment: commandEnvironment,
      timeoutMs,
    }).catch(() => {
      downgradedToDesktop = true
      return null
    })

    if (!commandResult) {
      return false
    }

    if (shouldDowngrade(commandResult)) {
      downgradedToDesktop = true
      return false
    }

    return true
  }

  return {
    canSendViaCmux,
    hasDowngraded,
    send,
  }
}
