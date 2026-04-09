import * as fs from "node:fs"
import * as path from "node:path"
import {
  ALIAS_BINARY_NAME,
  ALIAS_PACKAGE_NAME,
  CANONICAL_BINARY_NAME,
  CANONICAL_PACKAGE_NAME,
} from "./identity"

interface PlatformPackageJson {
  name: string
  version: string
  description?: string
  bin?: Record<string, string>
  [key: string]: unknown
}

function removeIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  fs.rmSync(filePath, { recursive: true, force: true })
}

function getCanonicalBinaryRelativePath(pkg: PlatformPackageJson): string {
  const firstEntry = Object.entries(pkg.bin ?? {})[0]?.[1]
  if (!firstEntry) {
    throw new Error(`Package ${pkg.name} is missing a binary entry`)
  }

  return firstEntry.replace(/^\.\//, "")
}

function resolvePathWithinOutDir(outDir: string, relativePath: string): string {
  const resolvedOutDir = path.resolve(outDir)
  const resolvedPath = path.resolve(outDir, relativePath)
  const relativeToOutDir = path.relative(resolvedOutDir, resolvedPath)

  if (relativeToOutDir.startsWith("..") || path.isAbsolute(relativeToOutDir)) {
    throw new Error(`Expected path within ${resolvedOutDir}, got ${relativePath}`)
  }

  return resolvedPath
}

export function createAliasPlatformPackage(sourceDir: string, outDir: string): void {
  removeIfExists(outDir)
  fs.cpSync(sourceDir, outDir, { recursive: true })

  const packageJsonPath = path.join(outDir, "package.json")
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PlatformPackageJson

  const canonicalBinaryRelativePath = getCanonicalBinaryRelativePath(packageJson)
  const aliasBinaryRelativePath = canonicalBinaryRelativePath.replace(CANONICAL_BINARY_NAME, ALIAS_BINARY_NAME)

  const nextPackageJson: PlatformPackageJson = {
    ...packageJson,
    name: packageJson.name.replace(CANONICAL_PACKAGE_NAME, ALIAS_PACKAGE_NAME),
    description: packageJson.description?.replace(CANONICAL_PACKAGE_NAME, ALIAS_PACKAGE_NAME),
    bin: {
      [ALIAS_BINARY_NAME]: `./${aliasBinaryRelativePath}`,
    },
  }

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`)

  const canonicalBinaryPath = resolvePathWithinOutDir(outDir, canonicalBinaryRelativePath)
  const aliasBinaryPath = resolvePathWithinOutDir(outDir, aliasBinaryRelativePath)

  if (!fs.existsSync(canonicalBinaryPath)) {
    throw new Error(`Expected platform binary at ${canonicalBinaryRelativePath}`)
  }

  fs.copyFileSync(canonicalBinaryPath, aliasBinaryPath)
  removeIfExists(canonicalBinaryPath)
}
