import { homedir } from "os"
import { isAbsolute, join, resolve } from "path"
import { isWithinProject } from "./contains-path"
import { log } from "./logger"

export function resolveAgentDefinitionPaths(
  paths: string[],
  baseDir: string,
  containmentDir: string | null
): string[] {
  return paths.flatMap((p) => {
    const expanded = p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
    const resolved = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)

    if (containmentDir !== null && !isWithinProject(resolved, containmentDir)) {
      log(`agent_definitions path rejected (outside project boundary): ${p} -> ${resolved}`)
      return []
    }

    return [resolved]
  })
}
