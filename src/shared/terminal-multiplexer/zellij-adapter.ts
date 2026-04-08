import { spawn as bunSpawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import { log } from "../logger"
import { defaultZellijStorage, type ZellijStorage } from "./zellij-storage"

type SpawnFn = typeof bunSpawn

export class ZellijAdapter implements Multiplexer {
  type = "zellij" as const
  capabilities: MultiplexerCapabilities = {
    manualLayout: false,
    persistentLabels: true,
  }

  private spawnedPanes = new Map<string, string | undefined>()
  private hasCreatedFirstPane = false
  private anchorPaneId: string | null = null
  private anchorReadyPromise: Promise<string | null> | null = null
  private anchorReadyResolver: ((paneId: string | null) => void) | null = null
  private sessionID: string | null = null
  private storage: ZellijStorage
  private spawn: SpawnFn
  private pendingSpawns = 0

  constructor(storage: ZellijStorage = defaultZellijStorage, spawnFn: SpawnFn = bunSpawn) {
    this.storage = storage
    this.spawn = spawnFn
  }

  async setSessionID(sessionID: string): Promise<void> {
    this.sessionID = sessionID
    const loaded = this.storage.loadZellijState(sessionID)
    if (loaded) {
      this.anchorPaneId = loaded.anchorPaneId
      this.hasCreatedFirstPane = loaded.hasCreatedFirstPane
      this.anchorReadyPromise = null
      this.anchorReadyResolver = null
      this.spawnedPanes.clear()
      log("[ZellijAdapter.setSessionID] loaded persisted state", {
        sessionID,
        anchorPaneId: this.anchorPaneId,
        hasCreatedFirstPane: this.hasCreatedFirstPane,
      })

      const valid = await this.validateAnchorPane()
      if (!valid) {
        this.anchorPaneId = null
        this.hasCreatedFirstPane = false
        log("[ZellijAdapter] Anchor pane invalid, reset state")
      }
    } else {
      this.anchorPaneId = null
      this.hasCreatedFirstPane = false
      this.anchorReadyPromise = null
      this.anchorReadyResolver = null
      this.spawnedPanes.clear()
      log("[ZellijAdapter.setSessionID] no persisted state, cleared in-memory state", { sessionID })
    }
  }

  private async validateAnchorPane(): Promise<boolean> {
    if (this.anchorPaneId === null) {
      return false
    }

    try {
      const proc = this.spawn(["zellij", "action", "list-panes"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      const output = (await new Response(proc.stdout).text()).trim()

      // Pane IDs appear as terminal_N in list-panes output; use word boundary to avoid substring matches (e.g. terminal_1 matching terminal_10)
      const pattern = new RegExp(`\\bterminal_${this.anchorPaneId}\\b`)
      const exists = pattern.test(output)
      if (!exists) {
        log("[ZellijAdapter.validateAnchorPane] Anchor pane not found in list-panes", {
          anchorPaneId: this.anchorPaneId,
        })
      }
      return exists
    } catch {
      log("[ZellijAdapter.validateAnchorPane] Failed to list panes, assuming invalid")
      return false
    }
  }

  async ensureSession(name: string): Promise<void> {
    const proc = this.spawn(["zellij", "attach", "-b", "-c", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async killSession(name: string): Promise<void> {
    const proc = this.spawn(["zellij", "delete-session", "-f", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  private buildSpawnCommand(
    cmd: string,
    paneName: string,
    zellijDirection: string,
    isFirstPane: boolean,
  ): { args: string[]; idFile: string } {
    const idFile = `/tmp/opencode-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const wrappedCmd = `echo $ZELLIJ_PANE_ID > ${idFile}; exec ${cmd}`
    const cmdArgs = ["bash", "-c", wrappedCmd]

    const args = isFirstPane
      ? ["zellij", "action", "new-pane", "-d", zellijDirection, "-n", paneName, "--close-on-exit", "--", ...cmdArgs]
      : ["zellij", "action", "new-pane", "-d", "down", "-n", paneName, "--close-on-exit", "--", ...cmdArgs]

    return { args, idFile }
  }

  private async capturePaneId(idFile: string): Promise<string> {
    const maxAttempts = 10
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const idProc = this.spawn(["cat", idFile], { stdout: "pipe", stderr: "pipe" })
        await idProc.exited
        const content = (await new Response(idProc.stdout).text()).trim()
        if (content) {
          this.spawn(["rm", idFile], { stdout: "pipe" })
          return content
        }
      } catch {
        // File doesn't exist yet
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    this.spawn(["rm", idFile], { stdout: "pipe" })
    return ""
  }

  private handleFirstPaneAnchoring(paneId: string): void {
    if (paneId) {
      this.anchorPaneId = paneId
      this.anchorReadyResolver?.(paneId)
      this.anchorReadyResolver = null
      log("[ZellijAdapter.spawnPane] set anchor pane", { paneId })

      if (this.sessionID) {
        this.storage.saveZellijState({
          sessionID: this.sessionID,
          anchorPaneId: this.anchorPaneId,
          hasCreatedFirstPane: this.hasCreatedFirstPane,
          updatedAt: Date.now(),
        })
      }
    } else {
      log("[ZellijAdapter.spawnPane] anchor pane ID not captured, releasing anchorReadyPromise")
      this.anchorReadyResolver?.(null)
      this.anchorReadyResolver = null
      this.anchorReadyPromise = null
    }
  }

  private async stackWithAnchor(paneId: string, label: string): Promise<void> {
    if (!paneId) return

    if (this.anchorReadyPromise) {
      const anchorId = await this.anchorReadyPromise
      if (anchorId) {
        const stackProc = this.spawn(["zellij", "action", "stack-panes", "--", anchorId, paneId], {
          stdout: "pipe",
          stderr: "pipe",
        })
        await stackProc.exited
        log("[ZellijAdapter.spawnPane] stacked with anchor", { anchorPaneId: anchorId, newPaneId: paneId })
      } else {
        log("[ZellijAdapter.spawnPane] skipping stack: anchor ID unavailable", { label, paneId })
      }
    } else if (this.anchorPaneId) {
      const stackProc = this.spawn(["zellij", "action", "stack-panes", "--", this.anchorPaneId, paneId], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await stackProc.exited
      log("[ZellijAdapter.spawnPane] stacked with restored anchor", { anchorPaneId: this.anchorPaneId, newPaneId: paneId })
    }
  }

  async spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle> {
    const { label, displayName, direction = "vertical" } = options
    const zellijDirection = direction === "horizontal" ? "right" : "down"
    const paneName = displayName ?? label

    this.pendingSpawns++
    const isFirstPane = !this.hasCreatedFirstPane

    log("[ZellijAdapter.spawnPane] pre-spawn state", {
      hasCreatedFirstPane: this.hasCreatedFirstPane,
      isFirstPane,
      spawnedPanesSize: this.spawnedPanes.size,
      label,
    })

    if (isFirstPane) {
      this.hasCreatedFirstPane = true
      this.anchorReadyPromise = new Promise(resolve => {
        this.anchorReadyResolver = resolve
      })
    }

    const { args: zellijCmd, idFile } = this.buildSpawnCommand(cmd, paneName, zellijDirection, isFirstPane)

    let paneId = ""
    try {
      const proc = this.spawn(zellijCmd, { stdout: "pipe", stderr: "pipe" })
      log("[ZellijAdapter.spawnPane] spawning pane", {
        label,
        direction,
        isFirstPane,
        command: cmd,
        fullCommand: zellijCmd.join(" "),
      })

      const exitCode = await proc.exited
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        throw new Error(`zellij new-pane failed with exit code ${exitCode}: ${stderr.trim()}`)
      }

      paneId = await this.capturePaneId(idFile)
      if (!paneId) {
        log("[ZellijAdapter.spawnPane] could not read pane ID", { idFile })
      }

      if (isFirstPane) {
        this.handleFirstPaneAnchoring(paneId)
      } else {
        await this.stackWithAnchor(paneId, label)
      }
    } catch (error) {
      if (isFirstPane) {
        log("[ZellijAdapter.spawnPane] first-pane spawn failed, releasing anchorReadyPromise", { label, error })
        this.anchorReadyResolver?.(null)
        this.anchorReadyResolver = null
        this.anchorReadyPromise = null
        this.hasCreatedFirstPane = false
      }
      this.pendingSpawns--
      throw error
    }

    this.spawnedPanes.set(label, paneId || undefined)
    this.pendingSpawns--

    if (this.sessionID && isFirstPane) {
      this.storage.saveZellijState({
        sessionID: this.sessionID,
        anchorPaneId: this.anchorPaneId,
        hasCreatedFirstPane: this.hasCreatedFirstPane,
        updatedAt: Date.now(),
      })
    }

    return {
      label,
      nativeId: paneId || undefined,
    }
  }

  async closePane(handle: PaneHandle): Promise<void> {
    log("[ZellijAdapter.closePane] called", { label: handle.label })

    const sessionId = handle.label
    const escapedSessionId = sessionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // SIGKILL for immediate termination — the pane has --close-on-exit so killing
    // the process is sufficient. SIGTERM would work but pkill's exit code only tells
    // us if a matching process existed (0) or not (1), not whether it actually died,
    // making a SIGTERM→wait→SIGKILL escalation unreliable without polling.
    const proc = this.spawn(["pkill", "-9", "-f", "--", `--session ${escapedSessionId}( |$)`], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited

    this.spawnedPanes.delete(handle.label)

    if (this.spawnedPanes.size === 0 && this.pendingSpawns === 0) {
      this.anchorPaneId = null
      this.hasCreatedFirstPane = false
      log("[ZellijAdapter.closePane] last pane closed, reset anchor state")
    }
  }

  async getPanes(): Promise<PaneHandle[]> {
    const panes: PaneHandle[] = []
    for (const [label, nativeId] of this.spawnedPanes) {
      panes.push({ label, nativeId })
    }
    return panes
  }
}
