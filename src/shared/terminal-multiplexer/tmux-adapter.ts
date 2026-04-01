import { spawn as bunSpawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import {
  getCurrentPaneId,
  isInsideTmux,
} from "../tmux/tmux-utils"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../logger"

type SpawnFn = typeof bunSpawn

export interface TmuxAdapterConfig {
  enabled: boolean
  sessionPrefix?: string
}

export class TmuxAdapter implements Multiplexer {
  type = "tmux" as const
  capabilities: MultiplexerCapabilities = {
    manualLayout: true,
    persistentLabels: false,
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  private labelToPaneId = new Map<string, string>()
  private config: TmuxAdapterConfig
  private spawn: SpawnFn
  private overrideTmuxPath: string | undefined

  constructor(config: TmuxAdapterConfig, spawnFn: SpawnFn = bunSpawn, tmuxPath?: string) {
    this.config = config
    this.spawn = spawnFn
    this.overrideTmuxPath = tmuxPath
  }

  private async resolveTmuxPath(): Promise<string | null> {
    return this.overrideTmuxPath ?? await getTmuxPath()
  }

  async ensureSession(name: string): Promise<void> {
    const tmux = await this.resolveTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.ensureSession] tmux not found")
      return
    }

    const proc = this.spawn([tmux, "new-session", "-d", "-s", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async killSession(name: string): Promise<void> {
    const tmux = await this.resolveTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.killSession] tmux not found")
      return
    }

    const proc = this.spawn([tmux, "kill-session", "-t", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle> {
    const { label, splitFrom, direction = "horizontal" } = options

    const splitDirection = direction === "horizontal" ? "-h" : "-v"
    const targetPaneId = splitFrom?.nativeId

    if (!this.config.enabled) {
      log("[TmuxAdapter.spawnPane] disabled by config")
      return { label }
    }

    if (!isInsideTmux()) {
      log("[TmuxAdapter.spawnPane] not inside tmux")
      return { label }
    }

    const tmux = await this.resolveTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.spawnPane] tmux not found")
      return { label }
    }

    const fallbackPaneId = getCurrentPaneId()

    const args = [
      "split-window",
      splitDirection,
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      ...(targetPaneId ? ["-t", targetPaneId] : fallbackPaneId ? ["-t", fallbackPaneId] : []),
      cmd,
    ]

    const proc = this.spawn([tmux, ...args], { stdout: "pipe", stderr: "pipe" })
    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const paneId = stdout.trim()

    if (exitCode !== 0 || !paneId) {
      return { label }
    }

    this.labelToPaneId.set(label, paneId)

    this.spawn([tmux, "select-pane", "-t", paneId, "-T", label], {
      stdout: "ignore",
      stderr: "ignore",
    })

    return {
      label,
      nativeId: paneId,
    }
  }

  async closePane(handle: PaneHandle): Promise<void> {
    const paneId = handle.nativeId || this.labelToPaneId.get(handle.label)

    if (!paneId) {
      return
    }

    const tmux = await this.resolveTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.closePane] tmux not found")
      return
    }

    const ctrlCProc = this.spawn([tmux, "send-keys", "-t", paneId, "C-c"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await ctrlCProc.exited

    await new Promise(resolve => setTimeout(resolve, 250))

    const killProc = this.spawn([tmux, "kill-pane", "-t", paneId], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await killProc.exited

    this.labelToPaneId.delete(handle.label)
  }

  async getPanes(): Promise<PaneHandle[]> {
    const tmux = await this.resolveTmuxPath()
    if (!tmux) {
      return []
    }

    const proc = this.spawn(
      [
        tmux,
        "list-panes",
        "-a",
        "-F",
        "#{pane_id},#{pane_title}",
      ],
      { stdout: "pipe", stderr: "pipe" }
    )

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()

    if (exitCode !== 0) {
      return []
    }

    const panes: PaneHandle[] = []
    const lines = stdout.trim().split("\n").filter(Boolean)

    for (const line of lines) {
      const commaIndex = line.indexOf(",")
      if (commaIndex === -1) continue
      const paneId = line.slice(0, commaIndex)
      const title = line.slice(commaIndex + 1)
      if (paneId && title) {
        panes.push({
          label: title,
          nativeId: paneId,
        })
        this.labelToPaneId.set(title, paneId)
      }
    }

    return panes
  }
}
