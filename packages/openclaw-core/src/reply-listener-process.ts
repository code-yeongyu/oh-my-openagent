import { readFileSync } from "node:fs"
import { spawn } from "@oh-my-opencode/utils/runtime"

export const REPLY_LISTENER_DAEMON_IDENTITY_MARKER = "--openclaw-reply-listener-daemon"

const REPLY_LISTENER_DAEMON_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMUX",
  "TMUX_PANE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_RUNTIME_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "SHELL",
  "NODE_ENV",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "COMSPEC",
] as const

function ignoreReplyListenerProcessProbeError(error: unknown): void {
  if (error instanceof Error) return
  throw error
}

type ProcessProbe = {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

type ReplyListenerProcessDeps = {
  readonly spawn: (
    command: string[],
    options: { readonly stdout: "pipe"; readonly stderr: "ignore" },
  ) => ProcessProbe
  readonly platform?: typeof process.platform
  readonly readProcCmdline?: (pid: number) => string
}

export function createReplyListenerDaemonEnv(extraEnv: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}

  for (const key of REPLY_LISTENER_DAEMON_ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }

  return { ...env, ...extraEnv }
}

export function isReplyListenerProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    ignoreReplyListenerProcessProbeError(error)
    return false
  }
}

export async function isReplyListenerDaemonProcess(pid: number): Promise<boolean> {
  return isReplyListenerDaemonProcessWithDeps(pid, { spawn })
}

export async function isReplyListenerDaemonProcessWithDeps(
  pid: number,
  deps: ReplyListenerProcessDeps,
): Promise<boolean> {
  try {
    const platform = deps.platform ?? process.platform
    if (platform === "linux") {
      const readProcCmdline =
        deps.readProcCmdline ??
        ((targetPid) => readFileSync(`/proc/${targetPid}/cmdline`, "utf-8"))
      const cmdline = readProcCmdline(pid)
      return cmdline.includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
    }

    const processInfo = deps.spawn(["ps", "-p", String(pid), "-o", "args="], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const stdout = await new Response(processInfo.stdout).text()
    await processInfo.exited
    if (processInfo.exitCode !== 0) return false
    return stdout.includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
  } catch (error) {
    ignoreReplyListenerProcessProbeError(error)
    return false
  }
}
