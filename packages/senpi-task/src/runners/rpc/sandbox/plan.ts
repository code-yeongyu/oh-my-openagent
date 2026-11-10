import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

export type DenyLivePolicy = "deny-live"

export type DenyLiveInput = {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly agentDir: string
  readonly childStateDir: string
  readonly tmpDir: string
  readonly cwd: string
  // Code the child loads from outside the live roots (its -e extension packages, the engine launcher).
  readonly codeRoots: readonly string[]
  readonly liveRoots?: readonly string[]
  readonly which?: (command: string) => string | undefined
}

/**
 * One confinement: write-denied roots, the writable carve-outs inside them, and the code and config
 * re-denied inside those carve-outs. Rules apply in that order, so a later rule wins (bwrap mount
 * order, Seatbelt rule order). Every path appears by literal spelling and by realpath.
 */
export type DenyLivePlan = {
  readonly platform: "linux" | "darwin"
  readonly backend: string
  readonly deny: readonly string[]
  readonly allow: readonly string[]
  readonly reDeny: readonly string[]
  readonly tmpDir: string
  readonly cwd: string
}

export type DenyLiveDecision =
  | { readonly kind: "confined"; readonly plan: DenyLivePlan }
  | { readonly kind: "unavailable"; readonly reason: string }

// Engine state under ~/.omo the child must write to run at all (measured, senpi#6287): the agent dir's
// locks, session holders, caches and logs; memory, session locks and the LSP daemon's stamps.
const STATE_DIRS_UNDER_LIVE_ROOT = ["agent", "memory", "session-locks", "lsp-daemon", "cache"] as const

// Code and configuration inside the agent dir: installed runtimes and binaries, seeded and user
// extensions, the RPC host keys, and the settings, models and trust files the engine reads.
const AGENT_DIR_CODE_AND_CONFIG = [
  "runtime", "bin", "bundled-bun", "extensions", "extensions.disabled", "kill-guard", join("rpc", "keys"),
  "settings.json", "models.json", "models-store.json", "trust.json", "config-identity.key",
] as const

export function planDenyLive(input: DenyLiveInput): DenyLiveDecision {
  if (input.platform !== "linux" && input.platform !== "darwin") {
    return { kind: "unavailable", reason: `no deny-live sandbox exists on ${input.platform}` }
  }
  const which = input.which ?? whichOnPath
  const backend = input.platform === "darwin" ? which("sandbox-exec") : which("bwrap")
  if (backend === undefined) {
    return { kind: "unavailable", reason: input.platform === "darwin" ? "sandbox-exec not found" : "bwrap not found" }
  }
  const liveRoots = input.liveRoots ?? [join(input.home, ".omo")]
  const agentDir = input.agentDir
  if (liveRoots.some((root) => sameOrInside(root, agentDir) && !sameOrInside(join(root, "agent"), agentDir))) {
    return { kind: "unavailable", reason: `agent dir ${agentDir} is a live root, not engine state inside one` }
  }
  const deny = aliases(liveRoots)
  const allow = aliases([
    ...liveRoots.flatMap((root) => STATE_DIRS_UNDER_LIVE_ROOT.map((name) => join(root, name))),
    agentDir,
    input.childStateDir,
    input.tmpDir,
  ])
  const reDeny = aliases([...AGENT_DIR_CODE_AND_CONFIG.map((name) => join(agentDir, name)), ...input.codeRoots])
  return {
    kind: "confined",
    plan: { platform: input.platform, backend, deny, allow, reDeny, tmpDir: input.tmpDir, cwd: input.cwd },
  }
}

export function defaultLiveRoots(): readonly string[] {
  return [join(homedir(), ".omo")]
}

function aliases(paths: readonly string[]): readonly string[] {
  const out: string[] = []
  for (const path of paths) {
    for (const spelling of [path, realOrSelf(path)]) if (!out.includes(spelling)) out.push(spelling)
  }
  return out
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function sameOrInside(root: string, path: string): boolean {
  const r = realOrSelf(root)
  const p = realOrSelf(path)
  return p === r || p.startsWith(`${r}/`)
}

function whichOnPath(command: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) return join(dir, command)
  }
  const system = `/usr/bin/${command}`
  return existsSync(system) ? system : undefined
}
