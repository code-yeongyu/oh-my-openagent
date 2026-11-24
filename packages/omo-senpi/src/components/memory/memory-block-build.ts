import { statSync } from "@oh-my-opencode/memory-core/fs"
import { fileURLToPath } from "node:url"
import { omoSenpiPackageVersion } from "../../package-version"

declare const OMO_SENPI_BUNDLED: boolean

const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED

/**
 * Identifies the code that compiles memory blocks, for the persisted-block key, or `undefined` when there is no
 * stable identity: the installed package version (read from the manifest beside the bundle) plus the size and mtime
 * of the running bundle, which contains the compiler, so any rebuild or reinstall changes it. A source run gets none:
 * its compiler lives in files this module cannot see, so it must not persist blocks at all.
 */
export function memoryBlockBuild(bundleUrl: string = import.meta.url, isBundle: boolean = bundled): string | undefined {
  if (!isBundle) return undefined
  try {
    const bundle = statSync(fileURLToPath(bundleUrl))
    return `${omoSenpiPackageVersion(bundleUrl)}:${bundle.size}:${Math.trunc(bundle.mtimeMs)}`
  } catch {
    return undefined
  }
}
