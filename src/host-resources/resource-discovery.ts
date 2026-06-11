import { existsSync } from "node:fs"
import { join } from "node:path"

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
