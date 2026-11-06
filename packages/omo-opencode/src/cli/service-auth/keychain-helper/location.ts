import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SignatureVerdict } from "./signature"

export type HelperLocation =
  | { readonly kind: "found"; readonly path: string }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly rejected: readonly string[] }

/**
 * The two candidates every store-inlining bundle tries first, relative to its own file (design 1, shape A):
 * `<two levels up>/bin/darwin/omo-keychain` (the omo-ai package, the compiled payload), then `<two levels up>/omo-keychain`
 * (the desktop runtime directory).
 */
export function bundleCandidates(moduleUrl: string): readonly string[] {
  const root = dirname(dirname(dirname(fileURLToPath(moduleUrl))))
  return [join(root, "bin", "darwin", "omo-keychain"), join(root, "omo-keychain")]
}

/**
 * Other signature-valid copies on this machine, tried after the bundle's own (addendum rows 9 and 10): the desktop
 * app's copies and a bun-global omo-ai install.
 */
export function machineCandidates(home: string, arch: string = process.arch): readonly string[] {
  const runtimeArch = arch === "arm64" ? "arm64" : "x64"
  return [
    `/Applications/OmO.app/Contents/Resources/omo-runtime/darwin-${runtimeArch}/omo-keychain`,
    join(home, "Applications", "OmO.app", "Contents", "Resources", "omo-runtime", `darwin-${runtimeArch}`, "omo-keychain"),
    join(home, ".bun", "install", "global", "node_modules", "omo-ai", "bin", "darwin", "omo-keychain"),
  ]
}

/**
 * The first candidate that exists AND passes the signature check. A missing candidate is skipped. A present candidate
 * that fails the check is never used and is reported; the search continues only to other verified copies (addendum
 * row 10 amends v9's "refuse, never fall through" to exactly this). Never PATH, never an environment variable.
 */
export async function locateHelper(
  candidates: readonly string[],
  verify: (path: string) => Promise<SignatureVerdict>,
): Promise<HelperLocation> {
  const rejected: string[] = []
  for (const path of candidates) {
    const verdict = await verify(path)
    if (verdict === "valid") return { kind: "found", path }
    if (verdict === "invalid") rejected.push(path)
  }
  return rejected.length === 0 ? { kind: "missing" } : { kind: "invalid", rejected }
}
