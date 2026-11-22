import { existsSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { canonicalizeExistingOrNearestAncestor, isPathInside } from "../request-context.js"
import type { ServerWithSource } from "./config-loader.js"
import {
  executableSuffixes,
  NODE_LOCAL_BIN_DIR,
  NODE_PROJECT_MARKERS,
  probe,
  probeWithSuffixes,
} from "./server-installation.js"

/**
 * Where the search for a project's TypeScript 7 compiler starts, as a real path. A target is judged by
 * its real location: one that resolves (through any symlink) outside the real session directory keeps
 * the session directory, so a link inside the session never lends it another project's compiler. A
 * symlinked session root still works because both sides are canonicalized. Any error falls back to
 * the session directory as given.
 */
export function nativeTypescriptSearchDirectory(targetPath: string | undefined, workingDirectory: string): string {
  try {
    const session = realpathSync(workingDirectory)
    if (targetPath === undefined) return session
    const target = canonicalizeExistingOrNearestAncestor(resolve(workingDirectory, targetPath))
    if (!isPathInside(session, target)) return session
    return statSync(target, { throwIfNoEntry: false })?.isDirectory() === true ? target : dirname(target)
  } catch {
    return workingDirectory
  }
}

/**
 * TypeScript 7 serves LSP itself (`tsc --lsp --stdio`) and no longer ships the `lib/tsserver.js` that
 * typescript-language-server wraps. Only the project's own `node_modules/.bin/tsc` decides, so a global
 * compiler never changes the server. A command a config file named is never replaced, even one equal
 * to the default. `searchDirectory` must be a real path (see nativeTypescriptSearchDirectory).
 */
export function nativeTypescriptCommand(server: ServerWithSource, searchDirectory: string): string[] | null {
  if (server.id !== "typescript" || !server.inheritsBuiltinCommand) return null
  const found = findProjectTsc(searchDirectory)
  if (found === null) return null
  const speaksLsp = !existsSync(join(found.packageDir, "lib", "tsserver.js"))
  return speaksLsp ? [found.tsc, "--lsp", "--stdio"] : null
}

/**
 * Walks up from `searchDirectory` to the repository root (`.git`) and returns the nearest eligible
 * `tsc`: one in the `node_modules/.bin` of a directory with a Node project marker, where that bin
 * directory is real (see isRealDirectory) and a `typescript` package sits beside it. Unlike the generic
 * local-bin walk, no `bin` or virtualenv directory is probed, so a `bin/tsc` of another ecosystem never
 * shadows a hoisted compiler, and an ineligible candidate (such as a stale `tsc` shim left without its
 * package) is passed over instead of ending the walk. Any installed TypeScript ends it, so a package on
 * TypeScript 5 keeps typescript-language-server even below a hoisted TypeScript 7.
 */
function findProjectTsc(searchDirectory: string): { readonly tsc: string; readonly packageDir: string } | null {
  const suffixes = executableSuffixes(process.platform, undefined)
  let current = searchDirectory
  for (;;) {
    if (NODE_PROJECT_MARKERS.some((marker) => probe(join(current, marker)))) {
      const binDir = join(current, NODE_LOCAL_BIN_DIR)
      const tsc = probeWithSuffixes(binDir, "tsc", suffixes)
      const packageDir = join(binDir, "..", "typescript")
      if (tsc !== null && isRealDirectory(binDir) && existsSync(join(packageDir, "package.json"))) {
        return { tsc, packageDir }
      }
    }
    if (probe(join(current, ".git"))) return null
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * npm, yarn, bun (hoisted and isolated) and pnpm (including its global virtual store) link the entries
 * inside `node_modules`: `.bin/tsc` is a symlink or a shell shim, and `node_modules/typescript` may link
 * into `.bun`, `.pnpm` or a store. None of them links `node_modules` or `node_modules/.bin` itself. So
 * the bin directory the walk found must be a real directory at that place; when either level is a
 * symlink, the compiler belongs to whatever the link points at and that candidate is not used.
 */
function isRealDirectory(directory: string): boolean {
  try {
    return realpathSync(directory) === directory
  } catch {
    return false
  }
}
