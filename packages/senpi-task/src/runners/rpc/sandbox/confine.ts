import { existsSync, realpathSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { RpcRunnerSpec } from "../../types"
import type { RpcSpawnDescriptor } from "../spawn"
import { planDenyLive, type DenyLivePlan } from "./plan"
import { sandboxRequired } from "./policy"
import { preflightDenyLive } from "./preflight"
import { wrapDenyLive } from "./wrap"

const PROOF_TTL_MS = 10 * 60_000
const provenPlans = new Map<string, number>()

export type ConfineOptions = {
  readonly platform?: NodeJS.Platform
  readonly which?: (command: string) => string | undefined
  readonly now?: () => number
}

/**
 * The sandboxed form of a review-role child's spawn (senpi#6287), or a typed refusal: no sandbox
 * backend, or a preflight that could not prove the deny. There is no unsandboxed fallback.
 */
export function confineRpcSpawn(descriptor: RpcSpawnDescriptor, spec: RpcRunnerSpec, options: ConfineOptions = {}): RpcSpawnDescriptor {
  const env = descriptor.env
  const home = env.HOME ?? homedir()
  const tmpDir = join(spec.state_dir, "sandbox-tmp")
  const decision = planDenyLive({
    platform: options.platform ?? process.platform,
    home,
    agentDir: env.OMO_CODING_AGENT_DIR || env.SENPI_CODING_AGENT_DIR || join(home, ".omo", "agent"),
    childStateDir: spec.state_dir,
    tmpDir,
    cwd: descriptor.cwd,
    codeRoots: codeRoots(descriptor, spec),
    ...(options.which === undefined ? {} : { which: options.which }),
  })
  if (decision.kind === "unavailable") {
    throw sandboxRequired(`review-role child refused: ${decision.reason}; it never runs unsandboxed`)
  }
  prove(decision.plan, options.now ?? Date.now)
  const wrapped = wrapDenyLive(decision.plan, descriptor.command, descriptor.args)
  return { ...descriptor, command: wrapped.command, args: wrapped.args, env: { ...env, TMPDIR: tmpDir } }
}

function prove(plan: DenyLivePlan, now: () => number): void {
  const key = JSON.stringify(plan)
  const provenAt = provenPlans.get(key)
  if (provenAt !== undefined && now() - provenAt < PROOF_TTL_MS) return
  const result = preflightDenyLive(plan)
  if (!result.ok) throw sandboxRequired(`review-role child refused: the sandbox preflight failed (${result.reason})`)
  provenPlans.set(key, now())
}

// The code a child loads from outside the live roots must not be writable by it either: each -e
// extension's directory and the engine launcher's install directory.
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
