import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { packageRoot } from "./package-paths.js"

export function migrateLegacyBunGlobalManifest(
  root = packageRoot,
  home = process.env.HOME || process.env.USERPROFILE || homedir(),
) {
  if (resolve(root) !== resolve(home, "node_modules", "omo-ai")) return false

  const manifestPath = join(home, "package.json")
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch {
    return false
  }

  if (manifest?.dependencies?.[""] !== ".") return false
  delete manifest.dependencies[""]
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return true
}
