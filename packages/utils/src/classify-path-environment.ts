import { homedir } from "node:os"
import path from "node:path"

export type PathClassification =
  | "icloud"
  | "onedrive"
  | "desktop-sync"
  | "network-drive"
  | "unknown"

function normalizeInputPath(absolutePath: string): string {
  return absolutePath.replaceAll("\\", "/")
}

function isUnderPath(normalizedPath: string, normalizedParentPath: string): boolean {
  return normalizedPath === normalizedParentPath || normalizedPath.startsWith(`${normalizedParentPath}/`)
}

export function classifyPathEnvironment(absolutePath: string): PathClassification {
  if (absolutePath.length === 0) return "unknown"

  const normalizedPath = normalizeInputPath(absolutePath)
  const lowercasePath = normalizedPath.toLowerCase()
  if (lowercasePath.includes("/onedrive") || lowercasePath.includes("/onedrive/")) {
    return "onedrive"
  }

  if (normalizedPath.includes("/Library/Mobile Documents/")) {
    return "icloud"
  }

  if (isUnderPath(normalizedPath, "/Volumes")) {
    return "network-drive"
  }

  if (
    normalizedPath.startsWith("/Users/")
    && (normalizedPath.includes("/Desktop/") || normalizedPath.endsWith("/Desktop")
      || normalizedPath.includes("/Documents/") || normalizedPath.endsWith("/Documents"))
  ) {
    return "desktop-sync"
  }

  const normalizedHome = normalizeInputPath(homedir())
  const desktopPath = normalizeInputPath(path.join(normalizedHome, "Desktop"))
  const documentsPath = normalizeInputPath(path.join(normalizedHome, "Documents"))

  if (isUnderPath(normalizedPath, desktopPath) || isUnderPath(normalizedPath, documentsPath)) {
    return "desktop-sync"
  }

  return "unknown"
}

export function describePathClassification(pathClassification: PathClassification): string {
  switch (pathClassification) {
    case "icloud":
      return "iCloud Drive"
    case "onedrive":
      return "OneDrive"
    case "desktop-sync":
      return "Desktop sync (macOS)"
    case "network-drive":
      return "Network drive"
    case "unknown":
      return "filesystem that does not support fsync"
  }
}
