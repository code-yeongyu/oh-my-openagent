import { existsSync, realpathSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"
import { homedir } from "node:os"
import { sharedSkillsRootPath } from "@oh-my-opencode/shared-skills"
import { getClaudeConfigDir, getOpenCodeConfigDirs, detectWorktreePath } from "../../shared"

export type SkillProvenance = {
  readonly kind: "project-auto" | "user" | "host" | "builtin"
  readonly selectedRoot: string
  readonly projectRoot?: string
  readonly userRoots?: readonly string[]
  readonly userFiles?: readonly string[]
}
export type SkillDiagnostic = {
  readonly type: "warning"
  readonly category: "skill-link-blocked" | "skill-load-error"
  readonly path: string
  readonly message: string
}
export type SkillDiagnosticSink = (diagnostic: SkillDiagnostic) => void
const observers = new Set<SkillDiagnosticSink>()

export function subscribeSkillDiagnostics(sink: SkillDiagnosticSink): () => void {
  observers.add(sink)
  return () => { observers.delete(sink) }
}

export function pathIsInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

function spelledInsideProject(path: string, root: string): boolean {
  if (pathIsInside(path, root)) return true
  // Compare ancestors, not the resolved skill path: /tmp and case aliases can
  // spell the project root differently without making its escaping links trusted.
  try {
    const canonicalRoot = realpathSync.native(root)
    let prefix = dirname(path)
    while (true) {
      try {
        if (realpathSync.native(prefix) === canonicalRoot) return true
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
      const parent = dirname(prefix)
      if (parent === prefix) return false
      prefix = parent
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return false
  }
}

export function knownUserSkillRoots(): string[] {
  const home = homedir()
  return [
    join(getClaudeConfigDir(), "skills"), join(home, ".agents", "skills"),
    join(home, ".omo", "agent", "skills"), join(home, ".senpi", "agent", "skills"),
    sharedSkillsRootPath(),
    ...getOpenCodeConfigDirs({ binary: "opencode" }).flatMap((dir) => [
      join(dir, "skills"), join(dir, "skill"),
    ]),
  ]
}
export function knownHostUserRoots(): string[] {
  return [
    ...knownUserSkillRoots(),
    ...getOpenCodeConfigDirs({ binary: "opencode" }),
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode", "node_modules"),
  ]
}

export function skillProjectRoot(path: string): string {
  let current = resolve(path)
  while (true) {
    if ([".claude", ".agents", ".opencode", ".senpi", ".pi"].some((name) => current.endsWith(`${sep}${name}`))) {
      return dirname(current)
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return detectWorktreePath(existsSync(path) && statSync(path).isDirectory() ? path : dirname(path)) ?? dirname(path)
}

export function skillProvenance(
  path: string,
  scope: string,
  supplied?: SkillProvenance,
): SkillProvenance {
  const projectRoot = supplied?.projectRoot ?? skillProjectRoot(path)
  const kind = supplied?.kind ?? (
    scope === "project" || scope === "opencode-project" ? "project-auto" : scope === "builtin" ? "builtin" : "user"
  )
  // Host classification is lexical: resolving this path first would hide a project link.
  const classified = kind === "host" && spelledInsideProject(resolve(path), resolve(projectRoot)) ? "project-auto" : kind
  return {
    ...supplied, kind: classified, selectedRoot: supplied?.selectedRoot ?? path,
    projectRoot, userRoots: supplied?.userRoots ?? knownUserSkillRoots(),
  }
}

export function userAllowedPaths(provenance: SkillProvenance): { roots: string[]; files: string[] } {
  const roots: string[] = []
  const files: string[] = []
  function walk(path: string, ancestry: ReadonlySet<string>, sourceRoot = false): void {
    try {
      const canonical = realpathSync.native(path)
      if (!statSync(canonical).isDirectory()) { files.push(canonical); return }
      roots.push(canonical)
      if (ancestry.has(canonical)) return
      if (!sourceRoot && (existsSync(join(path, "SKILL.md")) || existsSync(join(path, `${basename(path)}.md`)))) return
      const next = new Set([...ancestry, canonical])
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue
        if (entry.isDirectory() || entry.isSymbolicLink()) walk(join(path, entry.name), next)
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  for (const root of provenance.userRoots ?? knownUserSkillRoots()) walk(root, new Set(), true)
  for (const file of provenance.userFiles ?? []) {
    try { files.push(realpathSync.native(file)) } catch (error) { if (!(error instanceof Error)) throw error }
  }
  return { roots: [...new Set(roots)], files: [...new Set(files)] }
}

function shortPath(path: string): string {
  return pathIsInside(path, homedir()) ? `~${path.slice(homedir().length)}` : path
}

export class SkillLinkBlockedError extends Error {
  readonly diagnostic: SkillDiagnostic
  constructor(path: string, target: string) {
    super(`Blocked skill link outside the project: ${shortPath(path)} -> ${shortPath(target)}. Add the target folder to your user skills settings to allow it.`)
    this.name = "SkillLinkBlockedError"
    this.diagnostic = { type: "warning", category: "skill-link-blocked", path, message: this.message }
  }
}

export function reportSkillBlocked(error: SkillLinkBlockedError, sink?: SkillDiagnosticSink): void {
  sink?.(error.diagnostic)
  for (const observer of observers) if (observer !== sink) observer(error.diagnostic)
}

export function reportSkillLoadError(error: unknown, path: string, sink?: SkillDiagnosticSink): void {
  if (error instanceof SkillLinkBlockedError) {
    reportSkillBlocked(error, sink)
    return
  }
  if (!(error instanceof Error)) throw error
  const diagnostic: SkillDiagnostic = {
    type: "warning", category: "skill-load-error", path,
    message: `Failed to load skill ${shortPath(path)}: ${error.message}`,
  }
  sink?.(diagnostic)
  for (const observer of observers) if (observer !== sink) observer(diagnostic)
}

export function checkSkillPath(path: string, provenance: SkillProvenance, directory = false): string {
  const canonical = realpathSync.native(path)
  if (provenance.kind !== "project-auto") return canonical
  const project = realpathSync.native(provenance.projectRoot ?? skillProjectRoot(path))
  if (pathIsInside(canonical, project)) return canonical
  const allowed = userAllowedPaths(provenance)
  if (allowed.roots.some((root) => pathIsInside(canonical, root)) ||
    allowed.files.includes(canonical) || (directory && allowed.files.some((file) => pathIsInside(file, canonical)))) return canonical
  throw new SkillLinkBlockedError(path, canonical)
}
