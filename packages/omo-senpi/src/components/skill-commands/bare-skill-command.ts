import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { resolveSkillAlias } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/skill-name-aliases"

export interface HostCommandInfo {
  readonly name: string
  readonly description?: string
  readonly source: string
}

export const SKILL_COMMAND_PREFIX = "skill:"

const BARE_COMMAND_PATTERN = /^\/([a-z0-9][a-z0-9-]*)(?=\s|$)/
const SKILL_COMMAND_PATTERN = /^\/skill:([a-z0-9][a-z0-9-]*)(?=\s|$)/

export interface BareSkillCommand {
  readonly typed: string
  readonly name: string
  readonly rest: string
}

export type BareSkillCommandResolution =
  | { readonly kind: "not-bare-skill" }
  | { readonly kind: "shadowed" }
  | { readonly kind: "unavailable"; readonly name: string }
  | { readonly kind: "expand"; readonly text: string }

export function parseBareSkillCommand(
  text: string,
  bundledSkillNames: ReadonlySet<string>,
): BareSkillCommand | undefined {
  const typed = BARE_COMMAND_PATTERN.exec(text)?.[1]
  if (typed === undefined) return undefined
  const name = resolveSkillAlias(typed)
  if (!bundledSkillNames.has(name)) return undefined
  return { typed, name, rest: text.slice(typed.length + 1) }
}

/**
 * Decide what a bare `/<bundled-skill> args` submission becomes.
 *
 * `hostCommands` is `pi.getCommands()`; `undefined` means the host predates that API, in which case
 * the rewrite happens unconditionally (senpi leaves an unknown `/skill:` literal, which is no worse
 * than the bare text it replaces).
 */
export function resolveBareSkillCommand(
  text: string,
  bundledSkillNames: ReadonlySet<string>,
  hostCommands: readonly HostCommandInfo[] | undefined,
): BareSkillCommandResolution {
  const hasHostCommand = (name: string): boolean => hostCommands?.some((entry) => entry.name === name) ?? false
  const retired = SKILL_COMMAND_PATTERN.exec(text)?.[1]
  if (retired !== undefined) {
    const name = resolveSkillAlias(retired)
    if (name === retired || !bundledSkillNames.has(name)) return { kind: "not-bare-skill" }
    // A live skill installed under the exact retired name keeps it.
    if (hasHostCommand(`${SKILL_COMMAND_PREFIX}${retired}`)) return { kind: "not-bare-skill" }
    if (hostCommands !== undefined && !hasHostCommand(`${SKILL_COMMAND_PREFIX}${name}`))
      return { kind: "unavailable", name }
    return {
      kind: "expand",
      text: `/${SKILL_COMMAND_PREFIX}${name}${text.slice(SKILL_COMMAND_PREFIX.length + retired.length + 1)}`,
    }
  }
  const command = parseBareSkillCommand(text, bundledSkillNames)
  if (command === undefined) return { kind: "not-bare-skill" }
  if (hostCommands !== undefined) {
    // A user prompt template or another extension's command with the same name owns that name.
    if (hasHostCommand(command.typed)) return { kind: "shadowed" }
    // A live skill installed under the exact retired name wins over the skill that replaced it.
    if (command.typed !== command.name && hasHostCommand(`${SKILL_COMMAND_PREFIX}${command.typed}`))
      return { kind: "expand", text: `/${SKILL_COMMAND_PREFIX}${command.typed}${command.rest}` }
    const skillCommand = `${SKILL_COMMAND_PREFIX}${command.name}`
    if (!hostCommands.some((entry) => entry.name === skillCommand)) return { kind: "unavailable", name: command.name }
  }
  return { kind: "expand", text: `/${SKILL_COMMAND_PREFIX}${command.name}${command.rest}` }
}

export function readBundledSkillNames(skillsDir: string | undefined): ReadonlySet<string> {
  if (skillsDir === undefined || !existsSync(skillsDir)) return new Set()
  return new Set(readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md"))))
}
