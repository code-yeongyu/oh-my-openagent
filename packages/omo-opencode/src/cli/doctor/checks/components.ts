import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkLspComponents, isLspLanguageProblem, type LspComponentReport } from "@oh-my-opencode/lsp-core/lsp/component-check"
import { parseLspRequestContext, runWithRequestContext } from "@oh-my-opencode/lsp-core/request-context"

import { validatePluginConfig } from "../../../config/validate"
import { resolveLspConfigPaths } from "../../../mcp/lsp"
import { runCommentChecker } from "../../../hooks/comment-checker/cli"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import { spawnWithTimeout } from "../framework/spawn-with-timeout"
import type { CheckResult, ComponentsReport, DoctorIssue, ToolComponentId, ToolComponentReport } from "../framework/types"
import { checkAstGrepCli, checkCommentChecker } from "./dependencies"
import { getGhCliInfo } from "./tools-gh"
import { getInstalledLspServers } from "./tools-lsp"

export interface ComponentsOptions {
  readonly cwd?: string
  readonly requiredLanguages?: readonly string[]
  readonly probe?: boolean
}

type OmoConfigForComponents = {
  disabled_mcps?: string[]
  disabled_hooks?: string[]
  disabled_skills?: string[]
}

const PROBE_TIMEOUT_MS = 10_000

function loadDisabled(cwd: string): Required<OmoConfigForComponents> {
  const config: OmoConfigForComponents = validatePluginConfig(cwd).config
  return {
    disabled_mcps: config.disabled_mcps ?? [],
    disabled_hooks: config.disabled_hooks ?? [],
    disabled_skills: config.disabled_skills ?? [],
  }
}

function skipped(id: ToolComponentId, detail: string): ToolComponentReport {
  return { id, status: "skipped", path: null, version: null, detail, remediation: [] }
}

function withScratchDir<T>(prefix: string, fn: (directory: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  return fn(directory).finally(() => rmSync(directory, { recursive: true, force: true }))
}

export async function probeAstGrep(probe: boolean): Promise<ToolComponentReport> {
  const info = await checkAstGrepCli()
  if (!info.installed || info.path === null) {
    return {
      id: "ast-grep",
      status: "missing",
      path: null,
      version: null,
      detail: "AST-Grep CLI (sg) is not provisioned.",
      remediation: ["The ast-grep skill resolves sg automatically; run omo doctor or lazycodex-ai doctor to check provisioning."],
    }
  }
  const base = { id: "ast-grep" as const, path: info.path, version: info.version }
  if (!probe) return { ...base, status: "present", detail: "sg resolves; probing was disabled.", remediation: [] }

  const sgPath = info.path
  return withScratchDir("omo-sg-probe-", async (directory) => {
    const file = join(directory, "probe.js")
    writeFileSync(file, "probe(1)\n", "utf-8")
    const result = await spawnWithTimeout(
      [sgPath, "run", "--pattern", "probe($A)", "--lang", "javascript", "--json=compact", file],
      { stdout: "pipe", stderr: "pipe" },
      PROBE_TIMEOUT_MS,
    )
    if (!result.timedOut && result.exitCode === 0 && result.stdout.includes("probe(1)")) {
      return { ...base, status: "ok", detail: "sg matched a pattern in a fixture.", remediation: [] }
    }
    const reason = result.timedOut ? "timed out" : `exit ${result.exitCode}: ${firstLine(result.stderr)}`
    return { ...base, status: "failed", detail: `sg did not match the fixture (${reason}).`, remediation: ["Delete the provisioned sg so the ast-grep skill re-provisions it."] }
  })
}

export async function probeCommentChecker(probe: boolean): Promise<ToolComponentReport> {
  const info = await checkCommentChecker()
  if (!info.installed || info.path === null) {
    return {
      id: "comment-checker",
      status: "missing",
      path: null,
      version: null,
      detail: "The comment-checker binary is not installed.",
      remediation: ["The hook downloads its pinned release on first use; allow access to github.com and restart OpenCode."],
    }
  }
  const base = { id: "comment-checker" as const, path: info.path, version: info.version }
  if (!probe) return { ...base, status: "present", detail: "comment-checker resolves; probing was disabled.", remediation: [] }

  const binaryPath = info.path
  return withScratchDir("omo-comment-checker-probe-", async (directory) => {
    const filePath = join(directory, "probe.ts")
    const result = await runCommentChecker(
      {
        session_id: "omo-doctor-probe",
        tool_name: "Write",
        transcript_path: "",
        cwd: directory,
        hook_event_name: "PostToolUse",
        tool_input: { file_path: filePath, content: "// probe comment\nexport const probe = 1\n" },
      },
      binaryPath,
    )
    if (result.hasComments) {
      return { ...base, status: "ok", detail: "comment-checker flagged the comment in a fixture.", remediation: [] }
    }
    const reason = result.failure === undefined
      ? "it reported no comments, or timed out"
      : `exit ${result.failure.exitCode ?? "none"}: ${firstLine(result.failure.stderr)}`
    return { ...base, status: "failed", detail: `comment-checker did not flag the fixture (${reason}).`, remediation: ["Delete the cached comment-checker binary so the hook downloads it again."] }
  })
}

export async function probeGh(): Promise<ToolComponentReport> {
  const info = await getGhCliInfo()
  if (!info.installed) {
    return { id: "gh", status: "missing", path: null, version: null, detail: "gh CLI is not installed.", remediation: ["Install from https://cli.github.com/"] }
  }
  const base = { id: "gh" as const, path: info.path, version: info.version, account: info.username }
  if (!info.authenticated) {
    return { ...base, status: "unauthenticated", detail: "gh is installed but `gh auth status` reports no login.", remediation: ["Run: gh auth login"] }
  }
  return { ...base, status: "ok", detail: `gh auth status succeeded${info.username ? ` as ${info.username}` : ""}.`, remediation: [] }
}

function lspBridgeReport(cwd: string): ToolComponentReport {
  const bridge = getInstalledLspServers({ cwd })
  if (bridge.length === 0) {
    return { id: "lsp-bridge", status: "missing", path: null, version: null, detail: "The LSP tools bridge cannot start.", remediation: ["Reinstall oh-my-openagent; the bridge needs node or bun plus npm to bootstrap."] }
  }
  return { id: "lsp-bridge", status: "present", path: null, version: null, detail: "The LSP tools bridge command resolves. Server health is reported per language.", remediation: [] }
}

async function checkLanguages(cwd: string, requiredLanguages: readonly string[], probe: boolean): Promise<LspComponentReport> {
  const paths = resolveLspConfigPaths(cwd)
  const context = parseLspRequestContext({
    cwd: paths.cwd,
    projectConfigPaths: [...paths.projectConfigPaths],
    userConfigPath: paths.userConfigPath,
    installDecisionsPath: paths.installDecisionsPath,
    capabilities: { installDecisionTool: false },
  })
  return runWithRequestContext(context, () => checkLspComponents({ requiredLanguages, probe, concurrency: 8 }))
}

const memo = new Map<string, Promise<unknown>>()

/** Each probe runs once per process and options, however many checks and summaries read it. */
function once<T>(key: readonly unknown[], build: () => Promise<T>): Promise<T> {
  const id = JSON.stringify(key)
  const cached = memo.get(id) as Promise<T> | undefined
  if (cached !== undefined) return cached
  const pending = build()
  memo.set(id, pending)
  return pending
}

export function gatherToolComponents(options: ComponentsOptions = {}): Promise<readonly ToolComponentReport[]> {
  const cwd = options.cwd ?? process.cwd()
  const probe = options.probe ?? true
  return once(["tools", cwd, probe], async () => {
    const disabled = loadDisabled(cwd)
    const [astGrep, commentChecker, gh] = await Promise.all([
      disabled.disabled_skills.includes("ast-grep") ? Promise.resolve(skipped("ast-grep", "Disabled by disabled_skills.")) : probeAstGrep(probe),
      disabled.disabled_hooks.includes("comment-checker")
        ? Promise.resolve(skipped("comment-checker", "Disabled by disabled_hooks."))
        : probeCommentChecker(probe),
      probeGh(),
    ])
    const bridge = disabled.disabled_mcps.includes("lsp") ? skipped("lsp-bridge", "Disabled by disabled_mcps.") : lspBridgeReport(cwd)
    return [bridge, astGrep, commentChecker, gh]
  })
}

export function gatherComponents(options: ComponentsOptions = {}): Promise<ComponentsReport> {
  const cwd = options.cwd ?? process.cwd()
  const requiredLanguages = options.requiredLanguages ?? []
  const probe = options.probe ?? true
  return once(["components", cwd, requiredLanguages, probe], async () => {
    const lspDisabled = loadDisabled(cwd).disabled_mcps.includes("lsp")
    const [lsp, tools] = await Promise.all([
      lspDisabled ? Promise.resolve(null) : checkLanguages(cwd, requiredLanguages, probe),
      gatherToolComponents({ cwd, probe }),
    ])
    return { cwd, probed: probe, requiredLanguages, lsp, tools }
  })
}

export function findToolComponent(tools: readonly ToolComponentReport[], id: ToolComponentId): ToolComponentReport | undefined {
  return tools.find((tool) => tool.id === id)
}

export function isToolUsable(tool: ToolComponentReport | undefined): boolean {
  return tool?.status === "ok" || tool?.status === "present"
}

export function buildComponentIssues(report: ComponentsReport): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  for (const language of report.lsp?.languages ?? []) {
    if (!isLspLanguageProblem(language)) continue
    issues.push({
      title: `LSP ${language.language}: ${language.status.replace("_", " ")}`,
      description: language.detail,
      ...(language.remediation.length === 0 ? {} : { fix: language.remediation.join(" | ") }),
      severity: language.required ? "error" : "warning",
      affects: [`lsp tools for ${language.extension}`],
    })
  }
  if (report.lsp === null && report.requiredLanguages.length > 0) {
    issues.push({
      title: "LSP tools disabled",
      description: `Required languages (${report.requiredLanguages.join(", ")}) cannot be served: disabled_mcps contains "lsp".`,
      severity: "error",
      affects: ["lsp tools"],
    })
  }
  for (const tool of report.tools) {
    if (tool.status === "ok" || tool.status === "present" || tool.status === "skipped") continue
    issues.push({
      title: `${tool.id}: ${tool.status}`,
      description: tool.detail,
      ...(tool.remediation.length === 0 ? {} : { fix: tool.remediation.join(" | ") }),
      severity: "warning",
      affects: [tool.id],
    })
  }
  return issues
}

export function summarizeComponents(report: ComponentsReport): string[] {
  const lines = (report.lsp?.languages ?? []).map((language) => {
    const required = language.required ? " (required)" : ""
    const server = language.serverId === null ? "" : ` via ${language.serverId}`
    return `LSP ${language.language}${required}: ${language.status}${server}`
  })
  if (report.lsp === null) lines.push("LSP: disabled")
  for (const tool of report.tools) lines.push(`${tool.id}: ${tool.status}`)
  return lines
}

export function createComponentsCheck(options: ComponentsOptions = {}): () => Promise<CheckResult> {
  return async () => {
    const report = await gatherComponents(options)
    const issues = buildComponentIssues(report)
    const failed = issues.some((issue) => issue.severity === "error")
    return {
      name: CHECK_NAMES[CHECK_IDS.COMPONENTS] ?? "Components",
      status: failed ? "fail" : issues.length > 0 ? "warn" : "pass",
      message: failed
        ? "Required components do not work"
        : issues.length > 0
          ? `${issues.length} component issue(s) detected`
          : report.probed
            ? "Every component was exercised and works"
            : "Components resolve (not probed)",
      details: summarizeComponents(report),
      issues,
    }
  }
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]?.slice(0, 200) ?? ""
}
