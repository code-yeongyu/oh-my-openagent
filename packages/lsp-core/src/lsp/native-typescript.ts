import { existsSync, realpathSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { canonicalizeExistingOrNearestAncestor, isPathInside } from "../request-context.js"
import type { ServerWithSource } from "./config-loader.js"
import { resolveServerBinary } from "./server-installation.js"

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
  const tsc = resolveServerBinary(["tsc"], searchDirectory, { localOnly: true })
  if (tsc === null || !isRealDirectory(dirname(tsc))) return null
  const packageDir = join(dirname(tsc), "..", "typescript")
  const speaksLsp = existsSync(join(packageDir, "package.json")) && !existsSync(join(packageDir, "lib", "tsserver.js"))
  return speaksLsp ? [tsc, "--lsp", "--stdio"] : null
}

/**
 * npm, yarn, bun (hoisted and isolated) and pnpm (including its global virtual store) link the entries
 * inside `node_modules`: `.bin/tsc` is a symlink or a shell shim, and `node_modules/typescript` may link
 * into `.bun`, `.pnpm` or a store. None of them links `node_modules` or `node_modules/.bin` itself. So
 * the bin directory the walk found must be a real directory at that place; when either level is a
 * symlink, the compiler belongs to whatever the link points at and the lookup fails closed.
 */
function isRealDirectory(directory: string): boolean {
  try {
    return realpathSync(directory) === directory
  } catch {
    return false
  }
}
