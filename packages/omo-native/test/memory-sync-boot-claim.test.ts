import { describe, expect, test } from "bun:test"
import { type ChildProcess, spawn } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Duplex } from "node:stream"
import { pathToFileURL } from "node:url"
import { readFrames, writeFrame } from "../../omo-senpi/src/components/memory/desktop-sync/framing"

// `omo host ensure` starts a `--mode rpc --multi-session --listen` engine, and senpi loads extensions there only on
// open_session or warm; the desktop waits for the bootstrap frame before it opens anything. These launches open no
// session until the frame arrived, through both omo entries that start that engine: the compiled entry (run from
// source, the same branch as the binary) and the npm launcher.
const PACKAGE_ROOT = resolve(import.meta.dir, "..")
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..")
const senpiRoot = dirname(createRequire(import.meta.url).resolve("@code-yeongyu/senpi/package.json"))
const fixture = join(REPO_ROOT, "packages", "omo-senpi", "src", "components", "memory", "index-engine.fixture.ts")
const BOOTSTRAP_DEADLINE_MS = 10_000
const STEP_MS = 120_000

type Frame = {
  readonly id: number
  readonly op: string
  readonly capability?: string
  readonly request?: { readonly op: string }
}
type Entry = "compiled" | "npm"
type RpcClientLike = {
  start(): Promise<void>
  stop(): Promise<void>
  openSession(options: { cwd: string }): Promise<unknown>
  requestExtension(name: string, data: unknown): Promise<unknown>
}

function bounded<T>(promise: Promise<T>, ms: number, what: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what())), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

/**
 * A throwaway npm install of this package: the real launcher, this checkout's engine, and a plugin whose one
 * extension is the memory fixture beside the built device-account sidecar the launcher's boot claim loads.
 */
function npmPackage(home: string): string {
  const root = join(home, "pkg")
  const extensions = join(root, "plugin", "extensions")
  mkdirSync(extensions, { recursive: true })
  cpSync(join(PACKAGE_ROOT, "bin"), join(root, "bin"), { recursive: true })
  cpSync(join(PACKAGE_ROOT, "package.json"), join(root, "package.json"))
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"))
  symlinkSync(
    join(REPO_ROOT, "packages", "omo-senpi", "plugin", "extensions", "omo-device-account.js"),
    join(extensions, "omo-device-account.js"),
  )
  symlinkSync(fixture, join(extensions, "memory-fixture.ts"))
  writeFileSync(
    join(root, "plugin", "package.json"),
    JSON.stringify({
      name: "omo-boot-claim-fixture",
      private: true,
      type: "module",
      pi: { extensions: ["./extensions/memory-fixture.ts"] },
    }),
  )
  return root
}

function launchHost(entry: Entry, table: string | undefined) {
  const home = mkdtempSync(join(tmpdir(), "omo-boot-"))
  mkdirSync(join(home, "tmp"))
  const agentDir = join(home, "agent")
  const socket = join(home, "h.sock")
  // A fresh environment: variables other test files set in this process must not steer the launch.
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: join(home, "tmp"),
    OMO_MEMORY_HOME: join(home, "memory"),
    OMO_CODING_AGENT_DIR: agentDir,
    SENPI_CODING_AGENT_DIR: agentDir,
    ...(table === undefined ? {} : { SENPI_PRIVATE_FDS: table }),
    // The supervisor marks its engine child's hop final; the npm launcher is an earlier hop and never does.
    ...(table !== undefined && entry === "compiled" ? { SENPI_PRIVATE_FDS_FINAL: "1" } : {}),
  }
  const engineArgs = ["--mode", "rpc", "--multi-session", "--listen", `unix://${socket}`]
  // The compiled entry takes the caller's extension list as given; the npm launcher always adds its own plugin.
  const argv =
    entry === "compiled"
      ? [join(PACKAGE_ROOT, "compile-entry.ts"), ...engineArgs, "--no-extensions", "-e", fixture]
      : [join(npmPackage(home), "bin", "omo.js"), ...engineArgs]
  // Its own process group: the compiled entry's trust stage can re-run the same argv as a child (import-exec), so the
  // engine may be a grandchild that a signal to this pid alone would orphan.
  const child: ChildProcess = spawn(process.execPath, argv, {
    cwd: home,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe", "ignore", "ignore", "pipe"],
  })
  let stderr = ""
  let stdout = ""
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString()
  })
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString()
  })
  const listening = Promise.withResolvers<void>()
  child.stdout?.on("data", () => {
    if (stdout.includes("listening on")) listening.resolve()
  })
  child.stderr?.on("data", () => {
    if (stderr.includes("listening on")) listening.resolve()
  })
  const exited = new Promise<void>((done) => child.once("exit", () => done()))
  const channel: unknown = Reflect.get(child.stdio, 5)
  if (!(channel instanceof Duplex)) throw new Error("missing the memory-sync socket")
  const frames: Frame[] = []
  const bootstrapped = Promise.withResolvers<void>()
  readFrames(
    channel,
    (packet) => {
      const frame = packet as Frame
      frames.push(frame)
      if (frame.op === "bootstrap") {
        writeFrame(channel, { id: frame.id, ok: true, value: { child: "engine-child" } })
        bootstrapped.resolve()
      } else {
        writeFrame(channel, { id: frame.id, ok: false })
      }
    },
    () => {},
  )
  const log = () => `engine stderr: ${stderr.slice(-1500)}`
  let client: RpcClientLike | undefined
  return {
    frames,
    log,
    bootstrapped: () =>
      bounded(
        bootstrapped.promise,
        BOOTSTRAP_DEADLINE_MS,
        () => `no bootstrap frame within ${BOOTSTRAP_DEADLINE_MS / 1000}s and no session was opened; ${log()}`,
      ),
    /** Opens the first session (the extension registration runs only now) and asks the fixture for its selection. */
    async selectionAfterSession(): Promise<unknown> {
      await bounded(listening.promise, STEP_MS, () => `the host never listened; ${log()}`)
      const { RpcClient } = (await import(
        pathToFileURL(join(senpiRoot, "dist", "modes", "rpc", "rpc-client.js")).href
      )) as { RpcClient: new (options: { socketPath: string }) => RpcClientLike }
      const keyRoot = process.env.SENPI_RPC_KEY_ROOT
      process.env.SENPI_RPC_KEY_ROOT = agentDir
      try {
        client = new RpcClient({ socketPath: socket })
        await bounded(client.start(), STEP_MS, () => `could not connect; ${log()}`)
        await bounded(client.openSession({ cwd: home }), STEP_MS, () => `open_session never answered; ${log()}`)
      } finally {
        if (keyRoot === undefined) delete process.env.SENPI_RPC_KEY_ROOT
        else process.env.SENPI_RPC_KEY_ROOT = keyRoot
      }
      return bounded(
        client.requestExtension("fixture.memory-sync.selection", {}),
        STEP_MS,
        () => `selection call never answered; ${log()}`,
      )
    },
    syncStatus: () => {
      if (!client) throw new Error("sync status requested before the session opened")
      return bounded(
        client.requestExtension("omo.memory.sync.status", {}),
        STEP_MS,
        () => `sync status never answered; ${log()}`,
      )
    },
    async close() {
      await client?.stop().catch(() => undefined)
      channel.destroy()
      if (child.exitCode === null && child.signalCode === null && child.pid !== undefined)
        process.kill(-child.pid, "SIGKILL")
      await bounded(exited, 30_000, () => `pid ${child.pid} did not exit`)
      rmSync(home, { recursive: true, force: true })
    },
  }
}

for (const entry of ["compiled", "npm"] as const) {
  // POSIX only: this launches the engine with one inherited socket at fd 5 and kills its process group, neither of
  // which has a win32 form. The win32 boot claim over the two-pipe pair is proven through the packaged desktop runtime
  // (omo-desktop-app's real-engine memory-sync chain job); a win32 version here is tracked in #12698.
  describe.skipIf(process.platform === "win32")(
    `the ${entry} entry claims memory sync when a multi-session engine boots`,
    () => {
      test("the bootstrap frame arrives before any session, and the first session reuses that one claim", async () => {
        const launch = launchHost(entry, '{"memory-sync":5}')
        try {
          await launch.bootstrapped()
          // A second claim could not take the descriptor again and would answer unavailable: desktop proves reuse.
          expect(await launch.selectionAfterSession()).toEqual({ kind: "desktop" })
          await launch.syncStatus()
          expect(launch.frames).toEqual([
            { id: 1, op: "bootstrap" },
            { id: 2, op: "request", capability: "engine-child", request: { op: "descriptor" } },
          ])
        } finally {
          await launch.close()
        }
      }, 300_000)

      test("a launch without a memory-sync entry gets no frame and its first session still selects the CLI source", async () => {
        const launch = launchHost(entry, undefined)
        try {
          expect(await launch.selectionAfterSession()).toEqual({ kind: "cli" })
          expect(launch.frames).toEqual([])
        } finally {
          await launch.close()
        }
      }, 300_000)
    },
  )
}
