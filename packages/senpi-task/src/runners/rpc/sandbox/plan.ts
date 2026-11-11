import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"

export type DenyLivePolicy = "deny-live"

export type DenyLiveInput = {
  readonly platform: NodeJS.Platform
  readonly home: string
  readonly agentDir: string
  readonly stateDir: string
  readonly cwd: string
  // Code the child loads (its -e extension entries, the engine launcher), resolved by the caller.
  readonly codeRoots: readonly string[]
  readonly liveRoot?: string
  readonly uid?: number
  readonly which?: (command: string) => string | undefined
}

/**
 * One confinement (senpi#6287 design v5): every write is denied except the task cwd, the reviewer
 * report dir and the child's own state dir; inside the cwd the dirs and files the engine and git load
 * from are read-only again. Rules apply in field order and a later rule wins (bwrap mount order,
 * Seatbelt rule order). Paths are the parent-resolved real paths.
 */
export type DenyLivePlan = {
  readonly platform: "linux" | "darwin"
  readonly backend: string
  readonly home: string
  readonly liveRoot: string
  readonly agentDir: string
  readonly cwd: string
  readonly projectControl: readonly string[]
  readonly artifactDir: string
  readonly stateDir: string
  readonly viewDir: string
  readonly tmpDir: string
  readonly codeRoots: readonly string[]
  // Linux only: private tmpfs mounts (writable scratch, and the user sockets under them hidden).
  readonly privateDirs: readonly string[]
}

export type DenyLiveDecision =
  { readonly kind: "confined"; readonly plan: DenyLivePlan } | { readonly kind: "unavailable"; readonly reason: string }

// What the engine and git load from a project: project-local extensions, skills, settings and MCP
// servers (senpi package-manager / mcp config, the legacy `.pi` dir), and the repository config/hooks.
export const PROJECT_CONTROL_ENTRIES = [".git", ".omo", ".agents", ".claude", ".senpi", ".pi", ".mcp.json"] as const

// Reviewer reports land here (the curated reviewer prompts); it is writable again after `.omo`.
export const ARTIFACT_DIR = join(".omo", "evidence")

export function planDenyLive(input: DenyLiveInput): DenyLiveDecision {
  if (input.platform !== "linux" && input.platform !== "darwin") {
    return { kind: "unavailable", reason: `no deny-live sandbox exists on ${input.platform}` }
  }
  const which = input.which ?? whichOnPath
  const backend = input.platform === "darwin" ? which("sandbox-exec") : which("bwrap")
  if (backend === undefined) {
    return { kind: "unavailable", reason: input.platform === "darwin" ? "sandbox-exec not found" : "bwrap not found" }
  }
  const liveRootLiteral = input.liveRoot ?? join(input.home, ".omo")
  if (!existsSync(liveRootLiteral))
    return { kind: "unavailable", reason: `the live engine root ${liveRootLiteral} does not exist` }
  const cwd = realOrSelf(input.cwd)
  const stateDir = realOrSelf(input.stateDir)
  const codeRoots = input.codeRoots.map(realOrSelf)
  const inside = codeRoots.find((root) => sameOrInside(cwd, root) || sameOrInside(stateDir, root))
  if (inside !== undefined) {
    return {
      kind: "unavailable",
      reason: `the engine loads code from ${inside}, inside the child's writable tree; run the reviewer in an isolated checkout`,
    }
  }
  const runUser = input.uid === undefined ? undefined : join("/run/user", String(input.uid))
  return {
    kind: "confined",
    plan: {
      platform: input.platform,
      backend,
      home: realOrSelf(input.home),
      liveRoot: realOrSelf(liveRootLiteral),
      agentDir: realOrSelf(input.agentDir),
      cwd,
      projectControl: PROJECT_CONTROL_ENTRIES.map((name) => join(cwd, name)),
      artifactDir: join(cwd, ARTIFACT_DIR),
      stateDir,
      viewDir: join(stateDir, "agent-view"),
      tmpDir: join(stateDir, "sandbox-tmp"),
      codeRoots,
      privateDirs:
        input.platform === "linux" ? ["/tmp", ...(runUser !== undefined && existsSync(runUser) ? [runUser] : [])] : [],
    },
  }
}

export function defaultLiveRoot(): string {
  return join(homedir(), ".omo")
}

export function sameOrInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`)
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function whichOnPath(command: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.length > 0 && existsSync(join(dir, command))) return join(dir, command)
  }
  const system = `/usr/bin/${command}`
  return existsSync(system) ? system : undefined
}
