import type { CheckResult, CheckDefinition, OpenCodeInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES, MIN_OPENCODE_VERSION, OPENCODE_BINARIES } from "../constants"

const WINDOWS_EXECUTABLE_EXTS = [".exe", ".cmd", ".bat", ".ps1"]

export function getBinaryLookupCommand(platform: NodeJS.Platform): "which" | "where" {
  return platform === "win32" ? "where" : "which"
}

export function parseBinaryPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function selectBinaryPath(
  paths: string[],
  platform: NodeJS.Platform
): string | null {
  if (paths.length === 0) return null
  if (platform !== "win32") return paths[0]

  const normalized = paths.map((path) => path.toLowerCase())
  for (const ext of WINDOWS_EXECUTABLE_EXTS) {
    const index = normalized.findIndex((path) => path.endsWith(ext))
    if (index !== -1) return paths[index]
  }

  return paths[0]
}

export function buildVersionCommand(
  binaryPath: string,
  platform: NodeJS.Platform
): string[] {
  if (
    platform === "win32" &&
    binaryPath.toLowerCase().endsWith(".ps1")
  ) {
    return [
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      binaryPath,
      "--version",
    ]
  }

  return [binaryPath, "--version"]
}

export async function findOpenCodeBinary(): Promise<{ binary: string; path: string } | null> {
  for (const binary of OPENCODE_BINARIES) {
    try {
      const lookupCommand = getBinaryLookupCommand(process.platform)
      const proc = Bun.spawn([lookupCommand, binary], { stdout: "pipe", stderr: "pipe" })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      if (proc.exitCode === 0) {
        const paths = parseBinaryPaths(output)
        const selectedPath = selectBinaryPath(paths, process.platform)
        if (selectedPath) {
          return { binary, path: selectedPath }
        }
      }
    } catch {
      continue
    }
  }
  return null
}

export async function getOpenCodeVersion(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  try {
    const command = buildVersionCommand(binaryPath, platform)
    const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0) {
      return output.trim()
    }
  } catch {
    return null
  }
  return null
}

export function compareVersions(current: string, minimum: string): boolean {
  const parseVersion = (v: string): number[] => {
    const cleaned = v.replace(/^v/, "").split("-")[0]
    return cleaned.split(".").map((n) => parseInt(n, 10) || 0)
  }

  const curr = parseVersion(current)
  const min = parseVersion(minimum)

  for (let i = 0; i < Math.max(curr.length, min.length); i++) {
    const c = curr[i] ?? 0
    const m = min[i] ?? 0
    if (c > m) return true
    if (c < m) return false
  }
  return true
}

export async function getOpenCodeInfo(): Promise<OpenCodeInfo> {
  const binaryInfo = await findOpenCodeBinary()

  if (!binaryInfo) {
    return {
      installed: false,
      version: null,
      path: null,
      binary: null,
    }
  }

  const version = await getOpenCodeVersion(binaryInfo.path ?? binaryInfo.binary)

  return {
    installed: true,
    version,
    path: binaryInfo.path,
    binary: binaryInfo.binary as "opencode" | "opencode-desktop",
  }
}

export async function checkOpenCodeInstallation(): Promise<CheckResult> {
  const info = await getOpenCodeInfo()

  if (!info.installed) {
    return {
      name: CHECK_NAMES[CHECK_IDS.OPENCODE_INSTALLATION],
      status: "fail",
      message: "OpenCode is not installed",
      details: [
        "Visit: https://opencode.ai/docs for installation instructions",
        "Run: npm install -g opencode",
      ],
    }
  }

  if (info.version && !compareVersions(info.version, MIN_OPENCODE_VERSION)) {
    return {
      name: CHECK_NAMES[CHECK_IDS.OPENCODE_INSTALLATION],
      status: "warn",
      message: `Version ${info.version} is below minimum ${MIN_OPENCODE_VERSION}`,
      details: [
        `Current: ${info.version}`,
        `Required: >= ${MIN_OPENCODE_VERSION}`,
        "Run: npm update -g opencode",
      ],
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.OPENCODE_INSTALLATION],
    status: "pass",
    message: info.version ?? "installed",
    details: info.path ? [`Path: ${info.path}`] : undefined,
  }
}

export function getOpenCodeCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.OPENCODE_INSTALLATION,
    name: CHECK_NAMES[CHECK_IDS.OPENCODE_INSTALLATION],
    category: "installation",
    check: checkOpenCodeInstallation,
    critical: true,
  }
}
