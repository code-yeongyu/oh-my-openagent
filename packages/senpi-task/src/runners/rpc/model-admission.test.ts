import { type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, test } from "bun:test"

import { RunnerError } from "../in-process/runner-error"
import { RpcProcessRunner } from "../rpc-process"
import { spawnFakeChild } from "./__fixtures__/spawn-fake"
import { parseModelCatalog, probeModelCatalog } from "./model-admission"
import type { RpcSpawnDescriptor } from "./spawn"

const children: ChildProcess[] = []
const stateDirs: string[] = []

function makeSpec(model: string) {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-model-admission-"))
  stateDirs.push(stateDir)
  return {
    task_id: "st_model_admission",
    cwd: process.cwd(),
    state_dir: stateDir,
    prompt: "hello",
    model,
  }
}

function createProbeChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid: 12_345,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as unknown as ChildProcess
}

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
    child.kill()
  })))
  for (const stateDir of stateDirs.splice(0)) {
    rmSync(stateDir, { recursive: true, force: true })
  }
})

describe("RpcProcessRunner model admission", () => {
  test("#given a catalog probe #when spawned #then it is hidden and owns its POSIX process tree", async () => {
    // given
    const child = createProbeChild()
    let spawnOptions: Record<string, unknown> | undefined

    // when
    const result = probeModelCatalog({
      command: process.execPath,
      args: ["--version"],
      cwd: process.cwd(),
      env: process.env,
    }, {
      spawnProcess: (_command: string, _args: readonly string[], options: Record<string, unknown>) => {
        spawnOptions = options
        queueMicrotask(() => child.emit("close", 0, null))
        return child
      },
    })

    // then
    await expect(result).resolves.toMatchObject({ code: 0, timedOut: false })
    expect(spawnOptions).toMatchObject({
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    })
  })

  test("#given a timed out catalog probe #when tree cleanup is pending #then the timeout result waits for cleanup", async () => {
    // given
    const child = createProbeChild()
    let markTerminationStarted: (() => void) | undefined
    const terminationStarted = new Promise<void>((resolve) => {
      markTerminationStarted = resolve
    })
    let releaseTermination: (() => void) | undefined
    const terminationReleased = new Promise<void>((resolve) => {
      releaseTermination = resolve
    })

    // when
    let settled = false
    const result = probeModelCatalog({
      command: process.execPath,
      args: ["--version"],
      cwd: process.cwd(),
      env: process.env,
    }, {
      timeoutMs: 0,
      spawnProcess: () => child,
      terminateChild: async () => {
        markTerminationStarted?.()
        await terminationReleased
      },
    }).then((value) => {
      settled = true
      return value
    })
    await terminationStarted

    // then
    expect(settled).toBe(false)
    releaseTermination?.()
    await expect(result).resolves.toMatchObject({ timedOut: true })
  })

  test("#given a Senpi model table #when parsed #then provider and model columns form exact identities", () => {
    // given
    const output = [
      "fixture  visible       128K  8K  yes  no",
      "fixture  visible-fast  128K  8K  yes  no",
      "other    visible       128K  8K  yes  no",
    ].join("\n")

    // when
    const catalog = parseModelCatalog(output)

    // then
    expect(catalog.has("fixture/visible")).toBe(true)
    expect(catalog.has("fixture/vis")).toBe(false)
    expect(catalog.has("other/visible")).toBe(true)
  })

  test("#given a compact provider/model identity line #when parsed #then the exact identity is visible", () => {
    // given
    const output = [
      "provider                    model                                                     context  max-out  thinking  images",
      "omo-mock/mock-1",
    ].join("\n")

    // when
    const catalog = parseModelCatalog(output)

    // then
    expect(catalog.has("omo-mock/mock-1")).toBe(true)
  })

  test("#given a model absent from the child profile #when started #then admission rejects before spawn", async () => {
    // given
    let admissionCalls = 0
    let spawnCalls = 0
    const options = {
      modelAdmission: async () => {
        admissionCalls += 1
        throw new RunnerError({
          kind: "model_unavailable",
          message: "model fixture/missing is not visible to the process child",
        })
      },
      spawnChild: (descriptor: RpcSpawnDescriptor) => {
        spawnCalls += 1
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    }
    const runner = new RpcProcessRunner(options)

    // when
    const start = Promise.resolve().then(() => runner.start(makeSpec("fixture/missing")))

    // then
    await expect(start).rejects.toMatchObject({ failure: { kind: "model_unavailable" } })
    expect(admissionCalls).toBe(1)
    expect(spawnCalls).toBe(0)
  })

  test("#given a model visible to the child profile #when started #then admission completes before spawn", async () => {
    // given
    const order: string[] = []
    const options = {
      modelAdmission: async () => {
        order.push("admit")
      },
      spawnChild: (descriptor: RpcSpawnDescriptor) => {
        order.push("spawn")
        const child = spawnFakeChild(descriptor.env)
        children.push(child)
        return child
      },
    }
    const runner = new RpcProcessRunner(options)

    // when
    await runner.start(makeSpec("fixture/visible"))

    // then
    expect(order).toEqual(["admit", "spawn"])
  })
})
