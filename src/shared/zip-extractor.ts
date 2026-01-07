import { spawn } from "bun"
import { existsSync } from "fs"
import { release } from "os"

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

type WindowsZipExtractor = "tar" | "pwsh" | "powershell"

function getWindowsZipExtractor(): WindowsZipExtractor {
  const buildNumber = getWindowsBuildNumber()
  
  if (buildNumber !== null && buildNumber >= WINDOWS_BUILD_WITH_TAR) {
    return "tar"
  }
  
  if (existsSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe")) {
    return "pwsh"
  }
  
  return "powershell"
}

export async function extractZip(archivePath: string, destDir: string): Promise<void> {
  let proc
  
  if (process.platform === "win32") {
    const extractor = getWindowsZipExtractor()
    
    switch (extractor) {
      case "tar":
        proc = spawn(["tar", "-xf", archivePath, "-C", destDir], {
          stdout: "pipe",
          stderr: "pipe",
        })
        break
      case "pwsh":
        proc = spawn(["pwsh", "-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
          stdout: "pipe",
          stderr: "pipe",
        })
        break
      case "powershell":
      default:
        proc = spawn(["powershell", "-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
          stdout: "pipe",
          stderr: "pipe",
        })
        break
    }
  } else {
    proc = spawn(["unzip", "-o", archivePath, "-d", destDir], {
      stdout: "pipe",
      stderr: "pipe",
    })
  }
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}
