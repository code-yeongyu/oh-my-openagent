/**
 * Electron/Node runtime compatibility shim.
 *
 * OpenCode Desktop runs the plugin in an Electron renderer/main process
 * whose ESM loader is Node — not Bun. When bundled with `--target bun`,
 * every chunk that calls `Bun.spawn` / `Bun.spawnSync` emits a top-level
 * `var { spawn } = globalThis.Bun` destructure. On Node/Electron,
 * `globalThis.Bun` is `undefined`, so module evaluation crashes before any
 * plugin hook is ever reached.
 *
 * We patch globalThis.Bun at module-evaluation time so the destructures
 * resolve to real functions backed by node:child_process.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const _cp = require("node:child_process") as typeof import("node:child_process")
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _stream = require("node:stream") as typeof import("node:stream")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

function _makeProc(proc: ReturnType<typeof _cp.spawn>) {
  let _exitCode: number | null = null
  const exited = new Promise<number>((resolve) => {
    proc.on("exit", (code) => { _exitCode = code ?? 1; resolve(_exitCode) })
    proc.on("error", () => { if (_exitCode === null) { _exitCode = 1; resolve(1) } })
  })
  return {
    get exitCode() { return _exitCode },
    exited,
    stdout: proc.stdout ? (_stream.Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>) : undefined,
    stderr: proc.stderr ? (_stream.Readable.toWeb(proc.stderr) as ReadableStream<Uint8Array>) : undefined,
    stdin: proc.stdin,
    kill(sig?: NodeJS.Signals) { try { proc.kill(sig) } catch {} },
    pid: proc.pid,
  }
}

function _spawnShim(cmdOrOpts: string[] | AnyRecord, optsArg?: AnyRecord) {
  const isObj = !Array.isArray(cmdOrOpts)
  const cmd: string[] = isObj ? (cmdOrOpts as AnyRecord)["cmd"] as string[] : (cmdOrOpts as string[])
  const o: AnyRecord = isObj ? (cmdOrOpts as AnyRecord) : (optsArg ?? {})
  const [bin, ...args] = cmd
  const proc = _cp.spawn(bin, args, {
    cwd: o["cwd"] as string | undefined,
    env: o["env"] as NodeJS.ProcessEnv | undefined,
    stdio: [(o["stdin"] ?? "pipe") as "pipe", (o["stdout"] ?? "pipe") as "pipe", (o["stderr"] ?? "pipe") as "pipe"],
  })
  return _makeProc(proc)
}

function _spawnSyncShim(cmdOrOpts: string[] | AnyRecord) {
  const isObj = !Array.isArray(cmdOrOpts)
  const cmd: string[] = isObj ? (cmdOrOpts as AnyRecord)["cmd"] as string[] : (cmdOrOpts as string[])
  const o: AnyRecord = isObj ? (cmdOrOpts as AnyRecord) : {}
  const [bin, ...args] = cmd
  const r = _cp.spawnSync(bin, args, {
    cwd: o["cwd"] as string | undefined,
    env: o["env"] as NodeJS.ProcessEnv | undefined,
    stdio: ["pipe", "pipe", "pipe"],
  })
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

if (!globalThis.Bun) {
  // @ts-expect-error – intentional globalThis shim for Electron/Node compat
  globalThis.Bun = {
    spawn: _spawnShim as unknown as typeof globalThis.Bun.spawn,
    spawnSync: _spawnSyncShim as unknown as typeof globalThis.Bun.spawnSync,
    env: process.env,
    version: "0.0.0-node-shim",
  }
}
