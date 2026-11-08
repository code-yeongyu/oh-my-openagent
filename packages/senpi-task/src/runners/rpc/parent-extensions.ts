import { isAbsolute, relative, sep } from "node:path"

/**
 * Parse the parent process's `-e` / `--extension` entries out of an argv so a detached rpc child can
 * be spawned with the SAME extensions the parent loaded. A separate OS process cannot inherit the
 * parent's in-memory extension registry; forwarding the entry paths reproduces them (a keyless local
 * provider in QA, or a production `-e` extension) in the child under `--no-extensions`.
 */
export function parseExtensionEntries(argv: readonly string[]): readonly string[] {
  const entries: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag !== "-e" && flag !== "--extension") continue
    const value = argv[i + 1]
    if (value !== undefined && value.length > 0) {
      entries.push(value)
      i += 1
    }
  }
  return entries
}

/**
 * What a child of this session should inherit, as either the resolved list or a resolver for it.
 *
 * Composition roots that can discover settings-installed packages (`omo-senpi`) pass a resolver, so
 * a team member, a workpool worker and a revived child all reproduce the SAME provider set an
 * ordinary spawn gets. Left absent, this degrades to the parent's argv entries, which is the correct
 * answer for a wiring with no package manager - and the exact behaviour that predates #8492.
 */
export type InheritedExtensions =
  | readonly string[]
  | (() => readonly string[] | Promise<readonly string[]>)

export async function resolveInheritedExtensionList(
  inherited: InheritedExtensions | undefined,
): Promise<readonly string[]> {
  if (inherited === undefined) return parseExtensionEntries(process.argv)
  return typeof inherited === "function" ? inherited() : inherited
}

export function selectPackageExtensionPaths(
  argvEntries: readonly string[],
  loadedExtensionPaths: readonly string[],
  installedPackageRoots: readonly string[],
): readonly string[] {
  const isWithin = (path: string, root: string): boolean => {
    const nested = relative(root, path)
    return nested === "" || (!isAbsolute(nested) && nested !== ".." && !nested.startsWith(`..${sep}`))
  }
  return [...new Set(loadedExtensionPaths.filter((path) =>
    !path.startsWith("<")
    && installedPackageRoots.some((root) => isWithin(path, root))
    && !argvEntries.some((entry) => isWithin(path, entry)),
  ))]
}
