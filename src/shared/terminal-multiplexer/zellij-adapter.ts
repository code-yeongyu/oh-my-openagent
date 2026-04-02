import { spawn as bunSpawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import { log } from "../logger"
import { defaultZellijStorage, type ZellijStorage } from "./zellij-storage"

type SpawnFn = typeof bunSpawn

export interface ZellijAdapterConfig {
  enabled: boolean
}

export class ZellijAdapter implements Multiplexer {
  type = "zellij" as const
  capabilities: MultiplexerCapabilities = {
    manualLayout: false,
    persistentLabels: true,
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  private labelToSpawned = new Map<string, boolean>()
  private hasCreatedFirstPane = false
  private anchorPaneId: string | null = null
  private anchorReadyPromise: Promise<string | null> | null = null
  private anchorReadyResolver: ((paneId: string | null) => void) | null = null
  private config: ZellijAdapterConfig
  private sessionID: string | null = null
  private storage: ZellijStorage
  private spawn: SpawnFn

  constructor(config: ZellijAdapterConfig, storage: ZellijStorage = defaultZellijStorage, spawnFn: SpawnFn = bunSpawn) {
    this.config = config
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
      this.labelToSpawned.clear()
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
      this.labelToSpawned.clear()
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

  async spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle> {
    const { label, displayName, direction = "vertical" } = options
    const zellijDirection = direction === "horizontal" ? "right" : "down"
    const paneName = displayName ?? label
    
    // Check if this is the first pane BEFORE any async operations
    const isFirstPane = !this.hasCreatedFirstPane
    
    // Log pre-spawn state to track race condition prevention
    log("[ZellijAdapter.spawnPane] pre-spawn state", {
      hasCreatedFirstPane: this.hasCreatedFirstPane,
      isFirstPane,
      labelToSpawnedSize: this.labelToSpawned.size,
      label,
    })
    
    // Mark first pane as created BEFORE spawning to prevent race condition
    if (isFirstPane) {
      this.hasCreatedFirstPane = true
      this.anchorReadyPromise = new Promise(resolve => {
        this.anchorReadyResolver = resolve
      })
    }

    // Wrap command to capture pane ID
    const idFile = `/tmp/opencode-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const wrappedCmd = `echo $ZELLIJ_PANE_ID > ${idFile}; exec ${cmd}`
    const cmdArgs = ["bash", "-c", wrappedCmd]

    const zellijCmd = isFirstPane
      ? ["zellij", "action", "new-pane", "-d", zellijDirection, "-n", paneName, "--close-on-exit", "--", ...cmdArgs]
      : ["zellij", "action", "new-pane", "-d", "down", "-n", paneName, "--close-on-exit", "--", ...cmdArgs]

    let paneId = ""
    try {
      const proc = this.spawn(zellijCmd, {
        stdout: "pipe",
        stderr: "pipe",
      })

      log("[ZellijAdapter.spawnPane] spawning pane", {
        label,
        direction,
        isFirstPane,
        command: cmd,
        fullCommand: zellijCmd.join(" "),
      })

      await proc.exited

      const maxAttempts = 10
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const idProc = this.spawn(["cat", idFile], { stdout: "pipe", stderr: "pipe" })
          await idProc.exited
          const content = (await new Response(idProc.stdout).text()).trim()
          if (content) {
            paneId = content
            break
          }
        } catch {
          // File doesn't exist yet
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (!paneId) {
        log("[ZellijAdapter.spawnPane] WARNING: Could not read pane ID", { idFile })
      }

      this.spawn(["rm", idFile], { stdout: "pipe" })

      if (isFirstPane) {
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
          log("[ZellijAdapter.spawnPane] WARNING: anchor pane ID not captured, releasing anchorReadyPromise")
          this.anchorReadyResolver?.(null)
          this.anchorReadyResolver = null
          this.anchorReadyPromise = null
          this.hasCreatedFirstPane = false
        }
      } else if (this.anchorReadyPromise) {
        const anchorId = await this.anchorReadyPromise
        if (anchorId && paneId) {
          const stackProc = this.spawn(["zellij", "action", "stack-panes", "--", anchorId, paneId], {
            stdout: "pipe",
            stderr: "pipe",
          })
          await stackProc.exited
          log("[ZellijAdapter.spawnPane] stacked with anchor", { anchorPaneId: anchorId, newPaneId: paneId })
        } else {
          log("[ZellijAdapter.spawnPane] skipping stack: anchor or pane ID unavailable", { label, anchorId: anchorId ?? null, paneId })
        }
      } else if (this.anchorPaneId && paneId) {
        const stackProc = this.spawn(["zellij", "action", "stack-panes", "--", this.anchorPaneId, paneId], {
          stdout: "pipe",
          stderr: "pipe",
        })
        await stackProc.exited
        log("[ZellijAdapter.spawnPane] stacked with restored anchor", { anchorPaneId: this.anchorPaneId, newPaneId: paneId })
      }
    } catch (error) {
      if (isFirstPane) {
        log("[ZellijAdapter.spawnPane] first-pane spawn failed, releasing anchorReadyPromise", { label, error })
        this.anchorReadyResolver?.(null)
        this.anchorReadyResolver = null
        this.anchorReadyPromise = null
        this.hasCreatedFirstPane = false
      }
      throw error
    }

    this.labelToSpawned.set(label, true)

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
    }
  }

   async closePane(handle: PaneHandle): Promise<void> {
      log("[ZellijAdapter.closePane] called", { label: handle.label })
      
      // Extract session ID from label (format: "omo-subagent-ses_XXXXX")
      const match = handle.label.match(/ses_[a-zA-Z0-9_-]+/)
      if (match) {
        const sessionId = match[0]
        log("[ZellijAdapter.closePane] extracted sessionId", { sessionId, label: handle.label })
        
        // Kill the opencode attach process for this session
         // This will trigger --close-on-exit to close the pane
         // Using -9 (SIGKILL) for immediate termination since process may ignore SIGTERM
         const proc = this.spawn(["pkill", "-9", "-f", "--", `--session ${sessionId}( |$)`], {
           stdout: "pipe",
           stderr: "pipe",
         })
        const exitCode = await proc.exited
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        
        log("[ZellijAdapter.closePane] pkill result", { 
          exitCode, 
          stdout: stdout.trim(), 
          stderr: stderr.trim(),
          sessionId 
        })
      } else {
        log("[ZellijAdapter.closePane] no session ID found in label", { label: handle.label })
      }
      
      this.labelToSpawned.delete(handle.label)
      log("[ZellijAdapter.closePane] completed", { label: handle.label })
    }

  async getPanes(): Promise<PaneHandle[]> {
    const proc = this.spawn(["zellij", "list-sessions", "-n"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()

    if (exitCode !== 0) {
      return []
    }

    const panes: PaneHandle[] = []
    const lines = stdout.trim().split("\n").filter(Boolean)

    for (const line of lines) {
      const sessionName = line.trim()
      if (sessionName) {
        panes.push({
          label: sessionName,
        })
      }
    }

    return panes
  }
}
