import { spawn } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { delimiter, join } from "node:path"

const OMO_COMMAND_TIMEOUT_MS = 30_000

export interface SpawnTarget {
  readonly command: string
  readonly args: readonly string[]
}

// Windows .cmd/.bat shims must be invoked through cmd.exe; Node's BatBadBut hardening
// (CVE-2024-27980, Node >= 18.20.2) throws EINVAL synchronously when spawning them
// without a shell. Mirrors the codegraph component's wrap (`/d /s /c` preserves arg
// quoting). `args` here are the fixed STATUS_ARGS constant, so cmd metacharacter
// injection is not a concern for this call site.
export function toSpawnTarget(
  bin: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SpawnTarget {
  const isWindowsScript = platform === "win32" && /\.(cmd|bat)$/i.test(bin)
  if (!isWindowsScript) return { command: bin, args }
  return { command: "cmd.exe", args: ["/d", "/s", "/c", bin, ...args] }
}

export function resolveOmoBin(): string | null {
  const envBin = process.env.OMO_BIN?.trim()
  if (envBin) return envBin
  return findExecutableOnPath("omo")
}

export async function runOmoCommand(
  bin: string,
  args: readonly string[],
  options: { cwd: string },
): Promise<{ code: number; stdout: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; stdout: string }>()
  // stderr is never consumed: piping it would wedge the child forever once the
  // 64KiB pipe buffer fills (observed as thousands of live `omo ulw-loop status`
  // processes). Inherit-discard it and hard-kill the child on timeout instead.
  const target = toSpawnTarget(bin, args)
  const child = spawn(target.command, [...target.args], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })

  const stdoutChunks: Buffer[] = []
  let settled = false
  const settle = (result: { code: number; stdout: string }): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    resolve(result)
  }
  const timeout = setTimeout(() => {
    child.kill("SIGKILL")
    settle({ code: 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  }, OMO_COMMAND_TIMEOUT_MS)
  timeout.unref?.()

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  })
  child.on("error", () => {
    settle({ code: 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  })
  child.on("close", (code) => {
    settle({ code: code ?? 1, stdout: Buffer.concat(stdoutChunks).toString("utf8") })
  })
  return promise
}

function findExecutableOnPath(command: string): string | null {
  const pathValue = process.env.PATH
  if (!pathValue) return null
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    for (const candidate of executableCandidates(directory, command)) {
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

function executableCandidates(directory: string, command: string): string[] {
  if (process.platform !== "win32") return [join(directory, command)]
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension.length > 0)
  return [join(directory, command), ...extensions.map((extension) => join(directory, `${command}${extension.toLowerCase()}`))]
}

function isExecutableFile(file: string): boolean {
  if (!existsSync(file)) return false
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
