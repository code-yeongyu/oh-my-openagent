import * as fs from "node:fs"
import * as path from "node:path"
import type { PackageJson } from "../types"
import { PACKAGE_NAME } from "../constants"

export function findPackageJsonUp(startPath: string): string | null {
  try {
    const stat = fs.statSync(startPath)
    let dir = stat.isDirectory() ? startPath : path.dirname(startPath)

    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, "package.json")
      if (fs.existsSync(pkgPath)) {
        try {
          const content = fs.readFileSync(pkgPath, "utf-8")
          const pkg = JSON.parse(content) as PackageJson
          if (pkg.name === PACKAGE_NAME) return pkgPath
        } catch {
          // ignore
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // ignore
  }
  return null
}
