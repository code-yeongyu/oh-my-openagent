import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const CHILD_PROCESS_MODULE = join(SOURCE_ROOT, "bin", "lib", "child-process.js")
const BUN_RUNTIME_MODULE = join(SOURCE_ROOT, "bin", "lib", "bun-runtime.js")
const roots: string[] = []

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-signal-"))
  roots.push(root)
  return root
}

/**
 * A child that survives the signal it is sent: it records the signal, stays alive long enough for
 * the parent's grace window to be observable, then exits with a code of its own choosing. This is
 * the engine's shape - a graceful shutdown takes time and must not be cut short by the launcher.
 */
function gracefulChildSource(options: { exitCode: number; drainMs: number }): string {
  return `
import { appendFileSync } from "node:fs"
const record = process.env.SIGNAL_LOG
for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
  process.on(signal, () => {
    appendFileSync(record, signal + "\\n")
    setTimeout(() => process.exit(${options.exitCode}), ${options.drainMs})
  })
}
appendFileSync(process.env.READY_FILE, "ready\\n")
setInterval(() => {}, 1000)
`
}

/**
 * A child that swallows the signal and never leaves: the launcher must not wait on it forever.
 */
function ignoringChildSource(): string {
  return `
import { appendFileSync } from "node:fs"
for (const signal of ["SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    appendFileSync(process.env.SIGNAL_LOG, signal + "\\n")
  })
}
appendFileSync(process.env.READY_FILE, "ready\\n")
setInterval(() => {}, 1000)
`
}

/**
 * A child that dies from the signal itself (default disposition), so the parent has to translate a
 * signal death back into its own signal death rather than into an exit code.
 */
function signalDeathChildSource(): string {
  return `
import { appendFileSync } from "node:fs"
appendFileSync(process.env.READY_FILE, "ready\\n")
setInterval(() => {}, 1000)
`
}

/**
 * Drives the real helper in a real child process: only a separate process can be signaled and can
 * observe its own exit status, and the whole contract is about what happens to a process that is
 * signaled while it waits on a child.
 */
function parentSource(childPath: string, args: string[] = []): string {
  return `
import { spawnNode } from ${JSON.stringify(CHILD_PROCESS_MODULE)}
import { appendFileSync } from "node:fs"
await spawnNode(${JSON.stringify(childPath)}, ${JSON.stringify(args)})
appendFileSync(process.env.PARENT_LOG, "exitCode=" + String(process.exitCode) + "\\n")
`
}

type ParentRun = {
  pid: number
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

function startParent(parentPath: string, env: NodeJS.ProcessEnv): ParentRun {
  const child = spawn(process.execPath, [parentPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  })
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on("exit", (code, signal) => resolveExit({ code, signal }))
  })
  return { pid: child.pid ?? -1, exit }
}

async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForContent(path: string, expected: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8")
      if (content.includes(expected)) return content
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`timed out waiting for ${expected} in ${path}: ${existsSync(path) ? readFileSync(path, "utf8") : "<absent>"}`)
}

type Harness = {
  parentPath: string
  signalLog: string
  readyFile: string
  parentLog: string
  env: NodeJS.ProcessEnv
}

function createHarness(childSource: string): Harness {
  const root = createRoot()
  const childPath = join(root, "child.mjs")
  writeFile(childPath, childSource)
  const parentPath = join(root, "parent.mjs")
  writeFile(parentPath, parentSource(childPath))
  const signalLog = join(root, "signals.log")
  const readyFile = join(root, "ready")
  const parentLog = join(root, "parent.log")
  return {
    parentPath,
    signalLog,
    readyFile,
    parentLog,
    env: { SIGNAL_LOG: signalLog, READY_FILE: readyFile, PARENT_LOG: parentLog },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const describePosix = process.platform === "win32" ? describe.skip : describe

describePosix("launcher child signal forwarding", () => {
  for (const signal of ["SIGTERM", "SIGHUP"] as const) {
    describe(`#given a launcher waiting on an engine child #when the launcher receives ${signal}`, () => {
      test(`#then the child receives ${signal} and drains before the launcher exits`, async () => {
        const harness = createHarness(gracefulChildSource({ exitCode: 0, drainMs: 300 }))
        const parent = startParent(harness.parentPath, harness.env)
        await waitForFile(harness.readyFile)

        process.kill(parent.pid, signal)

        const recorded = await waitForContent(harness.signalLog, signal)
        expect(recorded).toContain(signal)
        const result = await parent.exit
        // The child owned its own shutdown and exited 0, so that is the answer the launcher
        // reports: the launcher waited instead of dying underneath it.
        expect(result.code).toBe(0)
        expect(readFileSync(harness.parentLog, "utf8")).toContain("exitCode=0")
      }, 30_000)

      test(`#then a child that ignores ${signal} still ends the launcher by ${signal} after the grace window`, async () => {
        const harness = createHarness(ignoringChildSource())
        const parent = startParent(harness.parentPath, { ...harness.env, OMO_SIGNAL_GRACE_MS: "400" })
        await waitForFile(harness.readyFile)

        process.kill(parent.pid, signal)

        const result = await parent.exit
        // The launcher re-raises the signal on itself so its own parent sees the death it asked
        // for instead of a launcher that hangs on a child that refuses to leave.
        expect(result.signal).toBe(signal)
      }, 30_000)
    })
  }

  describe("#given a launcher waiting on an engine child #when the launcher receives SIGINT", () => {
    test("#then the launcher never forwards it a second time and still waits for the child", async () => {
      // SIGINT from a terminal is delivered to the whole foreground process group, so the child has
      // already been interrupted; forwarding again would double-interrupt the engine. The launcher
      // must still not die underneath a child that is mid-shutdown, or that child is orphaned.
      const harness = createHarness(gracefulChildSource({ exitCode: 0, drainMs: 200 }))
      const parent = startParent(harness.parentPath, harness.env)
      await waitForFile(harness.readyFile)

      process.kill(parent.pid, "SIGINT")
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))

      const recorded = existsSync(harness.signalLog) ? readFileSync(harness.signalLog, "utf8") : ""
      expect(recorded).not.toContain("SIGINT")
      // The child is untouched and still running, so the launcher is still waiting on it.
      expect(await Promise.race([parent.exit, Promise.resolve("running")])).toBe("running")
      process.kill(parent.pid, "SIGKILL")
      await parent.exit
    }, 30_000)
  })

  describe("#given an engine child that exits on its own #when it returns a non-zero code", () => {
    test("#then the launcher exits with the same code", async () => {
      const root = createRoot()
      const childPath = join(root, "child.mjs")
      writeFile(childPath, "process.exit(7)\n")
      const parentPath = join(root, "parent.mjs")
      writeFile(parentPath, parentSource(childPath))
      const parentLog = join(root, "parent.log")
      const parent = startParent(parentPath, { PARENT_LOG: parentLog })
      const result = await parent.exit
      expect(result.code).toBe(7)
    }, 30_000)
  })

  describe("#given an engine child killed by a signal #when the launcher propagates the result", () => {
    test("#then the launcher dies by that same signal", async () => {
      const root = createRoot()
      const childPath = join(root, "child.mjs")
      writeFile(childPath, signalDeathChildSource())
      const parentPath = join(root, "parent.mjs")
      writeFile(parentPath, parentSource(childPath))
      const readyFile = join(root, "ready")
      const parent = startParent(parentPath, { READY_FILE: readyFile, PARENT_LOG: join(root, "parent.log") })
      await waitForFile(readyFile)

      // The child is the only member of the launcher's descendant tree here, so killing it by pid
      // exercises the death-by-signal path without signaling the launcher.
      const listed = Bun.spawnSync(["pgrep", "-P", String(parent.pid)])
      const childPid = Number(listed.stdout.toString().trim().split("\n")[0])
      expect(childPid).toBeGreaterThan(0)
      process.kill(childPid, "SIGKILL")

      const result = await parent.exit
      expect(result.signal).toBe("SIGKILL")
    }, 30_000)
  })

  describe("#given a launcher that re-execed itself under bun #when the launcher receives SIGTERM", () => {
    test("#then the re-exec layer forwards it to the runtime child too", async () => {
      // The chain blocks at two layers; a launcher that only forwards from the inner one still
      // orphans the engine whenever the outer node process is the one holding the child.
      const root = createRoot()
      const childPath = join(root, "child.mjs")
      writeFile(childPath, gracefulChildSource({ exitCode: 0, drainMs: 200 }))
      // The re-exec spawns whatever `bun` resolves to; a link to this runtime's own interpreter
      // makes the child a real, signalable process without depending on a bun install.
      const binDir = join(root, "bin")
      mkdirSync(binDir, { recursive: true })
      symlinkSync(process.execPath, join(binDir, "bun"))
      const parentPath = join(root, "parent.mjs")
      writeFile(
        parentPath,
        `
import { maybeReexecUnderBun } from ${JSON.stringify(BUN_RUNTIME_MODULE)}
await maybeReexecUnderBun({
  scriptPath: ${JSON.stringify(childPath)},
  argv: ["node", ${JSON.stringify(childPath)}],
  env: { OMO_RUNTIME: "bun", PATH: ${JSON.stringify(binDir)} },
  versions: {},
  homedir: () => ${JSON.stringify(join(root, "home"))},
})
`,
      )
      const signalLog = join(root, "signals.log")
      const readyFile = join(root, "ready")
      const parent = startParent(parentPath, {
        SIGNAL_LOG: signalLog,
        READY_FILE: readyFile,
        PARENT_LOG: join(root, "parent.log"),
      })
      await waitForFile(readyFile)

      process.kill(parent.pid, "SIGTERM")

      expect(await waitForContent(signalLog, "SIGTERM")).toContain("SIGTERM")
      expect((await parent.exit).code).toBe(0)
    }, 30_000)
  })
})
