import type * as nodePath from "node:path"

type PathApi = Pick<typeof nodePath, "isAbsolute" | "relative" | "resolve">

export type ForeignRootScan =
  | { readonly kind: "clear" }
  /** `area` holds an entry that is not the caller's own root. The entry itself is never reported. */
  | { readonly kind: "foreign"; readonly area: string }
  /** `area` could not be listed for a reason other than not existing, so it cannot be cleared. */
  | { readonly kind: "unlisted"; readonly area: string }

/**
 * Lists every memory area once and decides whether a walk from an ancestor of them could reach another
 * identity (#12301). An entry is own iff it is, or contains, one of the caller's own roots (lexical or
 * canonical forms); anything else is foreign whatever its type, and entries are never resolved, so a link
 * aliasing the own root is still foreign. A missing area holds nothing; any other listing error fails closed.
 */
export function scanForeignRoots(
  areas: readonly string[],
  ownRoots: readonly string[],
  readEntries: (dir: string) => readonly string[],
  path: PathApi,
): ForeignRootScan {
  for (const area of areas) {
    let entries: readonly string[]
    try {
      entries = readEntries(area)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue
      return { kind: "unlisted", area }
    }
    const foreign = entries.some((name) => !ownRoots.some((own) => isWithin(path.resolve(area, name), own, path)))
    if (foreign) return { kind: "foreign", area }
  }
  return { kind: "clear" }
}

export function isWithin(root: string, target: string, path: PathApi): boolean {
  const rel = path.relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}
