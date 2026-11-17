import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TypeScriptSourceParser } from "./typescript-native-source-parser"

// #13951: a test that times out makes bun kill this process's children ("killed 1 dangling process"), which includes the
// parser's native API process. The audits share one parser per file, so every later test reused the dead connection and
// failed with "Connection is closed.". The parser starts a new native process when its connection is gone.

const nativeChildren = (): number[] => {
  let out = ""
  try {
    out = execFileSync("pgrep", ["-P", String(process.pid)], { encoding: "utf8" })
  } catch {
    return []
  }
  return out
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 1)
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// SIGKILL the one native process this parser started (as bun does to a timed-out test's children) and return once it is
// gone. Each turn of the event loop lets this process reap it and close its pipes. Bounded: a SIGKILLed process cannot
// outlive the deadline.
async function killNativeProcess(before: ReadonlySet<number>): Promise<void> {
  const started = nativeChildren().filter((pid) => !before.has(pid))
  expect(started.length).toBe(1)
  const [pid] = started
  if (pid === undefined) throw new Error("no native parser process started")
  process.kill(pid, "SIGKILL")
  const deadline = Date.now() + 5_000
  while (alive(pid)) {
    if (Date.now() > deadline) throw new Error(`native parser process ${pid} still alive 5 s after SIGKILL`)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

// close() ends the native process's stdin and the process then exits on its own: wait (bounded, one event-loop turn at a
// time) until none of the processes this test started is alive. A process that was never closed never exits.
async function noNativeProcessLeft(before: ReadonlySet<number>): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const left = nativeChildren().filter((pid) => !before.has(pid) && alive(pid))
    if (left.length === 0) return
    if (Date.now() > deadline)
      throw new Error(`native parser processes ${left.join(", ")} still alive 5 s after close()`)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function project(): { readonly dir: string; readonly file: string } {
  const dir = mkdtempSync(join(tmpdir(), "ts-native-parser-"))
  const file = join(dir, "a.ts")
  writeFileSync(file, "export const answer = 42\n")
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["a.ts"] }))
  return { dir, file }
}

describe("TypeScriptSourceParser after its native process is killed", () => {
  test("#given a parse started the native process #when that process is killed as a timed-out test's child #then the next parse gets a live parser", async () => {
    const { dir, file } = project()
    const before = new Set(nativeChildren())
    const parser = new TypeScriptSourceParser(dir)
    try {
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
      await killNativeProcess(before)
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
    } finally {
      await parser.close().catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #13963 review L1: two parses that fail on the same dead connection start ONE replacement, and neither closes the one
  // the other is using.
  test("#given the native process was killed #when two parses fail on its connection at once #then both get the one replacement and no process leaks", async () => {
    const { dir, file } = project()
    const before = new Set(nativeChildren())
    const parser = new TypeScriptSourceParser(dir)
    try {
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
      await killNativeProcess(before)
      const both = await Promise.all([parser.parse([file]), parser.parse([file])])
      expect(both.map((parsed) => [...parsed.keys()])).toEqual([[file], [file]])
      expect(nativeChildren().filter((pid) => !before.has(pid) && alive(pid)).length).toBe(1)
    } finally {
      await parser.close().catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // #13963 review L1 (second): close() is queued behind the parses, so a close issued during a restart closes the
  // replacement too, and a parse after close never starts a new process.
  test("#given a parse is restarting on a killed process #when close() is called before it settles #then no native process is left, and a later parse does not reopen one", async () => {
    const { dir, file } = project()
    const before = new Set(nativeChildren())
    const parser = new TypeScriptSourceParser(dir)
    try {
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
      await killNativeProcess(before)
      const restarting = parser.parse([file])
      await parser.close()
      expect([...(await restarting).keys()]).toEqual([file])
      await noNativeProcessLeft(before)
      let reopened: unknown
      try {
        await parser.parse([file])
      } catch (error) {
        reopened = error
      }
      expect(String(reopened)).toBe("Error: TypeScriptSourceParser is closed")
      await noNativeProcessLeft(before)
    } finally {
      await parser.close().catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
