const WINDOWS_APPDATA_SEGMENTS = ["\\appdata\\local", "\\appdata\\roaming", "\\appdata\\locallow"]

function normalizeWindowsPath(directory: string): string {
  return directory.replaceAll("/", "\\").toLowerCase()
}

export function isWindowsAppDataDirectory(directory: string): boolean {
  const normalizedDirectory = normalizeWindowsPath(directory)
  return WINDOWS_APPDATA_SEGMENTS.some((segment) => {
    return normalizedDirectory.endsWith(segment) || normalizedDirectory.includes(`${segment}\\`)
  })
}

export function resolveSessionDirectory(options: {
  parentDirectory: string | null | undefined
  fallbackDirectory: string
  platform?: NodeJS.Platform
  currentWorkingDirectory?: string
}): string {
  const {
    parentDirectory,
    fallbackDirectory,
    platform = process.platform,
    currentWorkingDirectory = process.cwd(),
  } = options

  const sessionDirectory = parentDirectory ?? fallbackDirectory
  if (platform !== "win32") {
    return sessionDirectory
  }

  if (!isWindowsAppDataDirectory(sessionDirectory)) {
    return sessionDirectory
  }

  if (isWindowsAppDataDirectory(currentWorkingDirectory)) {
    return sessionDirectory
  }

  return currentWorkingDirectory
}
