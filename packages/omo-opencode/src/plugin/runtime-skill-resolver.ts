import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { PluginContext } from "./types"

export type RuntimeHostSkills = { paths?: string[]; urls?: string[] }

/**
 * Read `skills` from opencode's merged runtime config via the plugin client.
 * This includes skill source paths that other plugins add to the merged config
 * through their `config` hooks, which the on-disk config reader cannot see.
 *
 * MUST only be called after server startup (e.g. at tool-execute time). Calling
 * it during plugin load deadlocks: the plugin's `server()` runs inside the
 * config/plugin initialization, so a roundtrip back to `/config` waits on an
 * initialization that cannot complete until `server()` returns.
 *
 * Returns undefined on any failure so callers can fall back to base skills.
 */
export async function readRuntimeHostSkills(
  client: PluginContext["client"],
): Promise<RuntimeHostSkills | undefined> {
  try {
    const result = await client.config.get()
    const skills = (result as { data?: { skills?: unknown } }).data?.skills
    if (skills && typeof skills === "object") {
      return skills as RuntimeHostSkills
    }
  } catch {
    // Fall back to base skills in the caller.
  }
  return undefined
}

/**
 * Build a lazily-evaluated, cached resolver for the skill list used by
 * `skill_mcp`.
 *
 * The base skill list is built during plugin load, before any plugin's `config`
 * hook runs, so it cannot see skill source paths that other plugins add to the
 * merged config at load time. Reading the merged config requires a server
 * roundtrip that deadlocks during plugin load, so the fetch is deferred to the
 * first `skill_mcp` call (after startup) and cached. On any failure the base
 * skills are returned unchanged.
 */
export function createRuntimeSkillsResolver(args: {
  baseSkills: LoadedSkill[]
  readRuntimeHostSkills: () => Promise<RuntimeHostSkills | undefined>
  buildMergedSkills: (hostSkills: RuntimeHostSkills) => Promise<LoadedSkill[]>
}): () => Promise<LoadedSkill[]> {
  const { baseSkills, readRuntimeHostSkills: readHostSkills, buildMergedSkills } = args
  let inflight: Promise<LoadedSkill[]> | undefined

  const resolve = async (): Promise<LoadedSkill[]> => {
    const hostSkills = await readHostSkills()
    if (!hostSkills) return baseSkills
    try {
      return await buildMergedSkills(hostSkills)
    } catch {
      return baseSkills
    }
  }

  return () => {
    if (!inflight) inflight = resolve()
    return inflight
  }
}
