import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const LOCKS_MODULE = fileURLToPath(new URL("./locks.ts", import.meta.url))

const HOLDER_SCRIPT = `const { withLock } = await import(process.env.LOCKS_MODULE)
await withLock(process.env.HOLD_PATH, async () => {
  process.stdout.write("held\\n")
  await new Promise((resolve) => {
    process.stdin.on("data", () => {})
    process.stdin.on("end", resolve)
  })
}, { staleAfterMs: Number(process.env.STALE_AFTER_MS) })
`

const CONTENDER_SCRIPT = `const { withLock } = await import(process.env.LOCKS_MODULE)
const { appendFileSync } = await import("node:fs")
for (let round = 0; round < Number(process.env.ROUNDS); round += 1) {
  await withLock(process.env.HOLD_PATH, async () => {
    appendFileSync(process.env.LOG_PATH, "enter " + process.pid + "\\n")
    for (let step = 0; step < 3; step += 1) appendFileSync(process.env.LOG_PATH + ".scratch", "x")
    appendFileSync(process.env.LOG_PATH, "exit " + process.pid + "\\n")
  })
}
`

export async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

export type LockHolder = {
  readonly pid: number
  readonly release: () => Promise<number | null>
}

function exitCodeOf(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve, reject) => {
    child.once("exit", (code) => resolve(code))
    child.once("error", reject)
  })
}

async function writeScript(workDirectory: string, name: string, source: string): Promise<string> {
  const scriptPath = join(workDirectory, `${name}-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
  await writeFile(scriptPath, source)
  return scriptPath
}

export async function startLockHolder(workDirectory: string, lockPath: string, staleAfterMs = 300_000): Promise<LockHolder> {
  const scriptPath = await writeScript(workDirectory, "holder", HOLDER_SCRIPT)
  const child = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LOCKS_MODULE, HOLD_PATH: lockPath, STALE_AFTER_MS: String(staleAfterMs) },
  })
  const exited = exitCodeOf(child)
  let stderr = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  await new Promise<void>((resolve, reject) => {
    let stdout = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
      if (stdout.includes("held")) resolve()
    })
    void exited.then((code) => reject(new Error(`lock holder exited with ${code} before holding: ${stderr}`)), reject)
  })
  if (child.pid === undefined) throw new Error("lock holder has no pid")
  return {
    pid: child.pid,
    release: async () => {
      child.stdin?.end()
      return await exited
    },
  }
}

export async function runLockContenders(
  workDirectory: string,
  lockPath: string,
  logPath: string,
  processes: number,
  rounds: number,
): Promise<(number | null)[]> {
  const scriptPath = await writeScript(workDirectory, "contender", CONTENDER_SCRIPT)
  const children = Array.from({ length: processes }, () => spawn(process.execPath, [scriptPath], {
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, LOCKS_MODULE, HOLD_PATH: lockPath, LOG_PATH: logPath, ROUNDS: String(rounds) },
  }))
  return await Promise.all(children.map(exitCodeOf))
}
