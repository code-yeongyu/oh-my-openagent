import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

export interface HostCommandInfo {
  readonly name: string
  readonly description?: string
  readonly source: string
}

export const SKILL_COMMAND_PREFIX = "skill:"

const BARE_COMMAND_PATTERN = /^\/([a-z0-9][a-z0-9-]*)(?=\s|$)/

export interface BareSkillCommand {
  readonly name: string
  readonly rest: string
}

export type BareSkillCommandResolution =
  | { readonly kind: "not-bare-skill" }
  | { readonly kind: "shadowed" }
  | { readonly kind: "unavailable"; readonly name: string }
  | { readonly kind: "expand"; readonly text: string }

export function parseBareSkillCommand(text: string, bundledSkillNames: ReadonlySet<string>): BareSkillCommand | undefined {
  const match = BARE_COMMAND_PATTERN.exec(text)
  const name = match?.[1]
  if (name === undefined || !bundledSkillNames.has(name)) return undefined
  return { name, rest: text.slice(name.length + 1) }
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
  const command = parseBareSkillCommand(text, bundledSkillNames)
  if (command === undefined) return { kind: "not-bare-skill" }
  if (hostCommands !== undefined) {
    // A user prompt template or another extension's command with the same name owns that name.
    if (hostCommands.some((entry) => entry.name === command.name)) return { kind: "shadowed" }
    const skillCommand = `${SKILL_COMMAND_PREFIX}${command.name}`
    if (!hostCommands.some((entry) => entry.name === skillCommand)) return { kind: "unavailable", name: command.name }
  }
  return { kind: "expand", text: `/${SKILL_COMMAND_PREFIX}${command.name}${command.rest}` }
}

export function readBundledSkillNames(skillsDir: string | undefined): ReadonlySet<string> {
  if (skillsDir === undefined || !existsSync(skillsDir)) return new Set()
  return new Set(readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md"))))
}
