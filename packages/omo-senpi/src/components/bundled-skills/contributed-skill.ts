import { existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

import { collectDisabledSkills, loadOmoConfig } from "@oh-my-opencode/omo-config-core"

import type { SenpiExtensionAPI } from "../../extension/types"

export function readDisabledSkills(cwd: string, env: Record<string, string | undefined>): ReadonlySet<string> {
  const loaded = loadOmoConfig({ cwd, env })
  return new Set(collectDisabledSkills({
    harness: "senpi",
    layers: loaded.layers,
    ...(loaded.profile === undefined ? {} : { profile: loaded.profile }),
  }))
}

export type ContributedSkill =
  | { readonly kind: "contributed"; readonly path: string }
  | { readonly kind: "disabled" }
  | { readonly kind: "yielded"; readonly ownerPath: string | undefined }

export interface ResolveContributedSkillOptions {
  readonly pi: SenpiExtensionAPI
  readonly name: string
  readonly path: () => string
  readonly cwd: string
  readonly env: Record<string, string | undefined>
}

/**
 * One `resources_discover` pass for a skill an omo component contributes on its own (computer-use,
 * x-search), as opposed to the bundled skills directory.
 *
 * senpi appends extension skill paths after the user, project, settings and package skills it has
 * already loaded, keeps the first skill of each name, and reports every later one as a "Skill
 * conflicts" collision (#9160). A same-name skill that is already loaded wins either way, so ours
 * yields without a word. Our own copy left over from an earlier pass is not a rival. `disabled_skills`
 * hides the skill exactly as it hides a bundled one.
 */
export function resolveContributedSkill(options: ResolveContributedSkillOptions): ContributedSkill {
  if (readDisabledSkills(options.cwd, options.env).has(options.name)) return { kind: "disabled" }
  const command = `skill:${options.name}`
  const loaded = options.pi.getCommands?.().find((entry) => entry.source === "skill" && entry.name === command)
  const path = options.path()
  if (loaded === undefined) return { kind: "contributed", path }
  const ownerPath = loaded.sourceInfo?.path
  if (ownerPath !== undefined && canonicalPath(ownerPath) === canonicalPath(path)) return { kind: "contributed", path }
  return { kind: "yielded", ownerPath }
}

export function readDiscoverCwd(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object") return undefined
  const cwd = Reflect.get(payload, "cwd")
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

function canonicalPath(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path)
}
