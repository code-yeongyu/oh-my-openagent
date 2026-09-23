import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { text } from "node:stream/consumers"
import { fileURLToPath } from "node:url"

export async function runDetachedProbe(scenario: string): Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly sandboxRemoved: boolean
}> {
  const sandbox = mkdtempSync(join(tmpdir(), "omo-detached-probe-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env, HOME: sandbox, USERPROFILE: sandbox, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox,
  }
  for (const prefix of ["OMO", "SENPI", "PI"]) {
    const dir = join(sandbox, prefix.toLowerCase())
    mkdirSync(dir)
    env[`${prefix}_CODING_AGENT_DIR`] = dir
  }
  for (const key of [
    "SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "PI_PACKAGE_DIR", "OMO_BIN", "SENPI_BIN",
    "PI_SESSION_FILE", "OMO_RPC_SOCKET_PATH",
  ]) delete env[key]
  const probePath = fileURLToPath(new URL("./detached-process.test-support.ts", import.meta.url))
  const child = spawn(process.execPath, [probePath, scenario], {
    env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  })
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code ?? 1))
  })
  const timeout = setTimeout(() => child.kill(), 10_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      exited, text(child.stdout), text(child.stderr),
    ])
    return { exitCode, stdout, stderr, sandboxRemoved: true }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill()
      await exited
    }
    rmSync(sandbox, { recursive: true, force: true })
    if (existsSync(sandbox)) throw new Error(`sandbox survived cleanup: ${sandbox}`)
  }
}
