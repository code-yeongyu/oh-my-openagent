import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ATTACHMENT_PROBE_PATH = fileURLToPath(
  new URL("./windows-console-attachment-probe.ts", import.meta.url),
)

export type ConsoleAttachment = {
  readonly attached: boolean
  readonly errorCode: number
  readonly windowHandle: number
  readonly windowVisible: boolean
}

export function mainWindowHandle(pid: number): number {
  const source = `$p = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write([int64]$p.MainWindowHandle)`
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", source], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`MainWindowHandle probe failed: ${result.stderr.trim()}`)
  }
  const handle = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isSafeInteger(handle)) {
    throw new Error(`MainWindowHandle was not an integer: ${result.stdout}`)
  }
  return handle
}

/**
 * Asks a throwaway Bun child whether `pid` owns a visible console window.
 *
 * The answer comes from kernel32/user32 through bun:ffi rather than from a PowerShell shim that
 * compiled a C# P/Invoke class with csc.exe on every call: that compile plus a Windows PowerShell
 * 5.1 cold start ran twice inside a probe step bounded at 60s, and is what the probe spent its
 * budget on when a loaded runner aborted it (#8323).
 */
export function consoleAttachment(pid: number): ConsoleAttachment {
  const result = spawnSync(process.execPath, [ATTACHMENT_PROBE_PATH, String(pid)], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`console attachment probe failed: ${result.stderr.trim()}`)
  }
  const payload: unknown = JSON.parse(result.stdout.trim())
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("attached" in payload) ||
    typeof payload.attached !== "boolean" ||
    !("errorCode" in payload) ||
    typeof payload.errorCode !== "number" ||
    !("windowHandle" in payload) ||
    typeof payload.windowHandle !== "number" ||
    !("windowVisible" in payload) ||
    typeof payload.windowVisible !== "boolean"
  ) {
    throw new Error(`console attachment probe returned invalid JSON: ${result.stdout}`)
  }
  return {
    attached: payload.attached,
    errorCode: payload.errorCode,
    windowHandle: payload.windowHandle,
    windowVisible: payload.windowVisible,
  }
}
