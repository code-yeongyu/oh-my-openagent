/// <reference types="bun-types" />

// The memory tool on a split session (brain/hand plan row O2, Q 11-03 E): the tool runs where the session is bound
// (the loop), and every file and git operation of a write goes through the session's device files, never a direct
// open. The fixture models the remote case: the loop's paths do not exist on the loop's disk; only the device files
// translate them to the device's directory, where the memory repository lives.

import { describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryBinding } from "./binding"
import { SPLIT_UNINITIALIZED_MESSAGE } from "./engine-session"
import { createMemoryIdentityContext } from "./context"
import { IDENTITY, git, testRoot, textOf } from "./tools.test-support"
import { createMemoryTools, type MemoryToolExecutionResult } from "./tools"

interface DeviceRun {
  readonly exe: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
}

/** Device files over a directory the loop cannot see: `loopRoot` paths map to `deviceRoot`, and each operation is recorded. */
function remoteDeviceFiles(loopRoot: string, deviceRoot: string) {
  const ops: string[] = []
  const onDevice = (path: string): string => {
    if (!path.startsWith(loopRoot)) throw new Error(`refused_by_policy: ${path} is outside the device files`)
    return deviceRoot + path.slice(loopRoot.length)
  }
  const mapText = (text: string): string => text.split(loopRoot).join(deviceRoot)
  const record = (op: string, path: string): void => { ops.push(`${op} ${path.slice(loopRoot.length)}`) }
  // The engine's typed error codes, as a hand's file channel reports them.
  const typed = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const typedCode = code === "ENOENT" ? "not_found" : code === "EEXIST" ? "exists" : code === "EISDIR" ? "not_a_file" : "io"
      throw Object.assign(new Error(`${typedCode}: ${String(error)}`), { code: typedCode })
    }
  }
  return {
    ops,
    files: {
      read: (path: string) => typed(async () => { record("read", path); return new Uint8Array(await readFile(onDevice(path))) }),
      write: (path: string, data: Uint8Array, options?: { exclusive?: boolean }) => typed(async () => {
        record("write", path)
        await mkdir(join(onDevice(path), ".."), { recursive: true })
        await writeFile(onDevice(path), data, { flag: options?.exclusive === true ? "wx" : "w" })
      }),
      list: (path: string) => typed(async () => { record("list", path); return (await readdir(onDevice(path))).sort() }),
      stat: (path: string) => typed(async () => {
        record("stat", path)
        const stats = await lstat(onDevice(path))
        return { kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other", size: stats.size, mtimeMs: stats.mtimeMs } as const
      }),
      rename: (from: string, to: string) => typed(async () => { record("rename", from); await rename(onDevice(from), onDevice(to)) }),
      remove: (path: string) => typed(async () => { record("remove", path); await lstat(onDevice(path)); await rm(onDevice(path), { recursive: true }) }),
      mkdir: (path: string) => typed(async () => { record("mkdir", path); await mkdir(onDevice(path), { recursive: true }) }),
      run(request: DeviceRun) {
        const subcommand = request.argv.find((arg, index) => !arg.startsWith("-") && request.argv[index - 1] !== "-c")
        ops.push(`run ${request.exe} ${subcommand ?? ""}`)
        return new Promise<{ code: number | null; signal: string | null; stdout: Uint8Array; stderr: string }>((resolve, reject) => {
          const env = Object.fromEntries(Object.entries(request.env ?? {}).map(([key, value]) => [key, mapText(value)]))
          const child = spawn(request.exe, request.argv.map(mapText), { cwd: onDevice(request.cwd), env: { ...process.env, ...env }, windowsHide: true })
          const stdout: Buffer[] = []
          let stderr = ""
          child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
          child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
          child.on("error", reject)
          child.on("close", (code, signal) => resolve({ code, signal, stdout: new Uint8Array(Buffer.concat(stdout)), stderr: mapText(stderr) }))
          child.stdin.end(request.stdin ?? new Uint8Array())
        })
      },
    },
  }
}

type Execute = (...args: unknown[]) => Promise<MemoryToolExecutionResult>

async function splitFixture(options: { readonly initialized?: boolean } = {}) {
  const root = await testRoot("omo-senpi-memory-split-")
  const loopRoot = join(root, "loop-machine")
  const deviceRoot = join(root, "device")
  const devicePaths = buildIdentityPaths(deviceRoot, IDENTITY)
  if (options.initialized !== false) await new GitMemoryRepo({ dir: devicePaths.repo, agentId: IDENTITY }).init({ authorName: "Memory Split Test" })
  const loopPaths = buildIdentityPaths(loopRoot, IDENTITY)
  const binding = createMemoryBinding({ identity: IDENTITY, repoPath: loopPaths.repo, boundAt: Date.now() })
  const context = createMemoryIdentityContext({ identity: IDENTITY, identityPaths: loopPaths, binding })
  const device = remoteDeviceFiles(loopRoot, deviceRoot)
  return { loopRoot, devicePaths, context, device }
}

describe("memory tool on a split session", () => {
  it("#given device files the loop's disk cannot see #when the memory tool creates a block #then the write and its commit land on the device only", async () => {
    // given
    const { loopRoot, devicePaths, context, device } = await splitFixture()
    const [tool] = createMemoryTools(() => context)

    // when
    const result = await (tool.execute as (...args: unknown[]) => Promise<MemoryToolExecutionResult>)(
      "call-1",
      { command: "create", reason: "remember the split", file_path: "notes/split.md", description: "Split note", file_text: "lives on the device" },
      undefined,
      undefined,
      { deviceFiles: device.files },
    )

    // then
    expect(textOf(result)).toContain("committed")
    expect(result.isError).toBeUndefined()
    expect(await readFile(join(devicePaths.repo, "notes/split.md"), "utf8")).toContain("lives on the device")
    expect(await git(new GitMemoryRepo({ dir: devicePaths.repo, agentId: IDENTITY }), ["log", "-1", "--format=%s"])).toBe("remember the split")
    expect(existsSync(loopRoot)).toBe(false)
    expect(device.ops.filter((op) => op.startsWith("write ") && op.endsWith("/notes/split.md"))).toHaveLength(1)
    expect(device.ops.some((op) => op === "run git commit")).toBe(true)
  })

  it("#given a split session #when the memory tool applies a patch #then the patched block and its commit land on the device only", async () => {
    // given
    const { loopRoot, devicePaths, context, device } = await splitFixture()
    const repo = new GitMemoryRepo({ dir: devicePaths.repo, agentId: IDENTITY })
    const [tool] = createMemoryTools(() => context)

    // when
    const result = await (tool.execute as Execute)(
      "call-2",
      { command: "apply_patch", reason: "patch on the split", input: "*** Begin Patch\n*** Add File: notes/patched.md\n+patched on the device\n*** End Patch" },
      undefined,
      undefined,
      { deviceFiles: device.files },
    )

    // then
    expect(textOf(result)).toContain("committed")
    expect(result.isError).toBeUndefined()
    expect(await readFile(join(devicePaths.repo, "notes/patched.md"), "utf8")).toContain("patched on the device")
    expect(await git(repo, ["log", "-1", "--format=%s"])).toBe("patch on the split")
    expect(existsSync(loopRoot)).toBe(false)
  })

  it("#given a device with no memory repository yet #when the memory tool writes on a split session #then it refuses with the typed explanation and creates nothing", async () => {
    // given
    const { loopRoot, devicePaths, context, device } = await splitFixture({ initialized: false })
    const [tool] = createMemoryTools(() => context)

    // when
    const result = await (tool.execute as Execute)(
      "call-3",
      { command: "create", reason: "first write", file_path: "notes/first.md", description: "First", file_text: "x" },
      undefined,
      undefined,
      { deviceFiles: device.files },
    )

    // then
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(`memory: ${SPLIT_UNINITIALIZED_MESSAGE}`)
    expect(existsSync(join(devicePaths.repo, ".git"))).toBe(false)
    expect(existsSync(loopRoot)).toBe(false)
  })

  it("#given the memory tool #when it is defined #then it is declared to run where the loop runs", () => {
    // when
    const [tool] = createMemoryTools(() => undefined)

    // then
    expect((tool as { runs?: string }).runs).toBe("brain")
  })
})
