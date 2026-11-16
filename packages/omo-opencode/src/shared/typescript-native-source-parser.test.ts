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

describe("TypeScriptSourceParser after its native process is killed", () => {
  test("#given a parse started the native process #when that process is killed as a timed-out test's child #then the next parse gets a live parser", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-native-parser-"))
    const file = join(dir, "a.ts")
    writeFileSync(file, "export const answer = 42\n")
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["a.ts"] }))
    const before = new Set(nativeChildren())
    const parser = new TypeScriptSourceParser(dir)
    try {
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
      const started = nativeChildren().filter((pid) => !before.has(pid))
      expect(started.length).toBe(1)
      const [pid] = started
      if (pid === undefined) throw new Error("no native parser process started")
      process.kill(pid, "SIGKILL")
      // The child is gone once this process has reaped it; each turn of the event loop lets that (and the closing of its
      // pipes) happen. Bounded: the kill is SIGKILL, so it cannot outlive this deadline.
      const deadline = Date.now() + 5_000
      while (alive(pid)) {
        if (Date.now() > deadline) throw new Error(`native parser process ${pid} still alive 5 s after SIGKILL`)
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect([...(await parser.parse([file])).keys()]).toEqual([file])
    } finally {
      await parser.close().catch(() => undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
