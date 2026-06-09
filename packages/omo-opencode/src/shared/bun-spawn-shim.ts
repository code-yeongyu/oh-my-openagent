import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions as NodeSpawnOptions,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
} from "node:child_process"
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
  signal?: AbortSignal
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
  readonly stdout: Buffer | undefined
  readonly stderr: Buffer | undefined
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

function getBunRuntime(): BunSpawnRuntime | undefined {
  return typeof Bun === "undefined" ? undefined : runtime.Bun
}

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

  return [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "inherit"]
}

export function createNodeSpawnOptions(
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform
): NodeSpawnOptions {
  const nodeOptions: NodeSpawnOptions = {
    stdio: resolveStdio(options),
    shell: false,
  }

  if (options.cwd !== undefined) nodeOptions.cwd = options.cwd
  if (options.env !== undefined) nodeOptions.env = options.env
  if (options.detached !== undefined) nodeOptions.detached = options.detached
  if (options.signal !== undefined) nodeOptions.signal = options.signal

  if (platform === "win32") {
    // #3919: Windows Desktop utility processes must hide child consoles when spawning tools.
    nodeOptions.windowsHide = true
  }

  return nodeOptions
}

export function createNodeSpawnSyncOptions(
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform
): NodeSpawnSyncOptions {
  const nodeOptions: NodeSpawnSyncOptions = {
    stdio: resolveStdio(options),
    shell: false,
  }

  if (options.cwd !== undefined) nodeOptions.cwd = options.cwd
  if (options.env !== undefined) nodeOptions.env = options.env

  if (platform === "win32") {
    // #3919: Match async spawn so Windows sync probes do not surface a console window.
    nodeOptions.windowsHide = true
  }

  return nodeOptions
}

function wrapNodeProcess(proc: ReturnType<typeof nodeSpawn>): SpawnedProcess {
  let exitCode: number | null = null
  const exited = new Promise<number>((resolve, reject) => {
    proc.on("exit", (code) => {
      exitCode = code ?? 1
      resolve(exitCode)
    })
    proc.on("error", (error) => {
      if (exitCode === null) {
        exitCode = 1
        reject(error)
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

function toSpawnSyncBuffer(output: Buffer | string | null): Buffer | undefined {
  if (output === null) {
    return undefined
  }

  return Buffer.isBuffer(output) ? output : Buffer.from(output, "utf8")
}

export function spawn(command: string[], options?: SpawnOptions): SpawnedProcess
export function spawn(options: SpawnOptions & { cmd: string[] }): SpawnedProcess
export function spawn(cmdOrOpts: unknown, opts?: unknown): SpawnedProcess {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const bun = getBunRuntime()
  if (bun) return bun.spawn(cmd, options)

  const [bin, ...args] = cmd
  if (bin === undefined) {
    throw new Error("Cannot spawn an empty command")
  }

  const proc = nodeSpawn(bin, args, createNodeSpawnOptions(options))

  return wrapNodeProcess(proc)
}

export function spawnSync(command: string[], options?: SpawnOptions): SpawnSyncResult
export function spawnSync(options: SpawnOptions & { cmd: string[] }): SpawnSyncResult
export function spawnSync(cmdOrOpts: unknown, opts?: unknown): SpawnSyncResult {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const bun = getBunRuntime()
  if (bun) return bun.spawnSync(cmd, options)

  const [bin, ...args] = cmd
  if (bin === undefined) {
    throw new Error("Cannot spawnSync an empty command")
  }

  const result = nodeSpawnSync(bin, args, createNodeSpawnSyncOptions(options))

  return {
    exitCode: result.status ?? 1,
    stdout: toSpawnSyncBuffer(result.stdout),
    stderr: toSpawnSyncBuffer(result.stderr),
    success: (result.status ?? 1) === 0,
    pid: result.pid ?? -1,
  }
}
