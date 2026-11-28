import { constants } from "node:fs"
import { access, realpath, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path"

const REPOSITORY_MARKERS = [".atomic", ".atomic-sandbox", ".git"] as const

export type AtomicExecutableSearch = {
  readonly binaryPath: string | undefined
  readonly pathValue: string | undefined
  readonly cwd: string
  readonly platform: NodeJS.Platform
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function canonicalPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    return undefined
  }
}

async function findRepositoryRoot(start: string): Promise<string> {
  let directory = start
  for (;;) {
    for (const marker of REPOSITORY_MARKERS) {
      if ((await canonicalPath(join(directory, marker))) !== undefined) return directory
    }
    const parent = dirname(directory)
    if (parent === directory) return start
    directory = parent
  }
}

function isWithin(root: string, candidate: string): boolean {
  const offset = relative(root, candidate)
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset))
}

/**
 * The configured binary_path wins. Otherwise PATH is searched, skipping empty and relative segments and every
 * directory inside the working directory or its repository, so a repository cannot plant the executable omo runs.
 */
export async function resolveAtomicExecutable(search: AtomicExecutableSearch): Promise<string | undefined> {
  if (search.binaryPath !== undefined) {
    return (await isExecutableFile(search.binaryPath)) ? search.binaryPath : undefined
  }

  const cwd = (await canonicalPath(search.cwd)) ?? search.cwd
  const repositoryRoot = await findRepositoryRoot(cwd)
  const untrusted = (path: string): boolean => isWithin(repositoryRoot, path) || isWithin(cwd, path)
  const delimiter = search.platform === "win32" ? ";" : ":"
  const fileName = search.platform === "win32" ? "atomic.exe" : "atomic"

  for (const segment of (search.pathValue ?? "").split(delimiter)) {
    if (segment.length === 0 || !isAbsolute(segment)) continue
    const directory = await canonicalPath(segment)
    if (directory === undefined || untrusted(directory)) continue
    const candidate = join(directory, fileName)
    const target = await canonicalPath(candidate)
    if (target === undefined || untrusted(target)) continue
    if (await isExecutableFile(candidate)) return candidate
  }
  return undefined
}
