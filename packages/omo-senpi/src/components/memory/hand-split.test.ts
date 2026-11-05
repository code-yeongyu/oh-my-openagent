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
  return {
    ops,
    files: {
      async read(path: string) { record("read", path); return new Uint8Array(await readFile(onDevice(path))) },
      async write(path: string, data: Uint8Array, options?: { exclusive?: boolean }) {
        record("write", path)
        await mkdir(join(onDevice(path), ".."), { recursive: true })
        await writeFile(onDevice(path), data, { flag: options?.exclusive === true ? "wx" : "w" })
      },
      async list(path: string) { record("list", path); return (await readdir(onDevice(path))).sort() },
      async stat(path: string) {
        record("stat", path)
        const stats = await lstat(onDevice(path))
        return { kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other", size: stats.size, mtimeMs: stats.mtimeMs } as const
      },
      async rename(from: string, to: string) { record("rename", from); await rename(onDevice(from), onDevice(to)) },
      async remove(path: string) { record("remove", path); await rm(onDevice(path), { recursive: true, force: true }) },
      async mkdir(path: string) { record("mkdir", path); await mkdir(onDevice(path), { recursive: true }) },
      run(request: DeviceRun) {
        ops.push(`run ${request.exe} ${request.argv.filter((arg) => !arg.startsWith("-")).slice(0, 1).join(" ")}`)
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

async function splitFixture() {
  const root = await testRoot("omo-senpi-memory-split-")
  const loopRoot = join(root, "loop-machine")
  const deviceRoot = join(root, "device")
  const devicePaths = buildIdentityPaths(deviceRoot, IDENTITY)
  await new GitMemoryRepo({ dir: devicePaths.repo, agentId: IDENTITY }).init({ authorName: "Memory Split Test" })
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
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain("committed")
    expect(await readFile(join(devicePaths.repo, "notes/split.md"), "utf8")).toContain("lives on the device")
    expect(await git(new GitMemoryRepo({ dir: devicePaths.repo, agentId: IDENTITY }), ["log", "-1", "--format=%s"])).toBe("remember the split")
    expect(existsSync(loopRoot)).toBe(false)
    expect(device.ops.filter((op) => op.startsWith("write ") && op.endsWith("/notes/split.md"))).toHaveLength(1)
    expect(device.ops.some((op) => op === "run git commit")).toBe(true)
  })

  it("#given the memory tool #when it is defined #then it is declared to run where the loop runs", () => {
    // when
    const [tool] = createMemoryTools(() => undefined)

    // then
    expect((tool as { runs?: string }).runs).toBe("brain")
  })
})
