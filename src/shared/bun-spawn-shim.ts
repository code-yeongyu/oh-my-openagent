/**
 * Node/Electron-compatible spawn shim.
 *
 * Replaces direct `import { spawn } from "bun"` throughout the codebase so
 * that `bun build --target bun` no longer emits top-level
 *   var { spawn } = globalThis.Bun;
 * destructures that crash on Node/Electron (where globalThis.Bun is undefined).
 *
 * On real Bun runtime:  delegates straight to Bun.spawn / Bun.spawnSync.
 * On Node/Electron:     backed by node:child_process (via static ESM imports
 *                       which are safe in both runtimes).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process"
import { Readable } from "node:stream"

const IS_BUN = typeof globalThis.Bun !== "undefined"

function _resolveCmd(cmdOrOpts: any, optsArg?: any): { cmd: string[]; opts: any } {
  const isObj = !Array.isArray(cmdOrOpts)
  return {
    cmd: isObj ? (cmdOrOpts as any).cmd : (cmdOrOpts as string[]),
    opts: isObj ? cmdOrOpts : (optsArg ?? {}),
  }
}

function _wrapNodeProc(proc: ReturnType<typeof nodeSpawn>): any {
  let code: number | null = null
  const exited = new Promise<number>((resolve) => {
    proc.on("exit", (c) => { code = c ?? 1; resolve(code) })
    proc.on("error", () => { if (code === null) { code = 1; resolve(1) } })
  })
  return {
    get exitCode() { return code },
    exited,
    stdout: proc.stdout ? Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array> : undefined,
    stderr: proc.stderr ? Readable.toWeb(proc.stderr) as ReadableStream<Uint8Array> : undefined,
    stdin: proc.stdin,
    kill(s?: NodeJS.Signals) { try { proc.kill(s) } catch {} },
    pid: proc.pid,
  }
}

export function spawn(cmdOrOpts: any, opts?: any): any {
  if (IS_BUN) return (globalThis.Bun as any).spawn(cmdOrOpts, opts)
  const { cmd, opts: o } = _resolveCmd(cmdOrOpts, opts)
  const [bin, ...args] = cmd
  const proc = nodeSpawn(bin, args, {
    cwd: o.cwd as string | undefined,
    env: o.env as NodeJS.ProcessEnv | undefined,
    stdio: [(o.stdin ?? "pipe") as any, (o.stdout ?? "pipe") as any, (o.stderr ?? "pipe") as any],
  })
  return _wrapNodeProc(proc)
}

export function spawnSync(cmdOrOpts: any, _opts?: any): any {
  if (IS_BUN) return (globalThis.Bun as any).spawnSync(cmdOrOpts)
  const { cmd, opts: o } = _resolveCmd(cmdOrOpts)
  const [bin, ...args] = cmd
  const r = nodeSpawnSync(bin, args, {
    cwd: o.cwd as string | undefined,
    env: o.env as NodeJS.ProcessEnv | undefined,
    stdio: ["pipe", "pipe", "pipe"],
  })
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr, success: (r.status ?? 1) === 0, pid: -1 }
}
