import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { readDisabledSkills } from "../bundled-skills/contributed-skill"
import { resolveBundledSkillsDir } from "../bundled-skills"

/**
 * Skills a session created by `thread_create` / `omo thread create` runs with from its first turn
 * (`skills: ["gateway-lead"]`): each named skill's body becomes part of the session's instructions,
 * without a slash command and without starting a turn.
 *
 * - The creator checks every name before the session exists: a name that is not a skill name, or
 *   that no skill directory the session would load from holds, refuses the create.
 * - The list rides on the `open_session` context (`initial_skills`), and the session's own thread
 *   component copies it into a durable session entry (`omo-initial-skills`) on its first start, so a
 *   restart that re-opens the session re-applies it whatever the re-open passed.
 * - Inside the session the skill is looked up in the session's own registry
 *   (`systemPromptOptions.skills`, the same scope and trust rules as a `/skill` load) on every turn;
 *   a name the registry does not hold then (disabled since) is skipped and logged once.
 */
export const INITIAL_SKILLS_CONTEXT_KEY = "initial_skills"
export const INITIAL_SKILLS_ENTRY = "omo-initial-skills"

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export type InitialSkillsCheck =
  | { readonly kind: "ok"; readonly names: readonly string[] }
  | { readonly kind: "invalid"; readonly names: readonly string[] }
  | { readonly kind: "unknown"; readonly names: readonly string[] }

export type SkillLookup = { readonly cwd: string; readonly agentDir: string; readonly env?: Record<string, string | undefined>; readonly bundledSkillsDir?: string }

/**
 * Where a session would load a skill from: omo's bundled skills (unless `disabled_skills` hides
 * it), then the project's `.senpi/skills`, then the agent dir's `skills`.
 */
export function findSkillFile(name: string, lookup: SkillLookup): string | undefined {
  const bundled = lookup.bundledSkillsDir ?? resolveBundledSkillsDir()
  const dirs: string[] = []
  if (bundled !== undefined && !readDisabledSkills(lookup.cwd, lookup.env ?? process.env).has(name)) dirs.push(bundled)
  dirs.push(join(lookup.cwd, ".senpi", "skills"), join(lookup.agentDir, "skills"))
  return dirs.map((dir) => join(dir, name, "SKILL.md")).find((file) => existsSync(file))
}

/** Names only: a path, raw text or anything not shaped like a skill name is `invalid`; a name no skill directory holds is `unknown`. Duplicates collapse, order kept. */
export function checkInitialSkills(names: readonly string[], lookup: SkillLookup): InitialSkillsCheck {
  const unique = [...new Set(names)]
  const invalid = unique.filter((name) => !SKILL_NAME.test(name))
  if (invalid.length > 0) return { kind: "invalid", names: invalid }
  const unknown = unique.filter((name) => findSkillFile(name, lookup) === undefined)
  if (unknown.length > 0) return { kind: "unknown", names: unknown }
  return { kind: "ok", names: unique }
}

function namesFrom(value: unknown): readonly string[] | undefined {
  const parsed = typeof value === "string" ? safeJson(value) : value
  if (!Array.isArray(parsed)) return undefined
  const names = parsed.filter((name): name is string => typeof name === "string" && SKILL_NAME.test(name))
  return names.length > 0 ? names : undefined
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function persistedNames(eventCtx: unknown): readonly string[] | undefined {
  const manager = (eventCtx as { readonly sessionManager?: { readonly getEntries?: () => readonly unknown[] } } | undefined)?.sessionManager
  const entries = typeof manager?.getEntries === "function" ? manager.getEntries() : []
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { readonly type?: unknown; readonly customType?: unknown; readonly data?: { readonly names?: unknown } } | undefined
    if (entry?.type === "custom" && entry.customType === INITIAL_SKILLS_ENTRY) return namesFrom(entry.data?.names)
  }
  return undefined
}

function skillBodyWithoutFrontmatter(filePath: string): string {
  const text = readFileSync(filePath, "utf8")
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text)
  return (match === null ? text : text.slice(match[0].length)).trim()
}

type RegistrySkill = { readonly name?: unknown; readonly filePath?: unknown }

export function registerInitialSkills(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
  let names: readonly string[] | undefined
  const bodies = new Map<string, string>()
  const warned = new Set<string>()
  pi.on("session_start", (_event, eventCtx) => {
    const persisted = persistedNames(eventCtx)
    const fromContext = namesFrom((pi.sessionContext as Readonly<Record<string, unknown>> | undefined)?.[INITIAL_SKILLS_CONTEXT_KEY])
    names = persisted ?? fromContext
    if (persisted === undefined && fromContext !== undefined) pi.appendEntry?.(INITIAL_SKILLS_ENTRY, { names: fromContext })
  })
  pi.on("before_agent_start", (payload: unknown) => {
    if (names === undefined) return undefined
    const event = payload as { readonly systemPrompt?: unknown; readonly systemPromptOptions?: { readonly skills?: readonly RegistrySkill[] } }
    if (typeof event.systemPrompt !== "string") return undefined
    const registry = event.systemPromptOptions?.skills ?? []
    const blocks: string[] = []
    for (const name of names) {
      const skill = registry.find((candidate) => candidate.name === name)
      if (skill === undefined || typeof skill.filePath !== "string") {
        if (!warned.has(name)) {
          warned.add(name)
          ctx.logger.warn(`thread: initial skill ${name} is not in this session's skills; it is not applied`)
        }
        continue
      }
      let body = bodies.get(name)
      if (body === undefined) {
        try {
          body = skillBodyWithoutFrontmatter(skill.filePath)
        } catch (error) {
          if (!warned.has(name)) {
            warned.add(name)
            ctx.logger.warn(`thread: initial skill ${name} could not be read: ${error instanceof Error ? error.message : String(error)}`)
          }
          continue
        }
        bodies.set(name, body)
      }
      blocks.push(`<initial_skill name="${name}">\n${body}\n</initial_skill>`)
    }
    if (blocks.length === 0) return undefined
    return { systemPrompt: `${event.systemPrompt}\n\n${blocks.join("\n\n")}` }
  }, { previewSafe: true })
}
