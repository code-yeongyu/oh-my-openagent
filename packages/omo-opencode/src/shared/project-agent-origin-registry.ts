import { dirname, resolve } from "node:path"

const projectAgentOriginsByDirectory = new Map<string, ReadonlySet<string>>()

export function registerProjectAgentOrigins(directory: string, agentNames: Iterable<string>): void {
  const normalizedDirectory = resolve(directory)
  const origins = new Set(agentNames)
  if (origins.size === 0) {
    projectAgentOriginsByDirectory.delete(normalizedDirectory)
    return
  }
  projectAgentOriginsByDirectory.set(normalizedDirectory, origins)
}

export function hasProjectAgentOrigin(directory: string, agentName: string): boolean {
  let candidateDirectory = resolve(directory)
  while (true) {
    const origins = projectAgentOriginsByDirectory.get(candidateDirectory)
    if (origins !== undefined) return origins.has(agentName)

    const parentDirectory = dirname(candidateDirectory)
    if (parentDirectory === candidateDirectory) return false
    candidateDirectory = parentDirectory
  }
}

export function clearProjectAgentOrigins(): void {
  projectAgentOriginsByDirectory.clear()
}
