import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs"
import { join, relative } from "node:path"

// The merge-base tree the gate builds shares the head's installed external packages (when bun.lock is unchanged), but
// never its workspace packages (review 6061267823 H2): a workspace link points at a package's own source, so the base's
// links are rebuilt to point into the base tree. isolationProblems checks every workspace package resolves inside the
// tree it serves before any outcome is compared.

const isInside = (path: string, root: string): boolean => {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))
}

function linkEntries(headDir: string, baseDir: string, headRoot: string, baseRoot: string): void {
  mkdirSync(baseDir, { recursive: true })
  for (const entry of readdirSync(headDir, { withFileTypes: true })) {
    const from = join(headDir, entry.name)
    const to = join(baseDir, entry.name)
    if (existsSync(to) || lstatSync(to, { throwIfNoEntry: false }) !== undefined) continue
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      linkEntries(from, to, headRoot, baseRoot)
      continue
    }
    const real = realpathSync(from)
    const workspace = isInside(real, headRoot) && !real.split("/").includes("node_modules")
    symlinkSync(workspace ? join(baseRoot, relative(headRoot, real)) : real, to)
  }
}

// Every node_modules directory of the head (root and per package, five levels deep) gets a twin in the base tree.
export function prepareBaseTree(headRoot: string, baseRoot: string): void {
  const walk = (rel: string, depth: number): void => {
    for (const entry of readdirSync(join(headRoot, rel), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git") continue
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`
      if (entry.name === "node_modules") {
        if (existsSync(join(baseRoot, rel)))
          linkEntries(join(headRoot, child), join(baseRoot, child), headRoot, baseRoot)
      } else if (depth < 5) walk(child, depth + 1)
    }
  }
  walk("", 0)
}

export function workspaceNames(root: string): string[] {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
    .map(
      (entry) =>
        (JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")) as { name?: string })
          .name,
    )
    .filter((name): name is string => typeof name === "string")
}

export function isolationProblems(root: string, names: readonly string[] = workspaceNames(root)): string[] {
  const problems: string[] = []
  for (const name of names) {
    const link = join(root, "node_modules", name)
    if (lstatSync(link, { throwIfNoEntry: false }) === undefined) continue
    const real = realpathSync(link)
    if (!isInside(real, root))
      problems.push(
        `workspace package ${name} resolves to ${real}, outside the tree ${root}; the comparison would run the other tree's source`,
      )
  }
  return problems
}
