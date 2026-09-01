import { describe, expect, it, mock } from "bun:test"
import { Writable } from "node:stream"
import type { SpawnOptions, SpawnedProcess } from "../../shared/bun-spawn-shim"
import { runRg } from "./cli"

function createTextStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text.length > 0) {
        controller.enqueue(new TextEncoder().encode(text))
      }
      controller.close()
    },
  })
}

function createSpawnedProcess(exited: Promise<number>, stdout = "", stderr = ""): SpawnedProcess {
  return {
    exitCode: null,
    exited,
    stdout: createTextStream(stdout),
    stderr: createTextStream(stderr),
    stdin: new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
    pid: 3919,
    kill() {},
    ref() {},
    unref() {},
  }
}

describe("runRg", () => {
  it("#given mocked spawn rejection #when grep runs #then returns a structured error result", async () => {
    const spawnMock = mock((_command: string[], _options?: SpawnOptions): SpawnedProcess =>
      createSpawnedProcess(Promise.reject(new Error("spawn rejected")))
    )

    const result = await runRg(
      { pattern: "needle", paths: ["."], timeout: 1000 },
      { path: "rg", backend: "rg" },
      spawnMock
    )

    expect(result.matches).toEqual([])
    expect(result.totalMatches).toBe(0)
    expect(result.filesSearched).toBe(0)
    expect(result.truncated).toBe(false)
    expect(result.error).toContain("spawn rejected")
  })
})
