import { execFile } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { delimiter, dirname, join } from "node:path"
import { IsolationUnavailableError } from "../backend"
import { exists } from "../git/command"

export interface CommandResult { code: number; stdout: string; stderr: string }
export interface BackendRuntime {
  platform: NodeJS.Platform
  which(binary: string): boolean
  run(argv: string[]): Promise<CommandResult>
  device(path: string): Promise<number>
  accessible(path: string): Promise<boolean>
  mounted(path: string): Promise<boolean>
  waitMounted(path: string): Promise<void>
}
export const runtime: BackendRuntime = {
  platform: process.platform,
  which(binary) {
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      for (const suffix of process.platform === "win32" ? ["", ".exe", ".cmd"] : [""]) {
        try { accessSync(join(dir, binary + suffix), constants.X_OK); return true } catch (error) {
          if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code)))) throw error
        }
      }
    }
    return false
  },
  run(argv) {
    return new Promise((resolve, reject) => {
      execFile(argv[0]!, argv.slice(1), { encoding: "utf8", maxBuffer: 16 * 1024 ** 2 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error.code === "ENOENT" ? new IsolationUnavailableError(`${argv[0]} not on PATH`) : error)
        } else resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr })
      })
    })
  },
  async device(path) { return (await stat(path)).dev },
  async accessible(path) {
    try { await access(path, constants.R_OK | constants.W_OK); return true } catch (error) {
      if (error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM"].includes(String(error.code))) return false
      throw error
    }
  },
  async mounted(path) {
    const mounts = await readFile("/proc/mounts", "utf8")
    return mounts.split("\n").some((line) => line.split(" ")[1]?.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8))) === path)
  },
  async waitMounted(path) {
    const deadline = Date.now() + 5000
    do {
      if (await runtime.mounted(path)) return
      // External kernel state has no notification API; only backend mount readiness polls.
      await new Promise((resolve) => setTimeout(resolve, 25))
    } while (Date.now() < deadline)
    throw new Error(`Mount did not appear within 5 seconds: ${path}`)
  },
}
export async function existingParent(path: string): Promise<string> {
  while (!await exists(path)) {
    const parent = dirname(path)
    if (parent === path) throw new Error(`No existing parent for ${path}`)
    path = parent
  }
  return path
}

export async function checked(io: BackendRuntime, argv: string[]): Promise<CommandResult> {
  const result = await io.run(argv)
  if (result.code !== 0) throw new Error(`${argv[0]} exited ${result.code}: ${result.stderr}`)
  return result
}
