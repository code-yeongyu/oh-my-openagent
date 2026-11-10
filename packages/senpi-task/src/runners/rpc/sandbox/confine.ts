import { existsSync, realpathSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { RpcRunnerSpec } from "../../types"
import type { RpcSpawnDescriptor } from "../spawn"
import { confinedEnv } from "./child-env"
import { prepareChildDirs } from "./child-dirs"
import { planDenyLive, type DenyLivePlan } from "./plan"
import { sandboxRequired } from "./policy"
import { preflightDenyLive } from "./preflight"
import { writeUnixSocketFilter } from "./seccomp"
import { wrapDenyLive } from "./wrap"

const PROOF_TTL_MS = 10 * 60_000
const provenPlans = new Map<string, number>()

export type ConfineOptions = {
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  readonly now?: () => number
  readonly arch?: string
}

export type ConfinedSpawn = {
  readonly descriptor: RpcSpawnDescriptor
  // Removes the Linux placeholders this launch created; call it once the child has exited.
  readonly release: () => void
}

/**
 * The sandboxed form of a review-role child's spawn (senpi#6287), or a typed refusal: no sandbox
 * backend, code loaded from the child's writable tree, or a preflight that could not prove the
 * confinement. There is no unsandboxed fallback.
 */
export function confineRpcSpawn(descriptor: RpcSpawnDescriptor, spec: RpcRunnerSpec, options: ConfineOptions = {}): ConfinedSpawn {
  const env = descriptor.env
  const home = env.HOME ?? homedir()
  const decision = planDenyLive({
    platform: options.platform ?? process.platform,
    home,
    agentDir: env.OMO_CODING_AGENT_DIR || env.SENPI_CODING_AGENT_DIR || join(home, ".omo", "agent"),
    stateDir: spec.state_dir,
    cwd: descriptor.cwd,
    codeRoots: codeRoots(descriptor, spec),
    ...(typeof process.getuid === "function" ? { uid: process.getuid() } : {}),
    ...(options.which === undefined ? {} : { which: options.which }),
  })
  if (decision.kind === "unavailable") {
    throw sandboxRequired(`review-role child refused: ${decision.reason}; it never runs unsandboxed`)
  }
  const plan = decision.plan
  const dirs = prepareChildDirs(plan)
  try {
    const seccompFile = plan.platform === "linux" ? writeUnixSocketFilter(plan.tmpDir, options.arch) : undefined
    if (plan.platform === "linux" && seccompFile === undefined) {
      throw sandboxRequired(`review-role child refused: no unix-socket filter exists for ${options.arch ?? process.arch}`)
    }
    prove(plan, seccompFile, home, options.now ?? Date.now)
    const wrapped = wrapDenyLive(plan, descriptor.command, descriptor.args, seccompFile)
    return {
      descriptor: {
        ...descriptor,
        command: wrapped.command,
        args: wrapped.args,
        env: confinedEnv(plan, env),
        ...(wrapped.seccompFile === undefined ? {} : { inheritFiles: [wrapped.seccompFile] }),
      },
      release: dirs.release,
    }
  } catch (error) {
    dirs.release()
    throw error
  }
}

function prove(plan: DenyLivePlan, seccompFile: string | undefined, home: string, now: () => number): void {
  const key = JSON.stringify(plan)
  const provenAt = provenPlans.get(key)
  if (provenAt !== undefined && now() - provenAt < PROOF_TTL_MS) return
  const result = preflightDenyLive(plan, seccompFile, home)
  if (!result.ok) throw sandboxRequired(`review-role child refused: the sandbox preflight failed (${result.reason})`)
  provenPlans.set(key, now())
}

// The code a child loads: each -e extension's directory and the engine launcher's install directory.
function codeRoots(descriptor: RpcSpawnDescriptor, spec: RpcRunnerSpec): readonly string[] {
  const entries = [...(spec.extensions ?? []), descriptor.command, descriptor.args[0] ?? ""]
  const roots: string[] = []
  for (const entry of entries) {
    if (entry.length === 0 || !existsSync(entry)) continue
    const real = realpathSync(entry)
    const root = statSync(real).isDirectory() ? real : dirname(real)
    if (root !== "/" && root !== tmpdir() && !roots.includes(root)) roots.push(root)
  }
  return roots
}
