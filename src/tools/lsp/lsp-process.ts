import { spawn as bunSpawn } from "bun"
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, statSync } from "fs"
import { log } from "../../shared/logger"
// Bun spawn segfaults on Windows (oven-sh/bun#25798) — unfixed as of v1.3.8+
function shouldUseNodeSpawn(): boolean {
  return process.platform === "win32"
}
// Prevents segfaults when libuv gets a non-existent cwd (oven-sh/bun#25798)
export function validateCwd(cwd: string): { valid: boolean; error?: string } {
  try {
    if (!existsSync(cwd)) {
      return { valid: false, error: `Working directory does not exist: ${cwd}` }
    }
    const stats = statSync(cwd)
    if (!stats.isDirectory()) {
      return { valid: false, error: `Path is not a directory: ${cwd}` }
    }
    return { valid: true }
  } catch (err) {
    return { valid: false, error: `Cannot access working directory: ${cwd} (${err instanceof Error ? err.message : String(err)})` }
  }
}
function isBinaryAvailableOnWindows(command: string): boolean {
  if (process.platform !== "win32") return true

  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command)
  }

  try {
    const result = spawnSync("where", [command], {
      shell: true,
      windowsHide: true,
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return true
  }
}
interface StreamReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>
}
// Bridges Bun Subprocess and Node.js ChildProcess under a common API
export interface UnifiedProcess {
  stdin: { write(chunk: Uint8Array | string): void }
  stdout: { getReader(): StreamReader }
  stderr: { getReader(): StreamReader }
  exitCode: number | null
  exited: Promise<number>
  kill(signal?: string): void
}
function wrapNodeProcess(proc: ChildProcess): UnifiedProcess {
  let resolveExited: (code: number) => void
  let exitCode: number | null = null
  const exitedPromise = new Promise<number>((resolve) => {
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
  const createStreamReader = (nodeStream: NodeJS.ReadableStream | null): StreamReader => {
    const chunks: Uint8Array[] = []
    let streamEnded = false
    type ReadResult = { done: boolean; value: Uint8Array | undefined }
    let waitingResolve: ((result: ReadResult) => void) | null = null

    if (nodeStream) {
      nodeStream.on("data", (chunk: Buffer) => {
        const uint8 = new Uint8Array(chunk)
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: false, value: uint8 })
        } else {
          chunks.push(uint8)
        }
      })

      nodeStream.on("end", () => {
        streamEnded = true
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: true, value: undefined })
        }
      })

      nodeStream.on("error", () => {
        streamEnded = true
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: true, value: undefined })
        }
      })
    } else {
      streamEnded = true
    }
    return {
      read(): Promise<ReadResult> {
        return new Promise((resolve) => {
          if (chunks.length > 0) {
            resolve({ done: false, value: chunks.shift()! })
          } else if (streamEnded) {
            resolve({ done: true, value: undefined })
          } else {
            waitingResolve = resolve
          }
        })
      },
    }
  }
  return {
    stdin: {
      write(chunk: Uint8Array | string) {
        if (proc.stdin) {
          proc.stdin.write(chunk)
        }
      },
    },
    stdout: {
      getReader: () => createStreamReader(proc.stdout),
    },
    stderr: {
      getReader: () => createStreamReader(proc.stderr),
    },
    get exitCode() {
      return exitCode
    },
    exited: exitedPromise,
    kill(signal?: string) {
      try {
        if (signal === "SIGKILL") {
          proc.kill("SIGKILL")
        } else {
          proc.kill()
        }
      } catch {}
    },
  }
}
export function spawnProcess(
  command: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
): UnifiedProcess {
  const cwdValidation = validateCwd(options.cwd)
  if (!cwdValidation.valid) {
    throw new Error(`[LSP] ${cwdValidation.error}`)
  }
  if (shouldUseNodeSpawn()) {
    const [cmd, ...args] = command
    if (!isBinaryAvailableOnWindows(cmd)) {
      throw new Error(
        `[LSP] Binary '${cmd}' not found on Windows. ` +
          `Ensure the LSP server is installed and available in PATH. ` +
          `For npm packages, try: npm install -g ${cmd}`
      )
    }
    log("[LSP] Using Node.js child_process on Windows to avoid Bun spawn segfault")
    const proc = nodeSpawn(cmd, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: true,
    })
    return wrapNodeProcess(proc)
  }
  const proc = bunSpawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: options.env,
  })
  return proc as unknown as UnifiedProcess
}
