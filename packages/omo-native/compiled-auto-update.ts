import { spawn } from "node:child_process"
import { appendFile, mkdir, open, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import type { CompiledUpdateResult } from "./compiled-update"

/** Startup uses the same verified installer as `omo update`, without delaying the interactive engine. */
export function startCompiledAutoUpdate(options: {
  readonly args: readonly string[]
  readonly interactive: boolean
  readonly release: boolean
  readonly launcher: string | undefined
  readonly env: NodeJS.ProcessEnv
  readonly update?: (launcher: string) => Promise<CompiledUpdateResult>
  readonly report?: (line: string) => void
}): Promise<void> | undefined {
  if (!options.interactive || !options.release || options.launcher === undefined) return
  if (["host", "daemon", "update", "doctor", "setup", "thread", "remote"].includes(options.args[0] ?? "")) return
  if (options.args.some((arg) => ["-p", "--print", "--mode", "--version", "-v", "--help", "-h"].includes(arg))) return
  for (const prefix of ["OMO", "SENPI", "PI"]) {
    if (options.env[`${prefix}_OFFLINE`] || options.env[`${prefix}_SKIP_VERSION_CHECK`]) return
  }
  const launcher = options.launcher
  return (async () => {
    const agentDir = canonicalAgentDir(options.env)
    const report = async (line: string) => {
      const safe = line.replace(/[\r\n\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 500)
      if (options.report !== undefined) options.report(safe)
      else
        await appendFile(join(agentDir, "auto-update.log"), `${new Date().toISOString()} ${safe}\n`, {
          mode: 0o600,
        }).catch(() => {})
    }
    const checksDir = join(agentDir, "auto-update-checks")
    const day = Math.floor(Date.now() / (24 * 60 * 60_000))
    try {
      await mkdir(checksDir, { recursive: true, mode: 0o700 })
      // Exclusive daily publication arbitrates concurrent launches without an expiring mutex.
      const marker = await open(join(checksDir, `${day}.check`), "wx", 0o600)
      await marker.close()
      for (const entry of await readdir(checksDir)) {
        const match = /^(\d+)\.check$/.exec(entry)
        if (match !== null && Number(match[1]) < day) await rm(join(checksDir, entry), { force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await report(`omo auto-update: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    try {
      if (options.update === undefined) {
        // The TUI may exit during a download. Keep the updater independent, and its diagnostics
        // off the terminal; a later launch recovers its lease if it is killed instead.
        const env = { ...options.env }
        for (const key of ["BUN_BE_BUN", "OMO_PROVISIONED_HANDOFF", "OMO_PROVISIONED_LAUNCHER"]) delete env[key]
        const failure = await new Promise<string | undefined>((resolve) => {
          const child = spawn(launcher, ["update"], { env, detached: true, stdio: "ignore", windowsHide: true })
          child.once("error", (error) => resolve(error.message))
          child.once("exit", (code) => resolve(code === 0 ? undefined : `updater exited ${code ?? "without a status"}`))
          child.unref()
        })
        if (failure !== undefined) await report(`omo auto-update: ${failure}`)
      } else {
        const result = await options.update(launcher)
        if (result.exitCode !== 0 || result.output.startsWith("omo updated ")) await report(result.output)
      }
    } catch (error) {
      await report(`omo auto-update: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}
