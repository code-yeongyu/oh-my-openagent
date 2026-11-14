import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import { resolveSenpiLaunch, withoutForeignPackageDirEnv } from "../../memory/worker/senpi-command"

export type EngineLauncher = ReturnType<typeof resolveSenpiLaunch>

const HOST_ENSURE_TIMEOUT_MS = 60_000

export type EngineHostEnsureOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The operator host's socket, the one `thread_create` opens on (`resolveThreadSocket`). */
  readonly socket: string
  /** omo's `daemon-launch-spec.json` (the engine's own spec format); it ships beside the extension bundles. */
  readonly launchSpecPath?: string
  readonly launch?: () => EngineLauncher
  readonly warn: (line: string) => void
}

/**
 * The carrier's host ensure (owner ruling 2026-11-14: the device's daemon being up is enough). It asks the engine CLI
 * that runs this session, `host ensure --policy never`: a running host is reused whatever its build, and one is started
 * from omo's launch spec only when nothing answers. It never throws: the open that follows tells whether a host is there.
 */
export function engineHostEnsure(options: EngineHostEnsureOptions): () => Promise<void> {
  return async () => {
    let launch: EngineLauncher
    try {
      launch = (options.launch ?? (() => resolveSenpiLaunch({ ...options.env })))()
    } catch (error) {
      options.warn(`thread wake: no engine CLI to ensure the operator host: ${String(error)}`)
      return
    }
    const specPath = options.launchSpecPath ?? fileURLToPath(new URL("../daemon-launch-spec.json", import.meta.url))
    const args = [
      ...launch.prefixArgs,
      ...["host", "ensure", "--launch-spec", specPath, "--socket", options.socket, "--policy", "never", "--json"],
    ]
    const failure = await new Promise<string | undefined>((done) => {
      execFile(
        launch.command,
        args,
        {
          env: withoutForeignPackageDirEnv({ ...options.env }, launch),
          timeout: HOST_ENSURE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout) => done(error === null ? undefined : `${String(error.code ?? error.message)} ${String(stdout).trim()}`),
      )
    })
    if (failure !== undefined) options.warn(`thread wake: the engine did not ensure the operator host: ${failure}`)
  }
}
