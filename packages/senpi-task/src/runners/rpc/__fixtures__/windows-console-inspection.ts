import { spawnSync } from "node:child_process"

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

export function consoleAttachment(pid: number): ConsoleAttachment {
  const source = [
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class OmoConsoleProbe {",
    '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);',
    '  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
    '  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);',
    "}",
    "'@",
    "[OmoConsoleProbe]::FreeConsole() | Out-Null",
    `$attached = [OmoConsoleProbe]::AttachConsole(${pid})`,
    "$errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "$windowHandle = [OmoConsoleProbe]::GetConsoleWindow()",
    "$windowVisible = [OmoConsoleProbe]::IsWindowVisible($windowHandle)",
    "[Console]::Out.Write((@{ attached = $attached; errorCode = $errorCode; windowHandle = [int64]$windowHandle; windowVisible = $windowVisible } | ConvertTo-Json -Compress))",
    "if ($attached) { [OmoConsoleProbe]::FreeConsole() | Out-Null }",
  ].join("\n")
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", source], {
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
