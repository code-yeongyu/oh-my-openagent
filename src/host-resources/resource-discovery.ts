import { existsSync } from "node:fs"
import { join } from "node:path"
import { loadSkillsFromDir } from "../features/opencode-skill-loader"
import type { NativeSkillEntry } from "../tools/skill/native-skills"

export type TargetResourcesDiscoverEvent = {
  type: "resources_discover"
  cwd: string
  reason: "startup" | "reload"
}

export type TargetResourcesDiscoverResult = {
  skillPaths?: string[]
  promptPaths?: string[]
  themePaths?: string[]
}

export type TargetResourceApi = {
  on(
    event: "resources_discover",
    handler: (event: TargetResourcesDiscoverEvent, context: unknown) => TargetResourcesDiscoverResult | Promise<TargetResourcesDiscoverResult>,
  ): void
}

function existing(paths: readonly string[]): string[] {
  return paths.filter((path) => existsSync(path))
}

export function discoverTargetResourcePaths(packageRoot: string, cwd: string): TargetResourcesDiscoverResult {
  return {
    skillPaths: existing([
      join(cwd, ".agents", "skills"),
      join(cwd, ".opencode", "skills"),
      join(packageRoot, ".agents", "skills"),
      join(packageRoot, ".opencode", "skills"),
      join(packageRoot, "packages", "shared-skills", "skills"),
    ]),
    promptPaths: existing([
      join(cwd, ".agents", "command"),
      join(cwd, ".opencode", "command"),
      join(packageRoot, ".agents", "command"),
      join(packageRoot, ".opencode", "command"),
    ]),
  }
}

export function registerTargetResourceDiscovery(api: TargetResourceApi, packageRoot: string): void {
  api.on("resources_discover", (event) => discoverTargetResourcePaths(packageRoot, event.cwd))
}

export function createTargetNativeSkillAccessor(packageRoot: string, cwd: string): {
  all(): Promise<NativeSkillEntry[]>
  get(name: string): Promise<NativeSkillEntry | undefined>
  dirs(): string[]
} {
  const skillPaths = discoverTargetResourcePaths(packageRoot, cwd).skillPaths ?? []

  const all = async (): Promise<NativeSkillEntry[]> => {
    const loaded = await Promise.all(
      skillPaths.map((skillsDir, index) => loadSkillsFromDir({
        skillsDir,
        scope: index < 2 ? "project" : "config",
      })),
    )
    const byName = new Map<string, NativeSkillEntry>()
    for (const skill of loaded.flat()) {
      if (byName.has(skill.name)) continue
      byName.set(skill.name, {
        name: skill.name,
        description: skill.definition.description ?? "",
        location: skill.path ?? skill.resolvedPath ?? skillsDirFallback(skillPaths),
        content: skill.definition.template ?? "",
      })
    }
    return [...byName.values()]
  }

  return {
    all,
    async get(name) {
      return (await all()).find((skill) => skill.name === name)
    },
    dirs: () => [...skillPaths],
  }
}

function skillsDirFallback(skillPaths: readonly string[]): string {
  return skillPaths[0] ?? process.cwd()
}
