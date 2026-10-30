// Answers "does this pid own a console, and is that console's window visible?" for the Windows
// console probe, in a throwaway child process.
//
// The question used to be asked through `powershell.exe -Command "Add-Type -TypeDefinition ..."`,
// which compiles a C# shim with csc.exe on every call. That is the single most expensive fixed cost
// in the probe: two Windows PowerShell 5.1 cold starts plus two runtime C# compiles inside a probe
// whose own step budget is 60s. On a loaded runner the probe spent that budget and aborted with an
// opaque AbortError while the same work completed in 6.3s/7.3s/14.2s on quiet runners (#8323).
// kernel32/user32 answer it directly, which is the same trade memory-core already made for the
// Windows process-start fingerprint (packages/memory-core/src/locks/process-start-time.ts).
//
// It stays a CHILD process on purpose: AttachConsole binds the calling process to another
// process's console, so asking the question in the long-lived probe would leave the probe attached
// to the very console it is measuring.

import { dlopen, FFIType } from "bun:ffi"

const pid = Number.parseInt(process.argv[2] ?? "", 10)
if (!Number.isSafeInteger(pid) || pid <= 0) {
  throw new Error(`usage: windows-console-attachment-probe.ts <pid> (got ${String(process.argv[2])})`)
}

const kernel32 = dlopen("kernel32.dll", {
  FreeConsole: { args: [], returns: FFIType.bool },
  AttachConsole: { args: [FFIType.u32], returns: FFIType.bool },
  GetConsoleWindow: { args: [], returns: FFIType.ptr },
  GetLastError: { args: [], returns: FFIType.u32 },
})
const user32 = dlopen("user32.dll", {
  IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.bool },
})

try {
  // Detach from any inherited console first so GetConsoleWindow can only report the console this
  // probe attached to, exactly as the PowerShell shim did.
  kernel32.symbols.FreeConsole()
  const attached = Boolean(kernel32.symbols.AttachConsole(pid))
  const errorCode = Number(kernel32.symbols.GetLastError())
  const windowHandle = kernel32.symbols.GetConsoleWindow()
  const windowHandleValue = windowHandle === null ? 0 : Number(windowHandle)
  const windowVisible =
    windowHandleValue !== 0 && Boolean(user32.symbols.IsWindowVisible(windowHandle))
  if (attached) kernel32.symbols.FreeConsole()
  process.stdout.write(
    JSON.stringify({ attached, errorCode, windowHandle: windowHandleValue, windowVisible }),
  )
} finally {
  user32.close()
  kernel32.close()
}
