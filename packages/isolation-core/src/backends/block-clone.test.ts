import { expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Pointer } from "bun:ffi"
import { IsolationUnavailableError } from "../backend"
import { fixture } from "../test-fixture"
import { BlockCloneBackend, createWindowsCloneApi, duplicateExtents, type WindowsSymbols } from "./block-clone"
import { runtime } from "./runtime"

function native() {
  const calls: unknown[][] = []
  const symbols: WindowsSymbols = {
    CreateFileW: (path, desired, share, security, disposition, flags, template) => {
      calls.push(["CreateFileW", path.toString("utf16le"), desired, share, security, disposition, flags, template])
      return (desired === 0x80000000 ? 1 : 2) as Pointer
    },
    SetFilePointerEx: (handle, offset, output, method) => { calls.push(["SetFilePointerEx", handle, offset, output, method]); return 1 },
    SetEndOfFile: (handle) => { calls.push(["SetEndOfFile", handle]); return 1 },
    DeviceIoControl: (handle, code, input, length, output, outputLength, returned, overlapped) => {
      calls.push(["DeviceIoControl", handle, code, [...input], length, output, outputLength, returned.length, overlapped]); return 1
    },
    CloseHandle: (handle) => { calls.push(["CloseHandle", handle]); return 1 },
    GetLastError: () => 50,
    GetDiskFreeSpaceW: (_path, sectors, bytes) => { sectors.writeUInt32LE(8); bytes.writeUInt32LE(512); return 1 },
  }
  return { calls, symbols }
}

test("native ReFS binding uses actual FSCTL opcode, handle structure and EOF calls", async () => {
  const { calls, symbols } = native()
  await duplicateExtents(createWindowsCloneApi(symbols), "C:\\source", "C:\\target", 8192)
  const data = Buffer.alloc(32)
  data.writeBigUInt64LE(1n, 0)
  data.writeBigInt64LE(8192n, 24)
  expect(calls).toEqual([
    ["CreateFileW", "\\\\?\\C:\\source\0", 0x80000000, 7, null, 3, 0x80, null],
    ["CreateFileW", "\\\\?\\C:\\target\0", 0x40000000, 7, null, 1, 0x80, null],
    ["SetFilePointerEx", 2, 8192n, null, 0], ["SetEndOfFile", 2],
    ["DeviceIoControl", 2, 0x00098344, [...data], 32, null, 0, 4, null],
    ["SetFilePointerEx", 2, 8192n, null, 0], ["SetEndOfFile", 2],
    ["CloseHandle", 2], ["CloseHandle", 1],
  ])
})

test("native ReFS errors preserve classification and close both handles", async () => {
  for (const errno of [50, 5]) {
    const { calls, symbols } = native()
    symbols.DeviceIoControl = () => 0
    symbols.GetLastError = () => errno
    let failure: unknown
    try { await duplicateExtents(createWindowsCloneApi(symbols), "C:\\source", "C:\\target", 8192) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(failure instanceof IsolationUnavailableError).toBe(errno === 50)
    expect(calls.slice(-2)).toEqual([["CloseHandle", 2], ["CloseHandle", 1]])
  }
})

test("ReFS tiny files and unaligned tails use plain copy without changing source", async () => {
  const f = await fixture()
  for (const size of [0, 5, 8195]) {
    const source = join(f.repoRoot, `source-${size}`), destination = join(f.root, `target-${size}`)
    const content = Buffer.alloc(size, 42)
    await writeFile(source, content)
    const cloned: number[] = [], allocations: number[] = []
    // Actual local tail I/O, with only the Windows native prefix clone injected.
    const api = {
      clusterSize: () => 4096,
      open: (_path: string, output: boolean) => output ? 2 : 1,
      resize: (_handle: number, bytes: number) => { allocations.push(bytes) }, close: () => {},
      duplicate: (_dst: number, _src: number, bytes: number) => { cloned.push(bytes) },
    }
    if (size >= 4096) await writeFile(destination, content.subarray(0, 8192))
    await duplicateExtents(api, source, destination, size)
    expect(cloned).toEqual(size >= 4096 ? [8192] : [])
    expect(allocations).toEqual(size >= 4096 ? [12288, 8195] : [])
    expect(await readFile(destination)).toEqual(content)
    expect(await readFile(source)).toEqual(content)
  }
})

test("ReFS probe loads ffi only on matching filesystem and rejects cross-volume targets", async () => {
  const f = await fixture(), { symbols } = native()
  let loaded = 0
  const calls: string[][] = []
  const backend = new BlockCloneBackend({ ...runtime, platform: "win32", which: () => true,
    device: async (path) => path === f.repoRoot ? 1 : 2,
    run: async (argv) => { calls.push(argv); return { code: 0, stdout: "File System Name : ReFS", stderr: "" } },
  }, async () => { loaded++; return createWindowsCloneApi(symbols) })
  expect((await backend.probe("R:\\repo")).available).toBe(true)
  expect(calls).toEqual([["fsutil", "fsinfo", "volumeinfo", "R:\\"]])
  expect(loaded).toBe(1)
  await expect(backend.start(f.repoRoot, join(f.root, "m"), { id: "cross", baseDir: f.root, crossDevice: false })).rejects.toBeInstanceOf(IsolationUnavailableError)
})


test("ReFS probe treats absent Node-hosted FFI as unavailable but propagates other loader errors", async () => {
  const io = { ...runtime, platform: "win32" as const, which: () => true,
    run: async () => ({ code: 0, stdout: "ReFS", stderr: "" }) }
  const missing = Object.assign(new Error("unsupported bun: scheme"), { code: "ERR_UNSUPPORTED_ESM_URL_SCHEME" })
  expect((await new BlockCloneBackend(io, async () => { throw missing }).probe("R:\\repo")).available).toBe(false)
  const broken = new Error("loader failure")
  await expect(new BlockCloneBackend(io, async () => { throw broken }).probe("R:\\repo")).rejects.toBe(broken)
})


test("ReFS probe rejects a different target volume before loading native symbols", async () => {
  const f = await fixture(), { symbols } = native()
  let loads = 0
  const io = { ...runtime, platform: "win32" as const, which: () => true,
    device: async (path: string) => path === f.repoRoot ? 1 : 2,
    run: async () => ({ code: 0, stdout: "ReFS", stderr: "" }) }
  const backend = new BlockCloneBackend(io, async () => { loads++; return createWindowsCloneApi(symbols) })
  expect((await backend.probe(f.repoRoot, { id: "cross", baseDir: f.homeDir, crossDevice: false })).available).toBe(false)
  expect(loads).toBe(0)
})
