import { execFileSync, spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { buildIdentityPaths, type MemoryIdentityPaths } from "../identity"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"

// Design v4.2 section 3: the Windows job is built by the git-job-helper workflow, which names its target directory
// here. A required run without it, or without the exe in it, fails instead of skipping (trust-helper precedent).
const targetDirectory = process.env.OMO_GIT_JOB_HELPER_TARGET_DIR
export const runsJobHelperRows = process.platform === "win32" && targetDirectory !== undefined

export function requireJobHelperWhenDemanded(): void {
  if (process.env.OMO_GIT_JOB_HELPER_REQUIRED !== "1") return
  if (process.platform !== "win32") throw new Error("OMO_GIT_JOB_HELPER_REQUIRED=1 off Windows: the job-helper rows cannot run here")
  if (targetDirectory === undefined) throw new Error("OMO_GIT_JOB_HELPER_REQUIRED=1 but OMO_GIT_JOB_HELPER_TARGET_DIR is unset")
  if (!existsSync(jobHelperPath())) throw new Error(`OMO_GIT_JOB_HELPER_REQUIRED=1 but ${jobHelperPath()} does not exist`)
}

export function jobHelperPath(): string {
  return join(targetDirectory ?? "", "omo-git-job-helper.exe")
}

const PARK_SCRIPT = fileURLToPath(new URL("./job-helper-park.test-support.ts", import.meta.url))
export const WRITER_SCRIPT = fileURLToPath(new URL("./job-helper-writer.test-support.ts", import.meta.url))
const STUB_SOURCE = fileURLToPath(new URL("./job-helper-stub.test-support.ts", import.meta.url))

export function forwardSlashes(path: string): string {
  return path.replaceAll("\\", "/")
}

/** process.env with `overrides` replacing every case-insensitive namesake (Windows keeps `Path`, not `PATH`). */
export function environmentWith(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const replaced = new Set(Object.keys(overrides).map((key) => key.toLowerCase()))
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!replaced.has(key.toLowerCase())) environment[key] = value
  return { ...environment, ...overrides }
}

export type IdentityRepo = { readonly root: string; readonly paths: MemoryIdentityPaths; readonly hooks: string }

export async function identityRepo(prefix: string, agentId: string): Promise<IdentityRepo> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  const paths = buildIdentityPaths(root, agentId)
  await mkdir(paths.repo, { recursive: true })
  await mkdir(paths.locks, { recursive: true })
  const hooks = join(root, "hooks")
  await mkdir(hooks)
  const git = (args: readonly string[]) => execFileSync("git", ["-C", paths.repo, ...args], { stdio: "ignore" })
  git(["init", "-q", "-b", "main"])
  disableFixtureAutoMaintenance(paths.repo)
  for (const [key, value] of [["user.name", "Job Helper"], ["user.email", "job-helper@omo.local"], ["commit.gpgsign", "false"]] as const) {
    git(["config", key, value])
  }
  git(["commit", "-q", "--allow-empty", "-m", "seed"])
  return { root, paths, hooks }
}

export async function writeHook(hooksDirectory: string, name: string, body: string): Promise<void> {
  const path = join(hooksDirectory, name)
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8")
  await chmod(path, 0o755)
}

export async function gitOpEntries(locksDirectory: string): Promise<string[]> {
  try {
    return (await readdir(join(locksDirectory, "git-ops"))).filter((name) => name.endsWith(".op")).sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

export function gitSucceeds(repo: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export async function compileHelperStub(directory: string): Promise<string> {
  const outfile = join(directory, "omo-git-job-helper-stub.exe")
  const build = spawn(process.execPath, ["build", "--compile", STUB_SOURCE, "--outfile", outfile], { stdio: ["ignore", "ignore", "pipe"] })
  const stderr: Buffer[] = []
  build.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  const code = await new Promise<number | null>((resolve) => build.on("close", resolve))
  if (code !== 0 || !existsSync(outfile)) throw new Error(`stub build failed (${String(code)}): ${Buffer.concat(stderr).toString("utf8")}`)
  return outfile
}

export type ParkArrival = { readonly role: string; readonly pid: number; readonly ppid: number }

/** The TCP side of `job-helper-park.test-support.ts`. Arrivals are recorded from the first byte, so a wait never misses one. */
export class ParkServer {
  private readonly arrivals: ParkArrival[] = []
  private readonly sockets = new Map<Socket, string>()
  private readonly listeners = new Set<() => void>()

  private constructor(private readonly server: Server) {}

  static async start(): Promise<ParkServer> {
    const server = createServer()
    const park = new ParkServer(server)
    server.on("connection", (socket) => park.accept(socket))
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    return park
  }

  get port(): number {
    const address = this.server.address()
    if (address === null || typeof address === "string") throw new Error("park server has no port")
    return address.port
  }

  private accept(socket: Socket): void {
    let pending = ""
    socket.on("error", () => {})
    socket.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8")
      const end = pending.indexOf("\n")
      if (end < 0) return
      const [role = "", pid = "", ppid = ""] = pending.slice(0, end).split(" ")
      this.sockets.set(socket, role)
      this.arrivals.push({ role, pid: Number(pid), ppid: Number(ppid) })
      for (const listener of this.listeners) listener()
    })
  }

  waitFor(role: string, boundMs: number): Promise<ParkArrival> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const arrival = this.arrivals.find((candidate) => candidate.role === role)
        if (arrival === undefined) return
        cleanup()
        resolve(arrival)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`park role ${role} never connected within ${boundMs} ms; arrivals ${JSON.stringify(this.arrivals)}`))
      }, boundMs)
      const cleanup = () => {
        clearTimeout(timer)
        this.listeners.delete(check)
      }
      this.listeners.add(check)
      check()
    })
  }

  release(role: string): void {
    for (const [socket, owner] of this.sockets) if (owner === role) socket.write("release\n")
  }

  async close(): Promise<void> {
    for (const socket of this.sockets.keys()) socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  hookEnvironment(): Readonly<Record<string, string>> {
    return {
      OMO_TEST_BUN: forwardSlashes(process.execPath),
      OMO_TEST_PARK: forwardSlashes(PARK_SCRIPT),
      OMO_TEST_PARK_PORT: String(this.port),
    }
  }
}
