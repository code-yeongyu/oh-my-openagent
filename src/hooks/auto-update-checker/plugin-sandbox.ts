import * as path from "node:path"
import { ACCEPTED_PACKAGE_NAMES, CACHE_DIR } from "./constants"

export interface ManagedPluginSandboxWorkspace {
  packageName: string
  spec: string
  workspaceDir: string
}

const SAFE_REGISTRY_SPEC = /^[A-Za-z0-9._@-]+$/

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 32)
}

function getConfiguredPackage(entry: string): { packageName: string; version: string | null } | null {
  for (const packageName of ACCEPTED_PACKAGE_NAMES) {
    if (entry === packageName) {
      return { packageName, version: null }
    }

    const prefix = `${packageName}@`
    if (entry.startsWith(prefix)) {
      return { packageName, version: entry.slice(prefix.length) }
    }
  }

  return null
}

function isSafeRegistryVersion(version: string): boolean {
  return version.length > 0
    && !version.includes("/")
    && !version.includes("\\")
    && !version.includes(":")
    && !hasControlCharacter(version)
    && SAFE_REGISTRY_SPEC.test(version)
}

export function resolveManagedPluginSandboxWorkspace(
  entry: string,
  cachePackagesDir: string = CACHE_DIR,
): ManagedPluginSandboxWorkspace | null {
  if (hasControlCharacter(entry) || entry.includes("/") || entry.includes("\\")) {
    return null
  }

  const configured = getConfiguredPackage(entry)
  if (!configured) {
    return null
  }

  const version = configured.version ?? "latest"
  if (!isSafeRegistryVersion(version)) {
    return null
  }

  const spec = `${configured.packageName}@${version}`
  if (!SAFE_REGISTRY_SPEC.test(spec)) {
    return null
  }

  const workspaceDir = path.join(cachePackagesDir, spec)
  if (!containsPath(cachePackagesDir, workspaceDir)) {
    return null
  }

  return {
    packageName: configured.packageName,
    spec,
    workspaceDir,
  }
}
