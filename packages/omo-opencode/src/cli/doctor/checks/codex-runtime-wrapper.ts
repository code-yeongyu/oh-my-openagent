import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { resolveCodexInstallerBinDir } from "../../install-codex/install-codex"
import type { CheckResult, DoctorIssue } from "../framework/types"

const RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER"
const CHECK_NAME = "codex-runtime-wrapper"
const REINSTALL_COMMAND = "npx --yes lazycodex-ai@latest install --no-tui"

export interface CodexRuntimeWrapperDoctorDeps {
  readonly binDir?: string
  readonly codexHome?: string
  readonly platform?: NodeJS.Platform
}

export async function checkCodexRuntimeWrapper(deps: CodexRuntimeWrapperDoctorDeps = {}): Promise<CheckResult> {
  const codexHome = resolve(deps.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"))
  const binDir = resolveCodexInstallerBinDir({ binDir: deps.binDir, codexHome, env: process.env })
  const platform = deps.platform ?? process.platform
  const wrapperPath = join(binDir, platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit")
  const legacyWrapperPath = join(binDir, platform === "win32" ? "omo.cmd" : "omo")
  const [wrapper, legacyWrapper] = await Promise.all([readRuntimeWrapper(wrapperPath), readRuntimeWrapper(legacyWrapperPath)])
  const issues: DoctorIssue[] = []

  if (wrapper?.includes(RUNTIME_WRAPPER_MARKER) === true) {
    const targetPath = parseRuntimeTargetPath(wrapper)
    if (targetPath !== null && !existsSync(targetPath)) {
      issues.push({
        title: "omo-agent-toolkit runtime wrapper target is missing",
        description: `Generated omo-agent-toolkit runtime wrapper at ${wrapperPath} points to missing target ${targetPath}.`,
        fix: `Run: ${REINSTALL_COMMAND}`,
        severity: "warning",
        affects: ["ulw-loop"],
      })
    }
  }

  if (legacyWrapper?.includes(RUNTIME_WRAPPER_MARKER) === true) {
    issues.push({
      title: "Legacy omo runtime wrapper is still installed",
      description: `Generated legacy omo runtime wrapper remains at ${legacyWrapperPath} and may execute an outdated cached CLI.`,
      fix: `Run: ${REINSTALL_COMMAND}`,
      severity: "warning",
      affects: ["version routing"],
    })
  }

  return {
    name: CHECK_NAME,
    status: issues.length > 0 ? "warn" : "pass",
    message: issues.length > 0 ? `${issues.length} Codex runtime wrapper issue(s) detected` : "Codex runtime wrapper checks passed",
    details: [`Wrapper: ${wrapperPath}`],
    issues,
  }
}

async function readRuntimeWrapper(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

function parseRuntimeTargetPath(wrapper: string): string | null {
  const posixMatch = wrapper.match(/exec "\$BUN_BINARY" "([^"]+)" "\$@"/)
  if (posixMatch?.[1] !== undefined) return posixMatch[1]
  const windowsMatch = wrapper.match(/"%+BUN_BINARY%+"\s+"([^"]+)"\s+%+\*/)
  return windowsMatch?.[1] ?? null
}
