import { spawn } from "bun"
import type { MultiplexerType, Multiplexer } from "./types"
import { TmuxAdapter } from "./tmux-adapter"
import { ZellijAdapter } from "./zellij-adapter"
import { defaultZellijStorage, type ZellijStorage } from "./zellij-storage"
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

export async function detectMultiplexer(
  findBinaryImpl: (name: string) => Promise<boolean> = findBinary
): Promise<MultiplexerType | null> {
  if (cachedMultiplexer !== undefined) {
    return cachedMultiplexer
  }

  if (process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME) {
    log("[detectMultiplexer] Found $ZELLIJ or $ZELLIJ_SESSION_NAME env var")
    cachedMultiplexer = "zellij"
    return "zellij"
  }

  if (process.env.TMUX) {
    log("[detectMultiplexer] Found $TMUX env var")
    cachedMultiplexer = "tmux"
    return "tmux"
  }

  const tmuxAvailable = await findBinaryImpl("tmux")
  const zellijAvailable = await findBinaryImpl("zellij")

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
  zellijStorage: ZellijStorage = defaultZellijStorage
): Multiplexer {
  if (type === "tmux") {
    return new TmuxAdapter()
  }

  if (type === "zellij") {
    return new ZellijAdapter(zellijStorage)
  }

  throw new Error(`Unknown multiplexer type: ${type}`)
}

export function resetDetectionCache(): void {
  cachedMultiplexer = undefined
}
