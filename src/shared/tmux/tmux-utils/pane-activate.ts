import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../logger"
import { runTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { buildTmuxAttachCommand } from "./pane-command"

const ATTACH_LOCK_ROOT = join(tmpdir(), "oh-my-openagent-tmux-attach-locks")

function getAttachLockPath(sessionId: string): string {
  const lockId = createHash("sha256").update(sessionId).digest("hex")
  return join(ATTACH_LOCK_ROOT, lockId)
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

async function paneExists(tmux: string, paneId: string): Promise<boolean> {
  const result = await runTmuxCommand(tmux, ["display-message", "-p", "-t", paneId, "#{pane_id}"])
  return result.exitCode === 0
}

async function claimAttachSession(tmux: string, paneId: string, sessionId: string): Promise<boolean> {
  const lockPath = getAttachLockPath(sessionId)
  mkdirSync(ATTACH_LOCK_ROOT, { recursive: true })

  try {
    mkdirSync(lockPath)
    writeFileSync(join(lockPath, "pane"), paneId)
    return true
  } catch (error) {
    if (!isFileExistsError(error)) {
      throw error
    }
  }

  const ownerPane = existsSync(join(lockPath, "pane"))
    ? readFileSync(join(lockPath, "pane"), "utf8").trim()
    : ""

  if (ownerPane && await paneExists(tmux, ownerPane)) {
    log("[activateTmuxPane] SKIP: session already attached or attaching", {
      sessionId,
      paneId,
      ownerPane,
    })
    return ownerPane === paneId
  }

  rmSync(lockPath, { recursive: true, force: true })
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, "pane"), paneId)
  return true
}

function releaseAttachSession(sessionId: string): void {
  rmSync(getAttachLockPath(sessionId), { recursive: true, force: true })
}

export async function activateTmuxPane(
  paneId: string,
  sessionId: string,
  serverUrl: string,
  directory: string,
): Promise<boolean> {
  if (!isInsideTmux()) {
    log("[activateTmuxPane] SKIP: not inside tmux", { paneId, sessionId })
    return false
  }

  const tmux = await getTmuxPath()
  if (!tmux) {
    log("[activateTmuxPane] SKIP: tmux not found", { paneId, sessionId })
    return false
  }

  const claimed = await claimAttachSession(tmux, paneId, sessionId)
  if (!claimed) {
    await runTmuxCommand(tmux, ["kill-pane", "-t", paneId])
    return false
  }

  const opencodeCmd = buildTmuxAttachCommand(serverUrl, sessionId, directory)
  const result = await runTmuxCommand(tmux, ["respawn-pane", "-k", "-t", paneId, opencodeCmd])
  if (result.exitCode !== 0) {
    releaseAttachSession(sessionId)
    log("[activateTmuxPane] FAILED", { paneId, sessionId, exitCode: result.exitCode, stderr: result.stderr.trim() })
    return false
  }

  log("[activateTmuxPane] SUCCESS", { paneId, sessionId })
  return true
}
