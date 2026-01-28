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

    const proc = spawn(
      [
        "zellij",
        "action",
        "new-pane",
        "-d",
        direction,
        "-n",
        label,
        "--close-on-exit",
        "--",
        cmd,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    )

    await proc.exited

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
