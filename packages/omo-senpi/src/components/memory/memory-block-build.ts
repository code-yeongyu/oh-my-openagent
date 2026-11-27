import { statSync } from "@oh-my-opencode/memory-core/fs"
import { fileURLToPath } from "node:url"

declare const OMO_SENPI_PACKAGE_VERSION: string

/**
 * Identifies the code that compiles memory blocks, for the persisted-block key, or `undefined` when there is no
 * stable identity: the package version plus the size and mtime of the running bundle, which contains the compiler,
 * so any rebuild changes it. A source run (no bundle-defined version) gets none: its compiler lives in files this
 * module cannot see, so it must not persist blocks at all.
 */
export function memoryBlockBuild(): string | undefined {
  if (typeof OMO_SENPI_PACKAGE_VERSION !== "string") return undefined
  try {
    const bundle = statSync(fileURLToPath(import.meta.url))
    return `${OMO_SENPI_PACKAGE_VERSION}:${bundle.size}:${Math.trunc(bundle.mtimeMs)}`
  } catch {
    return undefined
  }
}
