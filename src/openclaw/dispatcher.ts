import { spawn } from "bun"
import type { OpenClawGateway } from "./types"

const DEFAULT_HTTP_TIMEOUT_MS = 10_000
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000
const MIN_COMMAND_TIMEOUT_MS = 100
const MAX_COMMAND_TIMEOUT_MS = 300_000
const SHELL_METACHAR_RE = /[|&;><`$()]/

export function validateGatewayUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return true
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "::1" ||
        parsed.hostname === "[::1]")
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

export function interpolateInstruction(
  template: string,
  variables: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return variables[key] ?? ""
  })
}

export function shellEscapeArg(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function resolveCommandTimeoutMs(
  gatewayTimeout?: number,
  envTimeoutRaw =
    process.env.OMO_OPENCLAW_COMMAND_TIMEOUT_MS
    ?? process.env.OMX_OPENCLAW_COMMAND_TIMEOUT_MS,
): number {
  const parseFinite = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined
    return value
  }
  const parseEnv = (value?: string): number | undefined => {
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const rawTimeout =
    parseFinite(gatewayTimeout) ??
    parseEnv(envTimeoutRaw) ??
    DEFAULT_COMMAND_TIMEOUT_MS

  return Math.min(
    MAX_COMMAND_TIMEOUT_MS,
    Math.max(MIN_COMMAND_TIMEOUT_MS, Math.trunc(rawTimeout)),
  )
}

export async function wakeGateway(
  gatewayName: string,
  gatewayConfig: OpenClawGateway,
  payload: unknown,
): Promise<{ gateway: string; success: boolean; error?: string; statusCode?: number }> {
  if (!gatewayConfig.url || !validateGatewayUrl(gatewayConfig.url)) {
    return {
      gateway: gatewayName,
      success: false,
      error: "Invalid URL (HTTPS required)",
    }
  }

  try {
    const headers = {
      "Content-Type": "application/json",
      ...gatewayConfig.headers,
    }

    const timeout = gatewayConfig.timeout ?? DEFAULT_HTTP_TIMEOUT_MS

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(gatewayConfig.url, {
      method: gatewayConfig.method || "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId)
    })

    if (!response.ok) {
      return {
        gateway: gatewayName,
        success: false,
        error: `HTTP ${response.status}`,
        statusCode: response.status,
      }
    }
    
    return { gateway: gatewayName, success: true, statusCode: response.status }
  } catch (error) {
    return {
      gateway: gatewayName,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function wakeCommandGateway(
  gatewayName: string,
  gatewayConfig: OpenClawGateway,
  variables: Record<string, string | undefined>,
): Promise<{ gateway: string; success: boolean; error?: string }> {
  if (!gatewayConfig.command) {
    return {
      gateway: gatewayName,
      success: false,
      error: "No command configured",
    }
  }

  try {
    const timeout = resolveCommandTimeoutMs(gatewayConfig.timeout)

    // Interpolate variables with shell escaping
    const interpolated = gatewayConfig.command.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const value = variables[key]
      if (value === undefined) return _match
      return shellEscapeArg(value)
    })

    const proc = spawn(["sh", "-c", interpolated], {
      env: { ...process.env },
      stdout: "ignore",
      stderr: "ignore",
      detached: process.platform !== "win32",
    })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        terminateCommandProcess(proc, "SIGKILL")
        reject(new Error("Command timed out"))
      }, timeout)
    })

    try {
      await Promise.race([proc.exited, timeoutPromise])
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }

    if (proc.exitCode !== 0) {
      throw new Error(`Command exited with code ${proc.exitCode}`)
    }

    return { gateway: gatewayName, success: true }
  } catch (error) {
    return {
      gateway: gatewayName,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals) => void
}

export function terminateCommandProcess(proc: KillableProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && proc.pid) {
      try {
        process.kill(-proc.pid, signal)
        return
      } catch {
        proc.kill(signal)
        return
      }
    }

    proc.kill(signal)
  } catch {}
}
