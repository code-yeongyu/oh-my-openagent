import { spawn } from "bun"
import type { Multiplexer, PaneHandle, SpawnOptions, MultiplexerCapabilities } from "./types"
import {
  spawnTmuxPane,
  closeTmuxPane,
  getCurrentPaneId,
  isInsideTmux,
} from "../tmux/tmux-utils"
import { getTmuxPath } from "../../tools/interactive-bash/utils"
import { log } from "../logger"

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

  private labelToPaneId = new Map<string, string>()
  private config: TmuxAdapterConfig

  constructor(config: TmuxAdapterConfig) {
    this.config = config
  }

  async ensureSession(name: string): Promise<void> {
    const tmux = await getTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.ensureSession] tmux not found")
      return
    }

    const proc = spawn([tmux, "new-session", "-d", "-s", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async killSession(name: string): Promise<void> {
    const tmux = await getTmuxPath()
    if (!tmux) {
      log("[TmuxAdapter.killSession] tmux not found")
      return
    }

    const proc = spawn([tmux, "kill-session", "-t", name], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
  }

  async spawnPane(cmd: string, options: SpawnOptions): Promise<PaneHandle> {
    const { label, splitFrom, direction = "horizontal" } = options

    const splitDirection = direction === "horizontal" ? "-h" : "-v"
    const targetPaneId = splitFrom?.nativeId

    const result = await spawnTmuxPane(
      "default-session",
      label,
      this.config as any,
      "http://localhost:3000",
      targetPaneId,
      splitDirection as "-h" | "-v"
    )

    if (result.success && result.paneId) {
      this.labelToPaneId.set(label, result.paneId)

      const tmux = await getTmuxPath()
      if (tmux) {
        spawn([tmux, "select-pane", "-t", result.paneId, "-T", label], {
          stdout: "ignore",
          stderr: "ignore",
        })
      }

      return {
        label,
        nativeId: result.paneId,
      }
    }

    return { label }
  }

  async closePane(handle: PaneHandle): Promise<void> {
    const paneId = handle.nativeId || this.labelToPaneId.get(handle.label)

    if (paneId) {
      await closeTmuxPane(paneId)
      this.labelToPaneId.delete(handle.label)
    }
  }

  async getPanes(): Promise<PaneHandle[]> {
    const tmux = await getTmuxPath()
    if (!tmux) {
      return []
    }

    const proc = spawn(
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
      const [paneId, title] = line.split(",")
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
