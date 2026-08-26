import { dirname, join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { findProjectConfigPathsFarthestFirst, MAX_PROJECT_CONFIG_DIRECTORY_DEPTH } from "./paths"
import type { OmoConfigReadFileSystem } from "./types"

function projectConfigPath(directory: string): string {
  return join(directory, ".omo", "omo.jsonc")
}

function makeProjectFileSystem(
  configDirectories: readonly string[],
  symlinkedOmoDirectories: readonly string[] = [],
): OmoConfigReadFileSystem {
  const configPaths = configDirectories.map(projectConfigPath)
  const existingPaths = new Set([
    ...configDirectories.map((directory) => join(directory, ".omo")),
    ...configPaths,
    ...symlinkedOmoDirectories,
  ])
  const symlinkedPaths = new Set(symlinkedOmoDirectories)

  return {
    existsSync: (path: string): boolean => existingPaths.has(path),
    lstatSync: (path: string) => ({ isSymbolicLink: (): boolean => symlinkedPaths.has(path) }),
    readFileSync: (): string => "{}",
  }
}

function nestedPath(rootDir: string, depth: number): string {
  let path = rootDir
  for (let index = 0; index < depth; index += 1) path = join(path, `level-${index}`)
  return path
}

describe("findProjectConfigPathsFarthestFirst", () => {
  test("#given cwd outside HOME and a grandparent config #when resolving project paths #then it is discovered", () => {
    // given
    const homeDir = resolve("/home/alice")
    const configDir = resolve("/opt/work")
    const cwd = join(configDir, "project", "sub")
    const fileSystem = makeProjectFileSystem([configDir])

    // when
    const paths = findProjectConfigPathsFarthestFirst(cwd, homeDir, fileSystem)

    // then
    expect(paths).toEqual([projectConfigPath(configDir)])
  })

  test("#given nested project configs inside HOME #when resolving project paths #then they are farthest-first", () => {
    // given
    const homeDir = resolve("/home/alice")
    const configDirectories = [join(homeDir, "work"), join(homeDir, "work", "project"), join(homeDir, "work", "project", "src")]
    const cwd = configDirectories[2]
    const fileSystem = makeProjectFileSystem(configDirectories)

    // when
    const paths = findProjectConfigPathsFarthestFirst(cwd, homeDir, fileSystem)

    // then
    expect(paths).toEqual(configDirectories.map(projectConfigPath))
  })

  test("#given HOME has a user config #when resolving project paths #then HOME is excluded", () => {
    // given
    const homeDir = resolve("/home/alice")
    const projectDir = join(homeDir, "work", "project")
    const fileSystem = makeProjectFileSystem([homeDir, projectDir])

    // when
    const paths = findProjectConfigPathsFarthestFirst(join(projectDir, "src"), homeDir, fileSystem)

    // then
    expect(paths).toEqual([projectConfigPath(projectDir)])
  })

  test("#given overridden HOME outside the account home #when resolving project paths #then the account user config is excluded", () => {
    // given
    const configuredHomeDir = resolve("/tmp/isolated-home")
    const accountHomeDir = resolve("/home/alice")
    const projectDir = join(accountHomeDir, "work", "project")
    const fileSystem = makeProjectFileSystem([accountHomeDir, projectDir])

    // when
    const paths = findProjectConfigPathsFarthestFirst(
      join(projectDir, "src"),
      configuredHomeDir,
      fileSystem,
      accountHomeDir,
    )

    // then
    expect(paths).toEqual([projectConfigPath(projectDir)])
  })

  test("#given a symlinked project .omo directory #when resolving project paths #then it is refused", () => {
    // given
    const projectDir = resolve("/opt/work/project")
    const omoDir = join(projectDir, ".omo")
    const fileSystem = makeProjectFileSystem([projectDir], [omoDir])

    // when
    const paths = findProjectConfigPathsFarthestFirst(projectDir, resolve("/home/alice"), fileSystem)

    // then
    expect(paths).toEqual([])
  })

  test("#given no project configs #when resolving project paths #then it returns an empty list", () => {
    expect(findProjectConfigPathsFarthestFirst(resolve("/opt/work/project"), resolve("/home/alice"), makeProjectFileSystem([]))).toEqual([])
  })

  test("#given cwd exceeds the maximum walk depth #when resolving project paths #then the walk is bounded", () => {
    // given
    const rootDir = resolve("/opt")
    const homeDir = resolve("/home/alice")
    const checkedDirectories: string[] = []
    const fileSystem: OmoConfigReadFileSystem = {
      existsSync: (path: string): boolean => {
        if (path.endsWith(join(".omo", "omo.jsonc"))) checkedDirectories.push(dirname(dirname(path)))
        return false
      },
      readFileSync: (): string => "{}",
    }

    // when
    const paths = findProjectConfigPathsFarthestFirst(nestedPath(rootDir, MAX_PROJECT_CONFIG_DIRECTORY_DEPTH + 1), homeDir, fileSystem)

    // then
    expect(paths).toEqual([])
    expect(checkedDirectories).toHaveLength(MAX_PROJECT_CONFIG_DIRECTORY_DEPTH)
    expect(checkedDirectories).not.toContain(rootDir)
  })
})
