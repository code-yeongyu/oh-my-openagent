import { spawn, type ChildProcess } from "node:child_process"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { installHooks } from "./hooks"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []
// Every child `run` started, until it closes. A test that times out under load leaves its git (and the hook it runs)
// writing into the temp root, so teardown stops these and waits for their pipes before removing anything (#10945).
const liveChildren = new Map<ChildProcess, Promise<void>>()

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function run(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let streamError: Error | undefined
    const keepFirst = (error: Error): void => {
      streamError ??= error
    }
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdout.on("error", keepFirst)
    child.stderr.on("error", keepFirst)
    liveChildren.set(child, new Promise<void>((settle) => child.once("close", () => settle())))
    child.on("error", (error) => {
      liveChildren.delete(child)
      reject(error)
    })
    child.on("close", (code) => {
      liveChildren.delete(child)
      if (streamError !== undefined) reject(streamError)
      else resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function tempDir(prefix: string): Promise<string> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), prefix)))
  tempDirs.push(dir)
  return dir
}

export async function createRepo(options: Parameters<typeof installHooks>[1] = {}): Promise<string> {
  const dir = await tempDir("memory-hooks-")
  await run(["git", "init", "--quiet"], dir)
  await run(["git", "symbolic-ref", "HEAD", "refs/heads/main"], dir)
  await run(["git", "config", "user.email", "agent@omo.local"], dir)
  await run(["git", "config", "user.name", "OmO Agent"], dir)
  await run(["git", "config", "commit.gpgsign", "false"], dir)
  installHooks(dir, options)
  return dir
}

export async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, content, "utf8")
  }
}

export async function commit(
  dir: string,
  files: Record<string, string>,
  message = "memory write",
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  await writeFiles(dir, files)
  await run(["git", "add", "-A"], dir)
  return run(["git", "commit", "-m", message], dir, env)
}

export async function removeTempDirs(): Promise<void> {
  const running = [...liveChildren]
  for (const [child] of running) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  await Promise.all(running.map(([, closed]) => closed))
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
}
