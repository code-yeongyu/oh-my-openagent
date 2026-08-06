import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type SpawnOptions as NodeSpawnOptions,
  type SpawnSyncOptions as NodeSpawnSyncOptions,
} from "node:child_process"
import { Writable } from "node:stream"

type StdioMode = "pipe" | "inherit" | "ignore"
type StdioTuple = [StdioMode, StdioMode, StdioMode]

export interface SpawnOptions {
  readonly cmd?: readonly string[]
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly stdin?: StdioMode
  readonly stdout?: StdioMode
  readonly stderr?: StdioMode
  readonly stdio?: StdioTuple
  readonly detached?: boolean
  readonly signal?: AbortSignal
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

type BunSpawnedProcess = Omit<
  SpawnedProcess,
  "exited" | "stdout" | "stderr" | "stdin" | "kill" | "ref" | "unref"
> & {
  readonly exited: Promise<number | null | undefined | void>
  readonly stdout?: ReadableStream<Uint8Array> | null
  readonly stderr?: ReadableStream<Uint8Array> | null
  readonly stdin?: NodeJS.WritableStream | null
  kill?(signal?: NodeJS.Signals): void
  ref?(): void
  unref?(): void
}

type BunSpawnRuntime = {
  spawn(command: readonly string[], options?: SpawnOptions): BunSpawnedProcess
  spawn(options: SpawnOptions & { readonly cmd: readonly string[] }): BunSpawnedProcess
  spawnSync(command: readonly string[], options?: SpawnOptions): SpawnSyncResult
  spawnSync(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnSyncResult
}

const runtime = globalThis as typeof globalThis & { readonly Bun?: BunSpawnRuntime }

function getBunRuntime(): BunSpawnRuntime | undefined {
  return runtime.Bun
}

function emptyReadableStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk)
  return new TextEncoder().encode(String(chunk))
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> {
  if (!stream) return emptyReadableStream()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          controller.enqueue(toUint8Array(chunk))
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

function emptyWritableStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
}

function isOptionsWithCommand(value: unknown): value is SpawnOptions & { readonly cmd: readonly string[] } {
  return typeof value === "object" && value !== null && "cmd" in value && Array.isArray(value.cmd)
}

function resolveCommand(
  cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }),
  optsArg?: SpawnOptions,
): { readonly cmd: readonly string[]; readonly opts: SpawnOptions } {
  if (isOptionsWithCommand(cmdOrOpts)) return { cmd: cmdOrOpts.cmd, opts: cmdOrOpts }
  return { cmd: cmdOrOpts, opts: optsArg ?? {} }
}

function resolveStdio(options: SpawnOptions): StdioTuple {
  if (options.stdio) {
    const [stdin, stdout, stderr] = options.stdio
    return [stdin, stdout, stderr]
  }

  return [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "inherit"]
}

export function createNodeSpawnOptions(
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform,
): NodeSpawnOptions {
  const nodeOptions: NodeSpawnOptions = {
    stdio: resolveStdio(options),
    shell: false,
  }

  if (options.cwd !== undefined) nodeOptions.cwd = options.cwd
  if (options.env !== undefined) nodeOptions.env = options.env
  if (options.detached !== undefined) nodeOptions.detached = options.detached
  if (options.signal !== undefined) nodeOptions.signal = options.signal
  if (platform === "win32") nodeOptions.windowsHide = true

  return nodeOptions
}

export function createNodeSpawnSyncOptions(
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform,
): NodeSpawnSyncOptions {
  const nodeOptions: NodeSpawnSyncOptions = {
    stdio: resolveStdio(options),
    shell: false,
  }

  if (options.cwd !== undefined) nodeOptions.cwd = options.cwd
  if (options.env !== undefined) nodeOptions.env = options.env
  if (platform === "win32") nodeOptions.windowsHide = true

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
    pid: proc.pid,
    kill(signal?: NodeJS.Signals) {
      if (proc.killed || exitCode !== null) return
      proc.kill(signal)
    },
    ref() {
      proc.ref()
    },
    unref() {
      proc.unref()
    },
  }
}

function wrapBunProcess(proc: BunSpawnedProcess): SpawnedProcess {
  let exitCode = proc.exitCode
  const exited = proc.exited.then((code) => {
    if (typeof code === "number") {
      exitCode = code
      return code
    }

    exitCode = proc.exitCode ?? 0
    return exitCode
  })

  return {
    ...proc,
    get exitCode() {
      return exitCode ?? proc.exitCode
    },
    exited,
    stdout: proc.stdout ?? emptyReadableStream(),
    stderr: proc.stderr ?? emptyReadableStream(),
    stdin: proc.stdin ?? emptyWritableStream(),
    pid: proc.pid,
    kill(signal?: NodeJS.Signals) {
      proc.kill?.(signal)
    },
    ref() {
      proc.ref?.()
    },
    unref() {
      proc.unref?.()
    },
  }
}

function toSpawnSyncBuffer(output: Buffer | Uint8Array | string | null): Buffer | undefined {
  if (output === null) return undefined
  if (Buffer.isBuffer(output)) return output
  if (output instanceof Uint8Array) return Buffer.from(output)
  return Buffer.from(output, "utf8")
}

export function spawn(command: readonly string[], options?: SpawnOptions): SpawnedProcess
export function spawn(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnedProcess
export function spawn(
  cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }),
  opts?: SpawnOptions,
): SpawnedProcess {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const bun = getBunRuntime()
  if (bun) return wrapBunProcess(bun.spawn(cmd, options))

  const [bin, ...args] = cmd
  if (!bin) throw new Error("spawn requires a command")

  return wrapNodeProcess(nodeSpawn(bin, args, createNodeSpawnOptions(options)))
}

export function spawnSync(command: readonly string[], options?: SpawnOptions): SpawnSyncResult
export function spawnSync(options: SpawnOptions & { readonly cmd: readonly string[] }): SpawnSyncResult
export function spawnSync(
  cmdOrOpts: readonly string[] | (SpawnOptions & { readonly cmd: readonly string[] }),
  opts?: SpawnOptions,
): SpawnSyncResult {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts)
  const bun = getBunRuntime()
  if (bun) return bun.spawnSync(cmd, options)

  const [bin, ...args] = cmd
  if (!bin) throw new Error("spawnSync requires a command")

  const result = nodeSpawnSync(bin, args, createNodeSpawnSyncOptions(options))

  return {
    exitCode: result.status ?? 1,
    stdout: toSpawnSyncBuffer(result.stdout),
    stderr: toSpawnSyncBuffer(result.stderr),
    success: (result.status ?? 1) === 0,
    pid: result.pid ?? -1,
  }
}
