export interface VersionCompatibility {
  canUpgrade: boolean
  reason?: string
  isDowngrade: boolean
  isMajorBump: boolean
  requiresMigration: boolean
}

function parseVersion(version: string): number[] {
  const clean = version.replace(/^v/, "").split("-")[0]
  return clean.split(".").map(Number)
}

function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a)
  const partsB = parseVersion(b)
  const maxLen = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA !== numB) {
      return numA - numB
    }
  }

  return 0
}

export function checkVersionCompatibility(
  currentVersion: string | null,
  newVersion: string
): VersionCompatibility {
  if (!currentVersion) {
    return {
      canUpgrade: true,
      isDowngrade: false,
      isMajorBump: false,
      requiresMigration: false,
    }
  }

  const cleanCurrent = currentVersion.replace(/^v/, "")
  const cleanNew = newVersion.replace(/^v/, "")

  try {
    const comparison = compareVersions(cleanNew, cleanCurrent)

    if (comparison < 0) {
      return {
        canUpgrade: false,
        reason: `Downgrade from ${currentVersion} to ${newVersion} is not allowed`,
        isDowngrade: true,
        isMajorBump: false,
        requiresMigration: false,
      }
    }

    if (comparison === 0) {
      return {
        canUpgrade: true,
        reason: `Version ${newVersion} is already installed`,
        isDowngrade: false,
        isMajorBump: false,
        requiresMigration: false,
      }
    }

    const currentMajor = cleanCurrent.split(".")[0]
    const newMajor = cleanNew.split(".")[0]
    const isMajorBump = currentMajor !== newMajor

    if (isMajorBump) {
      return {
        canUpgrade: true,
        reason: `Major version upgrade from ${currentVersion} to ${newVersion} - configuration migration may be required`,
        isDowngrade: false,
        isMajorBump: true,
        requiresMigration: true,
      }
    }

    return {
      canUpgrade: true,
      isDowngrade: false,
      isMajorBump: false,
      requiresMigration: false,
    }
  } catch {
    return {
      canUpgrade: true,
      reason: `Unable to compare versions ${currentVersion} and ${newVersion} - proceeding with caution`,
      isDowngrade: false,
      isMajorBump: false,
      requiresMigration: false,
    }
  }
}

export function extractVersionFromPluginEntry(entry: string): string | null {
  const match = entry.match(/@(.+)$/)
  return match ? match[1] : null
}
