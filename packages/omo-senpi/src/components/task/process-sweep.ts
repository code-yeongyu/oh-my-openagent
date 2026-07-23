import {
  sweepCodegraphZombies,
  sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemonVersions,
} from "@oh-my-opencode/utils/process-sweep"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"

// Unconditional omo process hygiene for the senpi adapter (T16): fired on
// extension session start, mirroring the task component's session-start
// recovery chain event ("session_start"). No config keys — hygiene always
// runs and each family self-throttles via its stamp file inside the sweep
// functions. Mirrors the codex sweepCodegraphZombiesBestEffort pattern
// (packages/omo-codex/plugin/components/codegraph/src/hook-sweep.ts).

export const SENPI_RPC_CHILD_MARKER_ENV = "SENPI_CODING_AGENT_SESSION_DIR"

export type OmoFamilySweep = () => Promise<unknown>

export interface SessionStartProcessSweepOptions {
  readonly env?: Record<string, string | undefined>
  readonly sweep?: OmoFamilySweep
}

export function wireSessionStartProcessSweep(
  pi: SenpiExtensionAPI,
  ctx: ComponentContext,
  options: SessionStartProcessSweepOptions = {},
): void {
  const env = options.env ?? process.env
  const sweep = options.sweep ?? (() => sweepOmoFamiliesBestEffort(ctx))

  pi.on("session_start", () => {
    if (env[SENPI_RPC_CHILD_MARKER_ENV] !== undefined) {
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

async function sweepOmoFamiliesBestEffort(ctx: ComponentContext): Promise<void> {
  const log = (message: string): void => {
    ctx.logger.warn(message)
  }
  await Promise.all([
    bestEffort("CodeGraph zombie sweep", log, () => sweepCodegraphZombies({ log })),
    bestEffort("lsp-daemon proxy sweep", log, () => sweepOrphanedLspDaemonProxies({ log })),
    bestEffort("lsp-daemon stale-version sweep", log, () => sweepStaleLspDaemonVersions({ log })),
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
