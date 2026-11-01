import { spawn } from "node:child_process"
import { acquireDeviceService, type AcquireOptions } from "./release/acquire.ts"

export type RunCommand = (argv: readonly string[]) => Promise<{ readonly exitCode: number; readonly output: string }>

export type InstallOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly state: "update_required" | "service_degraded"; readonly action: string }

const INSTALL_TIMEOUT_MS = 120_000

const runCommand: RunCommand = ([command, ...args]) =>
  new Promise(resolve => {
    if (command === undefined) return resolve({ exitCode: 1, output: "no command" })
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], timeout: INSTALL_TIMEOUT_MS, windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("error", error => resolve({ exitCode: 1, output: error.message }))
    child.on("close", code => resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString("utf8") }))
  })

const firstLine = (text: string): string => text.trim().split(/\r?\n/)[0] ?? ""

/**
 * Acquires the pinned release, then hands it to the service's own installer: `<binary> install-service --from
 * <release dir>`, which registers, starts and version-checks the service.
 */
export const installDeviceService = async (options: AcquireOptions & { readonly run?: RunCommand }): Promise<InstallOutcome> => {
  const acquired = await acquireDeviceService(options)
  if (!acquired.ok)
    return {
      ok: false,
      state: acquired.refusal === "update_required" || acquired.refusal === "release_key_invalid" ? "update_required" : "service_degraded",
      action: acquired.action,
    }
  const result = await (options.run ?? runCommand)([acquired.binary, "install-service", "--from", acquired.releaseDir])
  if (result.exitCode === 0) return { ok: true }
  return {
    ok: false,
    state: "service_degraded",
    action: `The OmO device service could not be installed (${firstLine(result.output) || `exit ${result.exitCode}`}). Try again; if it keeps failing, report it with /bug.`,
  }
}
