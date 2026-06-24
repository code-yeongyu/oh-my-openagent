import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

export type OmoConfigSourceScope = "global" | "project"

export interface OmoConfigSource {
  readonly exists: boolean
  readonly loaded: boolean
  readonly path: string
  readonly scope: OmoConfigSourceScope
}

export interface ResolveOmoConfigPathsOptions {
  readonly cwd: string
  readonly homeDir: string
}

export interface OmoConfigPathCandidate {
  readonly path: string
  readonly scope: OmoConfigSourceScope
}

function containsPath(parent: string, child: string): boolean {
  const pathToChild = relative(parent, child)
  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild))
}

function findProjectConfigPathsNearestFirst(cwd: string, homeDir: string): string[] {
  const startDir = resolve(cwd)
  const stopBeforeDir = containsPath(resolve(homeDir), startDir) ? resolve(homeDir) : null
  const paths: string[] = []
  let currentDir = startDir

  while (true) {
    if (stopBeforeDir !== null && currentDir === stopBeforeDir) break

    const configPath = join(currentDir, ".omo", "config.jsonc")
    if (existsSync(configPath)) {
      paths.push(configPath)
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return paths
}

export function resolveOmoConfigPaths(options: ResolveOmoConfigPathsOptions): readonly OmoConfigPathCandidate[] {
  const globalPath = join(resolve(options.homeDir), ".omo", "config.jsonc")
  const projectPathsFarthestFirst = findProjectConfigPathsNearestFirst(options.cwd, options.homeDir).reverse()

  return [
    { path: globalPath, scope: "global" },
    ...projectPathsFarthestFirst.map((path): OmoConfigPathCandidate => ({ path, scope: "project" })),
  ]
}

export function toMissingSource(candidate: OmoConfigPathCandidate): OmoConfigSource {
  return {
    exists: false,
    loaded: false,
    path: candidate.path,
    scope: candidate.scope,
  }
}
