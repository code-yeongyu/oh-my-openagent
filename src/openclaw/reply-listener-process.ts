import { readFileSync } from "fs"
import { spawn } from "bun"

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
  } catch {
    return false
  }
}

export async function isReplyListenerDaemonProcess(pid: number): Promise<boolean> {
  try {
    if (process.platform === "linux") {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8")
      return cmdline.includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
    }

    const processInfo = spawn(["ps", "-p", String(pid), "-o", "args="], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const stdout = await new Response(processInfo.stdout).text()
    if (processInfo.exitCode !== 0) return false
    return stdout.includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
  } catch {
    return false
  }
}
