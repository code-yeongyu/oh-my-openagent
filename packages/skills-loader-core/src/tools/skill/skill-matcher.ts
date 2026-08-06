import { sortByScopePriority } from "./scope-priority"
import type { CommandInfoLike } from "../../types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

export function matchSkillByName(skills: LoadedSkill[], requestedName: string): LoadedSkill | undefined {
  const normalizedName = requestedName.toLowerCase()

  const exactMatch = skills.find((skill) => skill.name.toLowerCase() === normalizedName)
  if (exactMatch) {
    return exactMatch
  }

  const shortNameMatches = skills.filter((skill) => {
    const parts = skill.name.split("/")
    const shortName = parts[parts.length - 1]
    return parts.length > 1 && shortName?.toLowerCase() === normalizedName
  })

  if (shortNameMatches.length === 1) {
    return shortNameMatches[0]
  }

  return undefined
}

export function matchCommandByName<TCommand extends CommandInfoLike>(commands: TCommand[], requestedName: string): TCommand | undefined {
  const normalizedName = requestedName.toLowerCase()
  return sortByScopePriority(commands).find((command) => command.name.toLowerCase() === normalizedName)
}

export function findPartialMatches(
  skills: LoadedSkill[],
  commands: CommandInfoLike[],
  requestedName: string
): string[] {
  const normalizedName = requestedName.toLowerCase()
  return [
    ...skills.map((skill) => skill.name),
    ...commands.map((command) => `/${command.name}`),
  ].filter((name) => name.toLowerCase().includes(normalizedName))
}
