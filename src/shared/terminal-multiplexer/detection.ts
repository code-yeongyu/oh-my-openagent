import { spawn } from "bun"
import type { MultiplexerType, Multiplexer } from "./types"
import { TmuxAdapter, type TmuxAdapterConfig } from "./tmux-adapter"
import { ZellijAdapter, type ZellijAdapterConfig } from "./zellij-adapter"
import { log } from "../logger"

let cachedMultiplexer: MultiplexerType | null | undefined

async function findBinary(name: string): Promise<boolean> {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const proc = spawn([cmd, name], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    return exitCode === 0
  } catch {
    return false
  }
}

export async function detectMultiplexer(): Promise<MultiplexerType | null> {
  if (cachedMultiplexer !== undefined) {
    return cachedMultiplexer
  }

  if (process.env.TMUX) {
    log("[detectMultiplexer] Found $TMUX env var")
    cachedMultiplexer = "tmux"
    return "tmux"
  }

  if (process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME) {
    log("[detectMultiplexer] Found $ZELLIJ or $ZELLIJ_SESSION_NAME env var")
    cachedMultiplexer = "zellij"
    return "zellij"
  }

  const tmuxAvailable = await findBinary("tmux")
  const zellijAvailable = await findBinary("zellij")

  if (tmuxAvailable) {
    log("[detectMultiplexer] tmux binary found")
    cachedMultiplexer = "tmux"
    return "tmux"
  }

  if (zellijAvailable) {
    log("[detectMultiplexer] zellij binary found")
    cachedMultiplexer = "zellij"
    return "zellij"
  }

  log("[detectMultiplexer] No multiplexer detected")
  cachedMultiplexer = null
  return null
}

export function createMultiplexer(
  type: MultiplexerType,
  config?: { tmux?: TmuxAdapterConfig; zellij?: ZellijAdapterConfig }
): Multiplexer {
  const tmuxConfig: TmuxAdapterConfig = config?.tmux || { enabled: true }
  const zellijConfig: ZellijAdapterConfig = config?.zellij || { enabled: true }

  if (type === "tmux") {
    return new TmuxAdapter(tmuxConfig)
  }

  if (type === "zellij") {
    return new ZellijAdapter(zellijConfig)
  }

  throw new Error(`Unknown multiplexer type: ${type}`)
}

export function resetDetectionCache(): void {
  cachedMultiplexer = undefined
}
