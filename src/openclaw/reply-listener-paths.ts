import { existsSync, mkdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export const REPLY_LISTENER_SECURE_FILE_MODE = 0o600

function resolveReplyListenerHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir()
}

export function getReplyListenerStateDir(): string {
  return join(resolveReplyListenerHomeDir(), ".omx", "state")
}

export function getReplyListenerPidFilePath(): string {
  return join(getReplyListenerStateDir(), "reply-listener.pid")
}

export function getReplyListenerStateFilePath(): string {
  return join(getReplyListenerStateDir(), "reply-listener-state.json")
}

export function getReplyListenerConfigFilePath(): string {
  return join(getReplyListenerStateDir(), "reply-listener-config.json")
}

export function getReplyListenerLogFilePath(): string {
  return join(getReplyListenerStateDir(), "reply-listener.log")
}

export function ensureReplyListenerStateDir(): void {
  const stateDir = getReplyListenerStateDir()
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  }
}
