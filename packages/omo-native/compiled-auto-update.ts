import { spawn } from "node:child_process"
import type { CompiledUpdateResult } from "./compiled-update"

/** Startup uses the same verified installer as `omo update`, without delaying the interactive engine. */
export function startCompiledAutoUpdate(options: {
  readonly args: readonly string[]
  readonly interactive: boolean
  readonly release: boolean
  readonly launcher: string | undefined
  readonly env: NodeJS.ProcessEnv
  readonly update?: (launcher: string) => Promise<CompiledUpdateResult>
  readonly report: (line: string) => void
}): Promise<void> | undefined {
  if (!options.interactive || !options.release || options.launcher === undefined) return
  if (["host", "daemon", "update", "doctor", "setup", "thread", "remote"].includes(options.args[0] ?? "")) return
  if (options.args.some((arg) => ["-p", "--print", "--mode", "--version", "-v", "--help", "-h"].includes(arg))) return
  for (const prefix of ["OMO", "SENPI", "PI"]) {
    if (options.env[`${prefix}_OFFLINE`] || options.env[`${prefix}_SKIP_VERSION_CHECK`]) return
  }
  if (options.update === undefined) {
    // The TUI can exit while a download is in flight. Keep its updater independent so a normal
    // session exit cannot strand a staging file or install lock halfway through the transaction.
    const env = { ...options.env }
    const launcher = options.launcher
    for (const key of ["BUN_BE_BUN", "OMO_PROVISIONED_HANDOFF", "OMO_PROVISIONED_LAUNCHER"]) delete env[key]
    return new Promise((resolve) => {
      const child = spawn(launcher, ["update"], { env, detached: true, stdio: "ignore", windowsHide: true })
      child.once("error", (error) => {
        options.report(`omo auto-update: ${error.message}`)
        resolve()
      })
      child.once("exit", (code) => {
        if (code !== 0) options.report(`omo auto-update: updater exited ${code ?? "without a status"}`)
        resolve()
      })
      child.unref()
    })
  }
  return options.update(options.launcher).then((result) => {
    if (result.exitCode !== 0 || result.output.startsWith("omo updated ")) options.report(result.output)
  }, (error: unknown) => {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/[\r\n\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 500)
    options.report(`omo auto-update: ${reason}`)
  })
}
