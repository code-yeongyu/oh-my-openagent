import { spawn as bunSpawn } from "bun"
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process"
import { Readable } from "node:stream"

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  stdin?: "pipe" | "inherit" | "ignore"
  stdout?: "pipe" | "inherit" | "ignore"
  stderr?: "pipe" | "inherit" | "ignore"
}

export interface SpawnedProcess {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array> | undefined
  readonly stderr: ReadableStream<Uint8Array> | undefined
  kill(signal?: NodeJS.Signals): void
}

function toReadableStream(stream: NodeJS.ReadableStream | null): ReadableStream<Uint8Array> | undefined {
  if (!stream) {
    return undefined
  }

  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}

function wrapNodeProcess(proc: ChildProcess): SpawnedProcess {
  let resolveExited: (exitCode: number) => void
  let exitCode: number | null = null

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
    kill(signal?: NodeJS.Signals): void {
      try {
        if (!signal) {
          proc.kill()
          return
        }

        proc.kill(signal)
      } catch {}
    },
  }
}

export function spawnWithWindowsHide(command: string[], options: SpawnOptions): SpawnedProcess {
  if (process.platform !== "win32") {
    return bunSpawn(command, options)
  }

  const [cmd, ...args] = command
  const proc = nodeSpawn(cmd, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.stdin ?? "pipe", options.stdout ?? "pipe", options.stderr ?? "pipe"],
    windowsHide: true,
    shell: true,
  })

  return wrapNodeProcess(proc)
}
