import { spawn, spawnSync } from "bun"
import { release } from "os"

import { validateArchiveEntries } from "./archive-entry-validator"
import {
	isPythonZipListingAvailable,
	isZipInfoZipListingAvailable,
	type PowerShellZipExtractor,
	listZipEntriesWithPowerShell,
	listZipEntriesWithPython,
	listZipEntriesWithTar,
	listZipEntriesWithZipInfo,
} from "./zip-entry-listing"

const WINDOWS_BUILD_WITH_TAR = 17134

function getWindowsBuildNumber(): number | null {
  if (process.platform !== "win32") return null
  
  const parts = release().split(".")
  if (parts.length >= 3) {
    const build = parseInt(parts[2], 10)
    if (!isNaN(build)) return build
  }
  return null
}

function isPwshAvailable(): boolean {
  if (process.platform !== "win32") return false
  const result = spawnSync(["where", "pwsh"], { stdout: "pipe", stderr: "pipe" })
  return result.exitCode === 0
}

function escapePowerShellPath(path: string): string {
  return path.replace(/'/g, "''")
}

function getWindowsZipExtractor(): "tar" | PowerShellZipExtractor {
  const buildNumber = getWindowsBuildNumber()
  
  if (buildNumber !== null && buildNumber >= WINDOWS_BUILD_WITH_TAR) {
    return "tar"
  }
  
  if (isPwshAvailable()) {
    return "pwsh"
  }
  
  return "powershell"
}

export async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const entries = await listZipEntries(archivePath)
  validateArchiveEntries(entries, destDir)

  let proc
  
  if (process.platform === "win32") {
    const extractor = getWindowsZipExtractor()
    
    switch (extractor) {
      case "tar":
        proc = spawn(["tar", "-xf", archivePath, "-C", destDir], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
      case "pwsh":
        proc = spawn(["pwsh", "-Command", `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
      case "powershell":
      default:
        proc = spawn(["powershell", "-Command", `Expand-Archive -Path '${escapePowerShellPath(archivePath)}' -DestinationPath '${escapePowerShellPath(destDir)}' -Force`], {
          stdout: "ignore",
          stderr: "pipe",
        })
        break
    }
  } else {
    proc = spawn(["unzip", "-o", archivePath, "-d", destDir], {
      stdout: "ignore",
      stderr: "pipe",
    })
  }
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

async function listZipEntries(archivePath: string) {
	if (process.platform === "win32") {
		const extractor = getWindowsZipExtractor()
    if (extractor === "tar") {
      return listZipEntriesWithTar(archivePath)
    }

    return listZipEntriesWithPowerShell(archivePath, escapePowerShellPath, extractor)
  }

	if (isPythonZipListingAvailable()) {
		return listZipEntriesWithPython(archivePath)
	}

	if (isZipInfoZipListingAvailable()) {
		return listZipEntriesWithZipInfo(archivePath)
	}

	throw new Error(
		"zip entry listing requires either python3 or zipinfo to inspect the archive safely"
	)
}
