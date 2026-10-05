import { join } from "node:path"

export const POSIX_HOME = "/home/dev"

// The unit surface drives the module with `platform: "linux"`, so the module spells its paths with
// posix.join while the fixtures spell theirs with the HOST's path.join. On Windows those two
// spellings never meet - `/home/dev/.bun/bin/bun` against `\home\dev\.bun\bin\bun` - and every
// lookup misses. Mirroring the module's own darwin/linux gate is the honest fix: the repair itself
// returns `skipped-platform` on Windows, so there is no Windows behaviour here left to cover.
export const NON_POSIX_HOST = process.platform === "win32"

export type ShimStats = { isSymbolicLink(): boolean; isFile(): boolean }

export type Options = {
  scriptPath?: string
  env?: Record<string, string | undefined>
  homedir?: () => string
  platform?: string
  versions?: Record<string, string | undefined>
  exists?: (path: string) => boolean
  realpath?: (path: string) => string
  lstat?: (path: string) => ShimStats
  readFile?: (path: string, encoding: "utf8") => string
  write?: (path: string, content: string, options: { mode: number }) => void
  rename?: (from: string, to: string) => void
  chmod?: (path: string, mode: number) => void
  pid?: number
  warn?: (message: string) => void
}

export const identityRealpath = (path: string): string => path

export function existsOnly(...present: string[]): (path: string) => boolean {
  const set = new Set(present)
  return (path) => set.has(path)
}

export function bunTreePackage(bunRoot: string): string {
  return join(bunRoot, "install", "global", "node_modules", "omo-ai", "bin", "omo.js")
}

/** The second bin a bun-global install exposes: the one PATH usually reaches first. */
export function nodeModulesBinPath(bunRoot: string): string {
  return join(bunRoot, "install", "global", "node_modules", ".bin", "omo")
}

/** The stock shape bun links: a relative symlink from <root>/bin/omo into the global tree. */
export function stockLinkTarget(): string {
  return join("..", "install", "global", "node_modules", "omo-ai", "bin", "omo.js")
}

/** Drives the unit surface with recorded filesystem operations, so no assertion touches the host. */
export function recorder(files: Record<string, string> = {}) {
  const written: Array<{ path: string; content: string; mode: number }> = []
  const renamed: Array<{ from: string; to: string }> = []
  const chmodded: Array<{ path: string; mode: number }> = []
  const links = new Set<string>()
  return {
    written,
    renamed,
    chmodded,
    markLink: (path: string) => links.add(path),
    lstat: (path: string): ShimStats => {
      if (!links.has(path) && !(path in files)) throw new Error(`ENOENT: ${path}`)
      return {
        isSymbolicLink: () => links.has(path),
        isFile: () => !links.has(path) && path in files,
      }
    },
    readFile: (path: string): string => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`)
      return files[path] ?? ""
    },
    write: (path: string, content: string, options: { mode: number }) => {
      written.push({ path, content, mode: options.mode })
      files[path] = content
    },
    rename: (from: string, to: string) => {
      renamed.push({ from, to })
      files[to] = files[from] ?? ""
      delete files[from]
    },
    chmod: (path: string, mode: number) => chmodded.push({ path, mode }),
  }
}

export function baseInput(scriptPath: string, overrides: Partial<Options> = {}) {
  const bunRootDir = join(POSIX_HOME, ".bun")
  const bunPath = join(bunRootDir, "bin", "bun")
  const options: Required<
    Pick<Options, "scriptPath" | "env" | "homedir" | "platform" | "versions" | "exists" | "realpath">
  > = {
    scriptPath,
    env: {},
    homedir: () => POSIX_HOME,
    platform: "linux",
    versions: {},
    exists: existsOnly(bunPath),
    realpath: identityRealpath,
    pid: 4242,
    ...overrides,
  }
  return { options, bunRootDir, bunPath }
}
