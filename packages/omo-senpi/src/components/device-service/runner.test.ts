import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BootstrapWorkerTimeout, runBootstrapWorker } from "./runner"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dsr-"))
  dirs.push(dir)
  return dir
}

// A stand-in omo whose answer echoes the arguments it was started with, so the argv is part of the observed result.
const launcherScript = (body: string): string => {
  const path = join(scratch(), "omo.js")
  writeFileSync(path, body)
  return path
}

describe("the omo remote bootstrap worker", () => {
  test("an npm launcher (omo.js) runs under this runtime with `remote bootstrap --json` and its last JSON line is the report", async () => {
    const omoBin = launcherScript(
      'console.log("noise first")\nconsole.log(JSON.stringify({ state: "update_required", notice: process.argv.slice(2).join(" ") }))\nprocess.exitCode = 3\n',
    )
    expect(await runBootstrapWorker(omoBin)).toEqual({ state: "update_required", notice: "remote bootstrap --json" })
  })

  test.skipIf(process.platform === "win32")("a compiled omo binary runs directly", async () => {
    const path = join(scratch(), "omo")
    writeFileSync(path, '#!/bin/sh\nprintf \'{"state":"service_degraded","notice":"%s"}\\n\' "$*"\n')
    chmodSync(path, 0o755)
    expect(await runBootstrapWorker(path)).toEqual({ state: "service_degraded", notice: "remote bootstrap --json" })
  })

  test.each([
    ["output that is not a report", 'console.log("not json")\n'],
    ["a report without a state", 'console.log(JSON.stringify({ notice: "x" }))\n'],
    ["a stop without a notice", 'console.log(JSON.stringify({ state: "keychain_locked" }))\n'],
    ["no output at all", "process.exit(1)\n"],
  ])("%s is no report", async (_label, body) => {
    expect(await runBootstrapWorker(launcherScript(body))).toBeUndefined()
  })

  test("a worker that never finishes is killed at its deadline and rejects as timed out", async () => {
    const pidDir = scratch()
    const pidFile = join(pidDir, "pid")
    const started = new Promise<void>((resolve, reject) => {
      const watcher = watch(pidDir, () => {
        if (!existsSync(pidFile)) return
        watcher.close()
        resolve()
      })
      setTimeout(() => {
        watcher.close()
        reject(new Error("waited 10 s for the stand-in omo to start, it never did"))
      }, 10_000).unref()
    })
    const omoBin = launcherScript(`require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`)
    let expire: (() => void) | undefined
    const outcome = runBootstrapWorker(omoBin, { schedule: run => { expire = run; return () => {} } }).catch((error: unknown) => error)
    await started
    expire?.()
    expect(await outcome).toBeInstanceOf(BootstrapWorkerTimeout)
    expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow()
  })

  test("an omo binary that cannot start rejects with the spawn error", async () => {
    await expect(runBootstrapWorker(join(scratch(), "missing-omo"))).rejects.toThrow("ENOENT")
  })
})
