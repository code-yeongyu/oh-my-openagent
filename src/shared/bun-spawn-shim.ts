import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process"
import { Readable } from "node:stream"

type SpawnOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  stdin?: "pipe" | "inherit" | "ignore"
  stdout?: "pipe" | "inherit" | "ignore"
  stderr?: "pipe" | "inherit" | "ignore"
}

type SpawnInput = string[] | ({ cmd: string[] } & SpawnOptions)

type SpawnResult = {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array> | null
  readonly stderr: ReadableStream<Uint8Array> | null
  readonly stdin: NodeJS.WritableStream | null
  readonly pid: number
  kill(signal?: NodeJS.Signals): void
}

function isBunRuntime(): boolean {
  return typeof globalThis.Bun !== "undefined"
}

function resolveSpawnInput(input: SpawnInput, options?: SpawnOptions): { cmd: string[]; opts: SpawnOptions } {
  if (Array.isArray(input)) {
    return { cmd: input, opts: options ?? {} }
  }

  return {
    cmd: input.cmd,
    opts: {
      cwd: input.cwd,
      env: input.env,
      stdin: input.stdin,
      stdout: input.stdout,
      stderr: input.stderr,
    },
  }
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> | null {
  if (!stream) return null
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}

function wrapNodeProcess(proc: ReturnType<typeof nodeSpawn>): SpawnResult {
  let exitCode: number | null = null
  let resolveExited: (code: number) => void = () => {}

  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve
  })

  proc.on("exit", (code) => {
    exitCode = code ?? 1
    resolveExited(exitCode)
  })

  proc.on("error", () => {
    if (exitCode === null) {
      exitCode = 1
      resolveExited(1)
    }
  })

  return {
    get exitCode() {
      return exitCode
    },
    exited,
    stdout: toReadableStream(proc.stdout),
    stderr: toReadableStream(proc.stderr),
    stdin: proc.stdin,
    pid: proc.pid ?? -1,
    kill(signal?: NodeJS.Signals): void {
      try {
        proc.kill(signal)
      } catch {}
    },
  }
}

export function spawn(input: SpawnInput, options?: SpawnOptions): SpawnResult {
  if (isBunRuntime()) {
    const bun = globalThis.Bun as unknown as {
      spawn: (input: SpawnInput, options?: SpawnOptions) => SpawnResult
    }
    return bun.spawn(input, options)
  }

  const { cmd, opts } = resolveSpawnInput(input, options)
  const [bin, ...args] = cmd

  const proc = nodeSpawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv | undefined,
    stdio: [opts.stdin ?? "pipe", opts.stdout ?? "pipe", opts.stderr ?? "pipe"],
  })

  return wrapNodeProcess(proc)
}

export function spawnSync(input: SpawnInput, options?: SpawnOptions): {
  exitCode: number
  stdout: Buffer | string
  stderr: Buffer | string
  success: boolean
  pid: number
} {
  if (isBunRuntime()) {
    const bun = globalThis.Bun as unknown as {
      spawnSync: (input: SpawnInput, options?: SpawnOptions) => {
        exitCode: number
        stdout: Buffer | string
        stderr: Buffer | string
        success: boolean
        pid: number
      }
    }
    return bun.spawnSync(input, options)
  }

  const { cmd, opts } = resolveSpawnInput(input, options)
  const [bin, ...args] = cmd
  const result = nodeSpawnSync(bin, args, {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv | undefined,
    stdio: [opts.stdin ?? "pipe", opts.stdout ?? "pipe", opts.stderr ?? "pipe"],
  })

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    success: (result.status ?? 1) === 0,
    pid: -1,
  }
}
