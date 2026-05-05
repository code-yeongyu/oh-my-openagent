import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process"
import { Readable, Writable } from "node:stream"

type AnyRecord = Record<string, unknown>
type StdioMode = "pipe" | "inherit" | "ignore"
type StdioTuple = [StdioMode, StdioMode, StdioMode]

export interface SpawnOptions {
  cmd?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: StdioMode
  stdout?: StdioMode
  stderr?: StdioMode
  stdio?: StdioTuple
  detached?: boolean
}

export interface SpawnedProcess {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly stdin: NodeJS.WritableStream
  readonly pid: number | undefined
  kill(signal?: NodeJS.Signals): void
  ref(): void
  unref(): void
}

export interface SpawnSyncResult {
  readonly exitCode: number
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly success: boolean
  readonly pid: number
}

type BunSpawnRuntime = {
  spawn(command: string[], options?: SpawnOptions): SpawnedProcess
  spawn(options: SpawnOptions & { cmd: string[] }): SpawnedProcess
  spawnSync(command: string[], options?: SpawnOptions): SpawnSyncResult
  spawnSync(options: SpawnOptions & { cmd: string[] }): SpawnSyncResult
}

const runtime = globalThis as typeof globalThis & { Bun?: BunSpawnRuntime }
const IS_BUN = typeof runtime.Bun !== "undefined"

function emptyReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> {
  if (!stream) return emptyReadableStream()

  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}

function emptyWritableStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}

function resolveCommand(cmdOrOpts: unknown, optsArg?: unknown): { cmd: string[]; opts: SpawnOptions } {
  const isObj = !Array.isArray(cmdOrOpts)
  const opts = isObj ? (cmdOrOpts as SpawnOptions) : ((optsArg ?? {}) as SpawnOptions)

  return {
    cmd: isObj ? ((cmdOrOpts as AnyRecord).cmd as string[]) : (cmdOrOpts as string[]),
    opts,
  }
}

function resolveStdio(options: SpawnOptions): StdioTuple {
  if (options.stdio) return options.stdio

  return [options.stdin ?? "pipe", options.stdout ?? "pipe", options.stderr ?? "pipe"]
}

function wrapNodeProcess(proc: ReturnType<typeof nodeSpawn>): SpawnedProcess {
  let exitCode: number | null = null
  const exited = new Promise<number>((resolve) => {
    proc.on("exit", (code) => {
      exitCode = code ?? 1
      resolve(exitCode)
    })
    proc.on("error", () => {
      if (exitCode === null) {
        exitCode = 1
        resolve(1)
      }
    })
  })

  return {
    get exitCode() {
      return exitCode
    },
    exited,
    stdout: toReadableStream(proc.stdout),
    stderr: toReadableStream(proc.stderr),
    stdin: proc.stdin ?? emptyWritableStream(),
    kill(signal?: NodeJS.Signals) {
      if (proc.killed || exitCode !== null) return

      try {
        proc.kill(signal)
      } catch (error) {
        if (!String(error).includes("kill")) throw error
      }
    },
    pid: proc.pid,
    ref() {
      proc.ref()
    },
    unref() {
      proc.unref()
    },
  }
}

export function spawn(command: string[], options?: SpawnOptions): SpawnedProcess
export function spawn(options: SpawnOptions & { cmd: string[] }): SpawnedProcess
export function spawn(cmdOrOpts: unknown, opts?: unknown): SpawnedProcess {
  if (IS_BUN) return runtime.Bun!.spawn(cmdOrOpts as string[] & SpawnOptions & { cmd: string[] }, opts as SpawnOptions)

  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const [bin, ...args] = cmd
  const proc = nodeSpawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: resolveStdio(options),
    detached: options.detached,
  })

  return wrapNodeProcess(proc)
}

export function spawnSync(command: string[], options?: SpawnOptions): SpawnSyncResult
export function spawnSync(options: SpawnOptions & { cmd: string[] }): SpawnSyncResult
export function spawnSync(cmdOrOpts: unknown, opts?: unknown): SpawnSyncResult {
  if (IS_BUN) return runtime.Bun!.spawnSync(cmdOrOpts as string[] & SpawnOptions & { cmd: string[] }, opts as SpawnOptions)

  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const [bin, ...args] = cmd
  const result = nodeSpawnSync(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: resolveStdio(options),
  })

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    success: (result.status ?? 1) === 0,
    pid: -1,
  }
}
