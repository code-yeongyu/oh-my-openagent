import { dirname, isAbsolute } from "node:path"

import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { SkillLoadOptions } from "../tools/skill/types"
import type { PluginContext } from "./types"

export type RuntimeHostSkills = { paths?: string[]; urls?: string[] }
type NativeSkillAccessor = NonNullable<SkillLoadOptions["nativeSkills"]>
type NativeSkillEntry = Awaited<ReturnType<NativeSkillAccessor["all"]>>[number]
type AppSkillCallParameters =
  | { readonly directory?: string }
  | { readonly query: { readonly directory?: string } }

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isRuntimeHostSkills(value: unknown): value is RuntimeHostSkills {
  if (!isObject(value)) return false
  const paths = Reflect.get(value, "paths")
  const urls = Reflect.get(value, "urls")
  return (paths === undefined || isStringArray(paths)) && (urls === undefined || isStringArray(urls))
}

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
    const data = isObject(result) ? Reflect.get(result, "data") : undefined
    const skills = isObject(data) ? Reflect.get(data, "skills") : undefined
    if (isRuntimeHostSkills(skills)) return skills
  } catch (error) {
    if (!(error instanceof Error)) return undefined
  }
  return undefined
}

function hasFunction(value: object, name: string): boolean {
  return typeof Reflect.get(value, name) === "function"
}

function isNativeSkillAccessor(value: unknown): value is NativeSkillAccessor {
  return isObject(value) && hasFunction(value, "all") && hasFunction(value, "get") && hasFunction(value, "dirs")
}

function nativeSkillEntry(value: unknown): NativeSkillEntry | undefined {
  if (!isObject(value)) return undefined
  const name = Reflect.get(value, "name")
  const description = Reflect.get(value, "description")
  const location = Reflect.get(value, "location")
  const content = Reflect.get(value, "content")
  if (typeof name !== "string" || typeof location !== "string" || typeof content !== "string") return undefined
  return {
    name,
    description: typeof description === "string" ? description : "",
    location,
    content,
  }
}

function nativeSkillEntries(response: unknown): NativeSkillEntry[] {
  if (!isObject(response)) return []
  const data = Reflect.get(response, "data")
  if (!Array.isArray(data)) return []
  return data.flatMap((entry) => {
    const skill = nativeSkillEntry(entry)
    return skill ? [skill] : []
  })
}

function createAppSkillLoader(
  client: PluginContext["client"],
): ((parameters: AppSkillCallParameters) => Promise<NativeSkillEntry[]>) | undefined {
  if (!isObject(client)) return undefined
  const app = Reflect.get(client, "app")
  if (!isObject(app)) return undefined
  const skills = Reflect.get(app, "skills")
  if (typeof skills !== "function") return undefined
  return async (parameters) => {
    const response: unknown = await Reflect.apply(skills, app, [parameters])
    return nativeSkillEntries(response)
  }
}

function legacyNativeSkills(ctx: PluginContext): NativeSkillAccessor | undefined {
  const skills = Reflect.get(ctx, "skills")
  return isNativeSkillAccessor(skills) ? skills : undefined
}

async function loadAppSkills(args: {
  readonly load: (parameters: AppSkillCallParameters) => Promise<NativeSkillEntry[]>
  readonly directory: string
}): Promise<NativeSkillEntry[]> {
  try {
    const direct = await args.load({ directory: args.directory })
    if (direct.length > 0) return direct
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  try {
    return await args.load({ query: { directory: args.directory } })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return []
  }
}

function skillDirs(skills: readonly NativeSkillEntry[]): string[] {
  const dirs = new Set<string>()
  for (const skill of skills) {
    if (isAbsolute(skill.location)) dirs.add(dirname(skill.location))
  }
  return Array.from(dirs)
}

export function createNativeSkillsAccessor(ctx: PluginContext): NativeSkillAccessor | undefined {
  const legacy = legacyNativeSkills(ctx)
  if (legacy) return legacy

  const load = createAppSkillLoader(ctx.client)
  if (!load) return undefined

  const all = () => loadAppSkills({ load, directory: ctx.directory })

  return {
    all,
    async get(name: string) {
      return (await all()).find((skill) => skill.name === name)
    },
    async dirs() {
      return skillDirs(await all())
    },
  }
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
