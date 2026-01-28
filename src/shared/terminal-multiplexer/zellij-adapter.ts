import { spawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import { log } from "../logger"

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

  constructor(config: ZellijAdapterConfig) {
    this.config = config
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
    const wrappedCmd = `echo $ZELLIJ_PANE_ID > ${idFile}; exec ${cmd}`
    const cmdArgs = ["bash", "-c", wrappedCmd]

    const zellijCmd = isFirstPane
      ? ["zellij", "action", "new-pane", "-d", direction, "-n", label, "--", ...cmdArgs]
      : ["zellij", "action", "new-pane", "-n", label, "--", ...cmdArgs]

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

    // Read pane ID from temp file
    const idProc = spawn(["cat", idFile], { stdout: "pipe" })
    await idProc.exited
    const paneId = (await new Response(idProc.stdout).text()).trim()

    // Clean up temp file
    spawn(["rm", idFile], { stdout: "pipe" })

    // Track anchor or stack with anchor
    if (isFirstPane) {
      this.anchorPaneId = paneId
      log("[ZellijAdapter.spawnPane] set anchor pane", { paneId })
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

    return {
      label,
    }
  }

  async closePane(handle: PaneHandle): Promise<void> {
    this.labelToSpawned.delete(handle.label)
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
