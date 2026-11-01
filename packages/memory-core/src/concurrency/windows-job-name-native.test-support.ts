export async function loadJobExperimentKernel() {
  const { dlopen, FFIType } = await import("bun:ffi")
  const library = dlopen("kernel32.dll", {
    CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
    OpenJobObjectW: { args: [FFIType.u32, FFIType.i32, FFIType.ptr], returns: FFIType.u64 },
    AssignProcessToJobObject: { args: [FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    IsProcessInJob: { args: [FFIType.u64, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
    TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetLastError: { args: [], returns: FFIType.u32 },
  })
  const api = library.symbols
  const openJob = (name: string) => {
    const handle = BigInt(api.OpenJobObjectW(4, 0, Buffer.from(`${name}\0`, "utf16le")))
    const error = Number(api.GetLastError())
    return { handle, error }
  }
  return {
    api,
    openJob,
    createJob(name: string): bigint {
      const handle = BigInt(api.CreateJobObjectW(null, Buffer.from(`${name}\0`, "utf16le")))
      const error = Number(api.GetLastError())
      if (handle === 0n) throw new Error(`CreateJobObjectW failed: ${error}`)
      if (error === 183) {
        api.CloseHandle(handle)
        throw new Error("experiment job name already exists")
      }
      return handle
    },
    openProcess(pid: number): bigint {
      const handle = BigInt(api.OpenProcess(0x100000 | 0x1000 | 1, 0, pid))
      if (handle === 0n) throw new Error(`OpenProcess failed: ${api.GetLastError()}`)
      return handle
    },
    isAlive(handle: bigint): boolean {
      const status = Number(api.WaitForSingleObject(handle, 0))
      if (status !== 0 && status !== 258) throw new Error(`WaitForSingleObject failed: ${status}`)
      return status === 258
    },
  }
}
