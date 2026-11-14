import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { resolveSenpiLaunch, withoutForeignPackageDirEnv } from "../../memory/worker/senpi-command"

export type EngineLauncher = ReturnType<typeof resolveSenpiLaunch>

const HOST_ENSURE_TIMEOUT_MS = 60_000

export type EngineHostEnsureOptions = {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The operator host's socket, the one `thread_create` opens on (`resolveThreadSocket`). */
  readonly socket: string
  /** The agent directory the ensured host serves, named to it as `omo daemon`'s own ensure names it. */
  readonly agentDir: string
  /** `task.host_idle_exit_ms`: the host idle exit the user configured; absent, the launch spec's default runs. */
  readonly idleExitMs?: () => number | undefined
  /** omo's `daemon-launch-spec.json` (the engine's own spec format); it ships beside the extension bundles. */
  readonly launchSpecPath?: string
  readonly launch?: () => EngineLauncher
  readonly warn: (line: string) => void
}

/**
 * The spec beside the built extension bundle, falling back to the plugin's tracked spec from the source tree (as the
 * sibling components do, `dag-sdk-root-provisioning` and `ast-grep`), so a dev or source-mode run hands the CLI a real
 * file instead of the unbuilt packaged path.
 */
function resolveLaunchSpecPath(importerUrl: string = import.meta.url): string {
  const packaged = fileURLToPath(new URL("../daemon-launch-spec.json", importerUrl))
  if (existsSync(packaged)) return packaged
  const sourceTree = fileURLToPath(new URL("../../../../plugin/daemon-launch-spec.json", importerUrl))
  return existsSync(sourceTree) ? sourceTree : packaged
}

/**
 * The env `omo daemon`'s own ensure runs with (`hostCommandEnvironment`): the agent dir is named, and a configured host
 * idle exit rides along instead of the launch spec's default.
 */
function hostCommandEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  agentDir: string,
  idleExitMs: number | undefined,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...env, OMO_AGENT_DIR: agentDir }
  if (typeof idleExitMs === "number" && Number.isFinite(idleExitMs) && idleExitMs > 0)
    result.SENPI_RPC_HOST_IDLE_EXIT_MS = String(Math.trunc(idleExitMs))
  return result
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
    const specPath = options.launchSpecPath ?? resolveLaunchSpecPath()
    const args = [
      ...launch.prefixArgs,
      ...["host", "ensure", "--launch-spec", specPath, "--socket", options.socket, "--policy", "never", "--json"],
    ]
    const failure = await new Promise<string | undefined>((done) => {
      execFile(
        launch.command,
        args,
        {
          env: withoutForeignPackageDirEnv(
            hostCommandEnvironment(options.env, options.agentDir, options.idleExitMs?.()),
            launch,
          ),
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
