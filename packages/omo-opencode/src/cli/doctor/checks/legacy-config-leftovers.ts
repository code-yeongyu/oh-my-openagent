import { posix, win32 } from "node:path"

import { createLegacyConfigMigrationPlans } from "../../../config-migration"
import type { ConfigMigrationPathOperations } from "../../../config-migration"
import type { DoctorIssue } from "../framework/types"

export type LegacyConfigLeftoverOptions = {
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
  readonly pathOperations?: ConfigMigrationPathOperations
}

export function findLegacyConfigLeftovers(options: LegacyConfigLeftoverOptions): readonly string[] {
  const pathOperations = options.pathOperations ?? (process.platform === "win32" ? win32 : posix)
  const paths = createLegacyConfigMigrationPlans({
    cwd: options.cwd,
    environment: options.environment ?? process.env,
    homeDir: options.homeDir,
    pathOperations,
    platform: process.platform,
  }).flatMap((plan) => plan.sources.map((source) => source.path))
  return [...new Set(paths)].sort()
}

export function legacyConfigLeftoverWarning(paths: readonly string[]): DoctorIssue | undefined {
  if (paths.length === 0) return undefined
  return {
    affects: ["configuration migration"],
    description: `Legacy configuration remains at ${paths.join(", ")}. It is not part of the unified OMO config chain.`,
    fix: "Run `oh-my-openagent config migrate` to move it into ~/.omo/omo.jsonc.",
    severity: "warning",
    title: "Legacy OMO configuration remains",
  }
}
