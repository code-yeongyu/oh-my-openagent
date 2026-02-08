import * as fs from "node:fs"
import type { PackageJson } from "../types"
import { getLocalDevPath } from "./local-dev-path"
import { findPackageJsonUp } from "./package-json-locator"

export function getLocalDevVersion(directory: string): string | null {
  const localPath = getLocalDevPath(directory)
  if (!localPath) return null

  try {
    const pkgPath = findPackageJsonUp(localPath)
    if (!pkgPath) return null
    const content = fs.readFileSync(pkgPath, "utf-8")
    const pkg = JSON.parse(content) as PackageJson
    return pkg.version ?? null
  } catch {
    return null
  }
}
