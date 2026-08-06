import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const cleanupRoots: string[] = []
const claimRaceChildFixturePath = resolve(import.meta.dir, "__fixtures__", "claim-race-child.ts")
const frozenNowMs = 0x10 * 0x10000

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-claim-race-"))
  cleanupRoots.push(directory)
  return directory
}

type ChildResult = {
  readonly output: string
  readonly ready: Promise<void>
}

function readChildStdout(stdout: ReadableStream<Uint8Array>): ChildResult {
  let output = ""
  let buffered = ""
  let resolveReady: () => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  void (async () => {
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        output += chunk
        buffered += chunk
        let newlineIndex = buffered.indexOf("\n")
        while (newlineIndex >= 0) {
          const line = buffered.slice(0, newlineIndex)
          buffered = buffered.slice(newlineIndex + 1)
          if (line === "READY") resolveReady()
          newlineIndex = buffered.indexOf("\n")
        }
      }
      const trailing = decoder.decode()
      output += trailing
      buffered += trailing
      if (buffered === "READY") resolveReady()
    } catch (error) {
      rejectReady(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  return { get output() { return output }, ready }
}

function parseChildResult(output: string): { readonly ids: readonly string[]; readonly retries: number } {
  const resultLine = output.split("\n").find((line) => line.startsWith("{"))
  if (resultLine === undefined) throw new Error(`Child did not emit a JSON result:\n${output}`)
  return JSON.parse(resultLine) as { readonly ids: readonly string[]; readonly retries: number }
}

describe("claimTaskRecord cross-process race", () => {
  test("#given two processes in one frozen id bucket #when they claim task records concurrently #then every record is unique and collisions retry", async () => {
    // given
    const project = tempProject()
    const children = ["a", "b"].map((tag) => Bun.spawn([
      process.execPath,
      claimRaceChildFixturePath,
      project,
      String(frozenNowMs),
      "50",
      tag,
    ], { stdin: "pipe", stdout: "pipe", stderr: "pipe" }))
    const stdout = children.map((child) => readChildStdout(child.stdout))
    const stderr = children.map((child) => new Response(child.stderr).text())

    // when
    await Promise.all(stdout.map((child) => child.ready))
    for (const child of children) child.stdin.write("GO\n")
    const [exitCodes, stderrOutput] = await Promise.all([
      Promise.all(children.map((child) => child.exited)),
      Promise.all(stderr),
    ])
    // then
    for (const [index, exitCode] of exitCodes.entries()) {
      expect(exitCode, `stdout:\n${stdout[index]?.output}\nstderr:\n${stderrOutput[index]}`).toBe(0)
    }
    const results = stdout.map((child) => parseChildResult(child.output))
    const ids = results.flatMap((result) => result.ids)
    expect(ids).toHaveLength(100)
    expect(new Set(ids).size).toBe(100)
    expect(readdirSync(join(project, ".omo", "senpi-task", "tasks"))).toHaveLength(100)
    expect(results.reduce((total, result) => total + result.retries, 0)).toBeGreaterThanOrEqual(1)
    for (const output of stderrOutput) expect(output).not.toContain("already exists")
  })
})
