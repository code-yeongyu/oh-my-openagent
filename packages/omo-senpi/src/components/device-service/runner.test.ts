import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

  // The promise settles only on the child's close event, so the timeout rejection itself proves the child exited.
  test("a worker that never finishes is stopped at its deadline and rejects as timed out", async () => {
    const omoBin = launcherScript("setInterval(() => {}, 1000)\n")
    const atOnce = (expire: () => void) => {
      expire()
      return () => {}
    }
    await expect(runBootstrapWorker(omoBin, { schedule: atOnce })).rejects.toBeInstanceOf(BootstrapWorkerTimeout)
  })

  // A child that ignores SIGTERM (the account read turns it into an abort while `run()` is active)
  // must still be stopped: the deadline escalates to SIGKILL after a short grace period. Without
  // the escalation the promise never settles, so this test fails by timeout on the pre-fix code.
  // The child prints "ready" only after its SIGTERM handler is installed, and the deadline fires
  // on that signal rather than after a fixed delay: a fixed delay assumes the handler is ready by
  // then, and on a slow start SIGTERM alone kills the child before the handler exists, so the test
  // would pass without ever proving the SIGKILL step. The grace is injected at 100 ms so the test
  // no longer waits out the production 5 s. The 15 s budget is headroom for a slow start; Bun
  // resets the default timeout to 5 s for later files of a multi-file run.
  test(
    "a worker that ignores SIGTERM is killed at its deadline and rejects as timed out",
    async () => {
      const omoBin = launcherScript(
        "process.on('SIGTERM', () => {})\nconsole.log(\"ready\")\nsetInterval(() => {}, 1000)\n",
      )
      const afterReady = (expire: () => void, ready?: Promise<void>) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let cancelled = false
        void ready?.then(() => {
          if (!cancelled) timer = setTimeout(expire, 0)
        })
        return () => {
          cancelled = true
          if (timer !== undefined) clearTimeout(timer)
        }
      }
      await expect(
        runBootstrapWorker(omoBin, { schedule: afterReady, readySignal: "ready", sigkillGraceMs: 100 }),
      ).rejects.toBeInstanceOf(BootstrapWorkerTimeout)
    },
    15_000,
  )

  // Bun words a missing executable differently per OS (POSIX "ENOENT", Windows "Executable not found in $PATH").
  test("an omo binary that cannot start rejects with the spawn error", async () => {
    const failure = await runBootstrapWorker(join(scratch(), "missing-omo")).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(BootstrapWorkerTimeout)
    const { code, message } = failure as NodeJS.ErrnoException
    expect(`${code ?? ""} ${message}`).toMatch(/ENOENT|Executable not found/)
  })
})
