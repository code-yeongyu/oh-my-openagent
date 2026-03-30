/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const refreshScriptPath = fileURLToPath(new URL("../../../../assets/custom-opencode/refresh-omo.ps1", import.meta.url))
const assetRootPath = fileURLToPath(new URL("../../../../assets/custom-opencode", import.meta.url))
const tempDirs: string[] = []
const isWindows = process.platform === "win32"
const windowsOnlyIt = isWindows ? it : it.skip

function createTempDir(prefix: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(tempDir)
  return tempDir
}

function writeCommandShim(path: string, contents: string): void {
  writeFileSync(path, contents.replaceAll("\n", "\r\n"))
}

function createDoctorResultJson(issueTitles: string[]): string {
  return `${JSON.stringify({
    results: [
      {
        issues: issueTitles.map((title) => ({ title })),
      },
    ],
  }, null, 2)}\n`
}

function initializeManagedTarget(targetDir: string): void {
  mkdirSync(join(targetDir, "node_modules", ".bin"), { recursive: true })
  mkdirSync(join(targetDir, "node_modules", "oh-my-openagent", "bin"), { recursive: true })
  mkdirSync(join(targetDir, "node_modules", "oh-my-opencode-windows-x64"), { recursive: true })

  writeFileSync(join(targetDir, "package.json"), '{"name":"managed-opencode-config"}\n')
  writeFileSync(join(targetDir, "node_modules", "oh-my-openagent", "bin", "oh-my-opencode.js"), "process.exit(0)\n")
}

function writeSupportCommands(commandDir: string): void {
  writeCommandShim(join(commandDir, "node.cmd"), `@echo off
if "%~1"=="--version" (
  echo v20.11.1
  exit /b 0
)
>> "%DOCTOR_INVOCATION_LOG%" echo NODE %*
if not "%DOCTOR_JSON_PATH%"=="" type "%DOCTOR_JSON_PATH%"
if "%DOCTOR_EXIT_CODE%"=="" exit /b 0
exit /b %DOCTOR_EXIT_CODE%
`)

  writeCommandShim(join(commandDir, "npm.cmd"), `@echo off
echo npm %*
exit /b 0
`)

  writeCommandShim(join(commandDir, "opencode.cmd"), `@echo off
if "%~1"=="--version" (
  echo opencode 1.0.200
  exit /b 0
)
if "%~1"=="debug" if "%~2"=="config" (
  echo default_agent=prometheus
  exit /b 0
)
echo Unexpected opencode args %* 1>&2
exit /b 1
`)

  writeCommandShim(join(commandDir, "oh-my-opencode.cmd"), `@echo off
>> "%DOCTOR_INVOCATION_LOG%" echo GLOBAL %*
if not "%GLOBAL_DOCTOR_JSON_PATH%"=="" type "%GLOBAL_DOCTOR_JSON_PATH%"
if "%GLOBAL_DOCTOR_EXIT_CODE%"=="" exit /b 0
exit /b %GLOBAL_DOCTOR_EXIT_CODE%
`)
}

function runRefresh(targetDir: string, commandDir: string, extraEnv: Record<string, string>): ReturnType<typeof spawnSync> {
  return spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      refreshScriptPath,
      "-TargetDir",
      targetDir,
      "-AssetRoot",
      assetRootPath,
      "-CheckOnly",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${commandDir};${process.env.PATH ?? ""}`,
        ...extraEnv,
      },
    },
  )
}

function readLatestRefreshLog(targetDir: string): string {
  const refreshLogDir = join(targetDir, ".oh-my-openagent-refresh", "logs")
  const refreshLogName = readdirSync(refreshLogDir).at(-1)

  if (!refreshLogName) {
    throw new Error(`No refresh log found under ${refreshLogDir}`)
  }

  return readFileSync(join(refreshLogDir, refreshLogName), "utf-8")
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe("managed custom OpenCode refresh script", () => {
  windowsOnlyIt("prefers the target-local shim over a global oh-my-opencode on PATH", () => {
    const targetDir = createTempDir("custom-opencode-refresh-target-")
    const commandDir = createTempDir("custom-opencode-refresh-bin-")
    const invocationLogPath = join(targetDir, "doctor-invocation.log")
    const doctorJsonPath = join(targetDir, "doctor-success.json")

    initializeManagedTarget(targetDir)
    writeSupportCommands(commandDir)
    writeFileSync(doctorJsonPath, createDoctorResultJson([]))

    writeCommandShim(join(targetDir, "node_modules", ".bin", "oh-my-opencode.cmd"), `@echo off
>> "%DOCTOR_INVOCATION_LOG%" echo LOCAL %*
type "%DOCTOR_JSON_PATH%"
exit /b 0
`)

    const result = runRefresh(targetDir, commandDir, {
      DOCTOR_INVOCATION_LOG: invocationLogPath,
      DOCTOR_JSON_PATH: doctorJsonPath,
      DOCTOR_EXIT_CODE: "0",
      GLOBAL_DOCTOR_EXIT_CODE: "91",
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")

    const invocationLog = readFileSync(invocationLogPath, "utf-8")
    expect(invocationLog).toContain("LOCAL doctor --json")
    expect(invocationLog).not.toContain("GLOBAL")

    const refreshLogContents = readLatestRefreshLog(targetDir)
    expect(refreshLogContents).toContain("Doctor command resolution: target-local-shim")
    expect(refreshLogContents).toContain(join(targetDir, "node_modules", ".bin", "oh-my-opencode.cmd"))
  })

  windowsOnlyIt("falls back to the target package bin script before global PATH and accepts advisory-only doctor issues", () => {
    const targetDir = createTempDir("custom-opencode-refresh-target-")
    const commandDir = createTempDir("custom-opencode-refresh-bin-")
    const invocationLogPath = join(targetDir, "doctor-invocation.log")
    const doctorJsonPath = join(targetDir, "doctor-advisory.json")

    initializeManagedTarget(targetDir)
    writeSupportCommands(commandDir)
    writeFileSync(doctorJsonPath, createDoctorResultJson([
      "oh-my-openagent is not registered",
      "Comment checker unavailable",
      "GitHub CLI missing",
    ]))

    const result = runRefresh(targetDir, commandDir, {
      DOCTOR_INVOCATION_LOG: invocationLogPath,
      DOCTOR_JSON_PATH: doctorJsonPath,
      DOCTOR_EXIT_CODE: "1",
      GLOBAL_DOCTOR_EXIT_CODE: "92",
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toContain("Refresh complete.")
    expect(existsSync(join(targetDir, "plugins", "oh-my-openagent.js"))).toBe(true)

    const invocationLog = readFileSync(invocationLogPath, "utf-8")
    expect(invocationLog).toContain("NODE")
    expect(invocationLog).toContain(join(targetDir, "node_modules", "oh-my-openagent", "bin", "oh-my-opencode.js"))
    expect(invocationLog).toContain("doctor --json")
    expect(invocationLog).not.toContain("GLOBAL")

    const refreshLogContents = readLatestRefreshLog(targetDir)
    expect(refreshLogContents).toContain("Doctor command resolution: target-package-bin")
    expect(refreshLogContents).toContain("Doctor exit code 1 accepted because only advisory issues were present")
  })

  windowsOnlyIt("restores the previous target state when doctor reports a non-advisory failure", () => {
    const targetDir = createTempDir("custom-opencode-refresh-target-")
    const commandDir = createTempDir("custom-opencode-refresh-bin-")
    const invocationLogPath = join(targetDir, "doctor-invocation.log")
    const doctorJsonPath = join(targetDir, "doctor-fatal.json")
    const preexistingOpencodeContents = '{\n  "legacy": true\n}\n'

    initializeManagedTarget(targetDir)
    writeSupportCommands(commandDir)
    writeFileSync(doctorJsonPath, createDoctorResultJson(["OpenCode binary not found"]))
    writeFileSync(join(targetDir, "opencode.json"), preexistingOpencodeContents)

    writeCommandShim(join(targetDir, "node_modules", ".bin", "oh-my-opencode.cmd"), `@echo off
>> "%DOCTOR_INVOCATION_LOG%" echo LOCAL %*
type "%DOCTOR_JSON_PATH%"
exit /b %DOCTOR_EXIT_CODE%
`)

    const result = runRefresh(targetDir, commandDir, {
      DOCTOR_INVOCATION_LOG: invocationLogPath,
      DOCTOR_JSON_PATH: doctorJsonPath,
      DOCTOR_EXIT_CODE: "1",
      GLOBAL_DOCTOR_EXIT_CODE: "93",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Managed refresh failed")
    expect(readFileSync(join(targetDir, "opencode.json"), "utf-8")).toBe(preexistingOpencodeContents)

    const refreshLogContents = readLatestRefreshLog(targetDir)
    expect(refreshLogContents).toContain("Refresh failed, restoring the previous managed config backup")
    expect(refreshLogContents).toContain("Original error: Doctor reported fatal issue(s): OpenCode binary not found")
  })
})
