import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs"
import path, { join } from "node:path"

// The merge-base tree the gate builds shares the head's installed external packages (when bun.lock is unchanged), but
// never its workspace packages (review 6061267823 H2): a workspace link points at a package's own source, so the base's
// links are rebuilt to point into the base tree. isolationProblems checks every workspace package resolves inside the
// tree it serves before any outcome is compared.

// Real paths use the platform's separator (backslashes on Windows, issue #15052), and a path on another Windows drive
// comes back from relative() as an absolute path, so both tests go through one path dialect: the running platform's by
// default, path.posix or path.win32 when named. On POSIX a backslash is an ordinary file-name character, not a separator.
type PathApi = Pick<typeof path, "relative" | "isAbsolute" | "normalize" | "sep">

export const isInside = (target: string, root: string, api: PathApi = path): boolean => {
  const rel = api.relative(root, target)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel))
}

// An installed (external) package: some directory on its real path is a node_modules. normalize() turns win32's
// alternative separator into its own and leaves a POSIX backslash in the name it belongs to.
export const isInstalled = (real: string, api: PathApi = path): boolean =>
  api.normalize(real).split(api.sep).includes("node_modules")

// A workspace package is linked by NAME to the base tree's own package directory, however the head reaches it: a
// workspace link into packages/, or a copy in bun's store (a `file:` dependency), which holds the head's source too.
function linkEntries(
  headDir: string,
  baseDir: string,
  headRoot: string,
  workspaces: ReadonlyMap<string, string>,
  scope = "",
): void {
  mkdirSync(baseDir, { recursive: true })
  for (const entry of readdirSync(headDir, { withFileTypes: true })) {
    const from = join(headDir, entry.name)
    const to = join(baseDir, entry.name)
    if (existsSync(to) || lstatSync(to, { throwIfNoEntry: false }) !== undefined) continue
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      linkEntries(from, to, headRoot, workspaces, entry.name)
      continue
    }
    const own = workspaces.get(scope === "" ? entry.name : `${scope}/${entry.name}`)
    const real = realpathSync(from)
    if (own !== undefined) symlinkSync(own, to)
    else if (!isInside(real, headRoot) || isInstalled(real)) symlinkSync(real, to)
  }
}

function workspaceDirs(root: string): Map<string, string> {
  const dirs = new Map<string, string>()
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    const manifest = join(root, "packages", entry.name, "package.json")
    if (!entry.isDirectory() || !existsSync(manifest)) continue
    const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name
    if (typeof name === "string") dirs.set(name, join(root, "packages", entry.name))
  }
  return dirs
}

// Every node_modules directory of the head (root and per package, five levels deep) gets a twin in the base tree.
export function prepareBaseTree(headRoot: string, baseRoot: string): void {
  const workspaces = workspaceDirs(baseRoot)
  const walk = (rel: string, depth: number): void => {
    for (const entry of readdirSync(join(headRoot, rel), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git") continue
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`
      if (entry.name === "node_modules") {
        if (existsSync(join(baseRoot, rel)))
          linkEntries(join(headRoot, child), join(baseRoot, child), headRoot, workspaces)
      } else if (depth < 5) walk(child, depth + 1)
    }
  }
  walk("", 0)
}

function workspaceNames(root: string): string[] {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
    .map(
      (entry) =>
        (JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")) as { name?: string })
          .name,
    )
    .filter((name): name is string => typeof name === "string")
}

// Every node_modules the comparison resolves through (root and per package, as prepareBaseTree builds them): each
// workspace package linked there must resolve inside the tree it serves.
function nodeModulesDirs(root: string): string[] {
  const out: string[] = []
  const walk = (rel: string, depth: number): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`
      if (entry.name === "node_modules") out.push(child)
      else if (entry.isDirectory() && entry.name !== ".git" && depth < 5) walk(child, depth + 1)
    }
  }
  walk("", 0)
  return out
}

export function isolationProblems(root: string, names: readonly string[] = workspaceNames(root)): string[] {
  const problems: string[] = []
  for (const dir of nodeModulesDirs(root))
    for (const name of names) {
      const link = join(root, dir, name)
      if (lstatSync(link, { throwIfNoEntry: false }) === undefined) continue
      const real = realpathSync(link)
      if (!isInside(real, root))
        problems.push(
          `workspace package ${name} (${dir}) resolves to ${real}, outside the tree ${root}; the comparison would run the other tree's source`,
        )
    }
  return problems
}
