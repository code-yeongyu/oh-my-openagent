import { spawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import { log } from "../logger"
import { loadZellijState, saveZellijState } from "./zellij-storage"

export interface ZellijAdapterConfig {
  enabled: boolean
  sessionPrefix?: string
}

export class ZellijAdapter implements Multiplexer {
  type = "zellij" as const
  capabilities: MultiplexerCapabilities = {
    manualLayout: false,
    persistentLabels: true,
  }

  private labelToSpawned = new Map<string, boolean>()
  private hasCreatedFirstPane = false
  private anchorPaneId: string | null = null
  private config: ZellijAdapterConfig
  private sessionID: string | null = null

  constructor(config: ZellijAdapterConfig) {
    this.config = config
  }

  async setSessionID(sessionID: string): Promise<void> {
    this.sessionID = sessionID
    const loaded = loadZellijState(sessionID)
    if (loaded) {
      this.anchorPaneId = loaded.anchorPaneId
      this.hasCreatedFirstPane = loaded.hasCreatedFirstPane
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
    }
  }

  private async validateAnchorPane(): Promise<boolean> {
    return this.anchorPaneId !== null
  }

  async ensureSession(name: string): Promise<void> {
    const proc = spawn(["zellij", "attach", "-b", "-c", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async killSession(name: string): Promise<void> {
    const proc = spawn(["zellij", "delete-session", "-f", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle> {
    const { label, direction = "right" } = options
    
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
    }

    // Wrap command to capture pane ID
    const idFile = `/tmp/opencode-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const wrappedCmd = `echo \\$ZELLIJ_PANE_ID > ${idFile}; exec ${cmd}`
    const cmdArgs = ["bash", "-c", wrappedCmd]

    const zellijCmd = isFirstPane
      ? ["zellij", "action", "new-pane", "-d", direction, "-n", label, "--close-on-exit", "--", ...cmdArgs]
      : ["zellij", "action", "new-pane", "-n", label, "--close-on-exit", "--", ...cmdArgs]

    const proc = spawn(zellijCmd, {
      stdout: "pipe",
      stderr: "pipe",
    })

    // Log spawn command with isFirstPane flag
    log("[ZellijAdapter.spawnPane] spawning pane", {
      label,
      direction,
      isFirstPane,
      command: cmd,
      fullCommand: zellijCmd.join(" "),
    })

    await proc.exited

    // Wait for pane to start and write its ID (with timeout)
    let paneId = ""
    const maxAttempts = 10  // 1 second total (100ms per attempt)
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const idProc = spawn(["cat", idFile], { stdout: "pipe", stderr: "pipe" })
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

    // Clean up temp file
    spawn(["rm", idFile], { stdout: "pipe" })

    // Track anchor or stack with anchor
    if (isFirstPane) {
      this.anchorPaneId = paneId
      log("[ZellijAdapter.spawnPane] set anchor pane", { paneId })
      
      // Save state after setting anchor pane
      if (this.sessionID) {
        saveZellijState({
          sessionID: this.sessionID,
          anchorPaneId: this.anchorPaneId,
          hasCreatedFirstPane: this.hasCreatedFirstPane,
          updatedAt: Date.now(),
        })
      }
    } else if (this.anchorPaneId) {
      // Stack with anchor
      const stackProc = spawn(["zellij", "action", "stack-panes", "--", this.anchorPaneId, paneId], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await stackProc.exited
      log("[ZellijAdapter.spawnPane] stacked with anchor", { anchorPaneId: this.anchorPaneId, newPaneId: paneId })
    }

    this.labelToSpawned.set(label, true)

    // Save state after any changes to hasCreatedFirstPane
    if (this.sessionID && isFirstPane) {
      saveZellijState({
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
      const match = handle.label.match(/ses_[a-zA-Z0-9]+/)
      if (match) {
        const sessionId = match[0]
        log("[ZellijAdapter.closePane] extracted sessionId", { sessionId, label: handle.label })
        
        // Kill the opencode attach process for this session
         // This will trigger --close-on-exit to close the pane
         // Using -9 (SIGKILL) for immediate termination since process may ignore SIGTERM
         const proc = spawn(["pkill", "-9", "-f", `opencode attach.*${sessionId}`], {
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
    const proc = spawn(["zellij", "list-sessions", "-n"], {
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
