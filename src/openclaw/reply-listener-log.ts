import {
  appendFileSync,
  chmodSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import {
  ensureReplyListenerStateDir,
  REPLY_LISTENER_SECURE_FILE_MODE,
  getReplyListenerLogFilePath,
} from "./reply-listener-paths"

const MAX_REPLY_LISTENER_LOG_SIZE_BYTES = 1024 * 1024

export function writeSecureReplyListenerFile(filePath: string, content: string): void {
  ensureReplyListenerStateDir()
  writeFileSync(filePath, content, { mode: REPLY_LISTENER_SECURE_FILE_MODE })

  try {
    chmodSync(filePath, REPLY_LISTENER_SECURE_FILE_MODE)
  } catch {
  }
}

function rotateReplyListenerLogIfNeeded(logPath: string): void {
  try {
    if (!existsSync(logPath)) return

    const stats = statSync(logPath)
    if (stats.size <= MAX_REPLY_LISTENER_LOG_SIZE_BYTES) return

    const backupPath = `${logPath}.old`
    if (existsSync(backupPath)) {
      unlinkSync(backupPath)
    }
    renameSync(logPath, backupPath)
  } catch {
  }
}

export function logReplyListenerMessage(message: string): void {
  try {
    ensureReplyListenerStateDir()
    const logFilePath = getReplyListenerLogFilePath()
    rotateReplyListenerLogIfNeeded(logFilePath)
    const timestamp = new Date().toISOString()
    appendFileSync(logFilePath, `[${timestamp}] ${message}\n`, {
      mode: REPLY_LISTENER_SECURE_FILE_MODE,
    })
  } catch {
  }
}
