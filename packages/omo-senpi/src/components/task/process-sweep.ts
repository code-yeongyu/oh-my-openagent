import { OMO_SENPI_TASK_RPC_CHILD } from "@oh-my-opencode/senpi-task"
import {
  sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemonVersions,
} from "@oh-my-opencode/utils/process-sweep"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { resolveSenpiDaemonRuntime } from "../lsp/daemon-runtime"

// Unconditional omo process hygiene for the senpi adapter (T16): fired on
// extension session start, mirroring the task component's session-start
// recovery chain event ("session_start"). No config keys — hygiene always
// runs and each family self-throttles via its stamp file inside the sweep
// functions. Mirrors the codex best-effort process-sweep pattern
// (packages/omo-codex/plugin/components/ — codex hook-sweep.ts).

export type OmoFamilySweep = () => Promise<unknown>

interface OmoFamilySweeps {
  readonly sweepLspProxies: (options: { readonly log?: (message: string) => void }) => Promise<unknown>
  readonly sweepStaleLspDaemons: (options: {
    readonly currentVersion: string
    readonly log?: (message: string) => void
  }) => Promise<unknown>
}

const DEFAULT_FAMILY_SWEEPS: OmoFamilySweeps = {
  sweepLspProxies: sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemons: sweepStaleLspDaemonVersions,
}

export interface SessionStartProcessSweepOptions {
  readonly env?: Record<string, string | undefined>
  readonly sweep?: OmoFamilySweep
  readonly resolveDaemonVersion?: (env: Record<string, string | undefined>) => string
  readonly familySweeps?: OmoFamilySweeps
}

export function wireSessionStartProcessSweep(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  options: SessionStartProcessSweepOptions = {},
): void {
  const env = options.env ?? process.env
  const resolveDaemonVersion =
    options.resolveDaemonVersion ?? ((runtimeEnv) => resolveSenpiDaemonRuntime(runtimeEnv).version)
  const sweep = options.sweep ?? (() => {
    return sweepOmoFamiliesBestEffort(ctx, () => resolveDaemonVersion(env), options.familySweeps)
  })

  pi.on("session_start", () => {
    if (env[OMO_SENPI_TASK_RPC_CHILD] === "1") {
      ctx.logger.info("omo-senpi process sweep skipped: running inside a senpi-task RPC child")
      return undefined
    }
    runSweepBestEffort(sweep, ctx)
    return undefined
  })
}

/** Fire-and-forget: never blocks the session-start chain, never throws. */
function runSweepBestEffort(sweep: OmoFamilySweep, ctx: ComponentContext): void {
  try {
    void Promise.resolve()
      .then(() => sweep())
      .catch((error: unknown) => {
        ctx.logger.warn("omo-senpi process sweep failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  } catch (error) {
    ctx.logger.warn("omo-senpi process sweep failed to start", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function sweepOmoFamiliesBestEffort(
  ctx: ComponentContext,
  resolveLspDaemonVersion: () => string,
  sweeps: OmoFamilySweeps = DEFAULT_FAMILY_SWEEPS,
): Promise<void> {
  const log = (message: string): void => {
    ctx.logger.warn(message)
  }
  await Promise.all([
    bestEffort("lsp-daemon proxy sweep", log, () => sweeps.sweepLspProxies({ log })),
    bestEffort("lsp-daemon stale-version sweep", log, () => {
      const currentVersion = resolveLspDaemonVersion()
      return sweeps.sweepStaleLspDaemons({ currentVersion, log })
    }),
  ])
}

async function bestEffort(
  familyLabel: string,
  log: (message: string) => void,
  sweep: () => Promise<unknown>,
): Promise<void> {
  try {
    await sweep()
  } catch (error) {
    log(`${familyLabel} skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}
