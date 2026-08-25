import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { isRecord } from "./senpi-settings"

const REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("extensions", "omo-task.js"),
  join("extensions", "omo-member.js"),
  join("extensions", "memory-run-supervisor.mjs"),
  join("extensions", "reflection-persona.md"),
  join("extensions", "dream-persona.md"),
  join("extensions", "facts-persona.md"),
  join("skills", "ast-grep", "SKILL.md"),
  join("skills", "coding-agent-sessions", "SKILL.md"),
  join("skills", "debugging", "SKILL.md"),
  join("skills", "frontend", "SKILL.md"),
  join("skills", "git-master", "SKILL.md"),
  join("skills", "init-deep", "SKILL.md"),
  join("skills", "lsp-setup", "SKILL.md"),
  join("skills", "programming", "SKILL.md"),
  join("skills", "refactor", "SKILL.md"),
  join("skills", "remove-ai-slops", "SKILL.md"),
  join("skills", "review-work", "SKILL.md"),
  join("skills", "ultimate-browsing", "SKILL.md"),
  join("skills", "ultrawork", "SKILL.md"),
  join("skills", "ulw-execute", "SKILL.md"),
  join("skills", "ulw-loop", "SKILL.md"),
  join("skills", "ulw-plan", "SKILL.md"),
  join("skills", "ulw-research", "SKILL.md"),
  join("skills", "visual-qa", "SKILL.md"),
  join("runtime", "ast-grep-mcp", "cli.js"),
  join("runtime", "agent-toolkit", "cli.js"),
  join("runtime", "agent-toolkit", "ulw-loop", "cli.js"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit"),
  join("runtime", "agent-toolkit", "omo-agent-toolkit.cmd"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "lsp-daemon", "dist", "index.js"),
  join("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join("runtime", "lsp-daemon", "dist", "package.json"),
  join("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join("scripts", "install.mjs"),
] as const

export async function ensurePluginArtifacts(context: {
  readonly allowBuild: boolean
  readonly runCommand: (command: string, args: readonly string[], options: { readonly cwd: string }) => Promise<void>
  readonly pluginPath: string
  readonly repoRoot: string
  readonly platform: NodeJS.Platform
}): Promise<void> {
  if (context.allowBuild) {
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot })
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-agent-toolkit.mjs")], { cwd: context.repoRoot })
  }

  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`)
  }

  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform)
}

async function hasMissingPluginArtifact(pluginPath: string): Promise<boolean> {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!(await fileExists(join(pluginPath, artifact)))) return true
  }
  return false
}

async function verifyAstGrepRuntimeIntegrity(pluginPath: string, platform: NodeJS.Platform): Promise<void> {
  const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
  const manifestPath = join(dirname(runtimeEntry), "manifest.json")
  let runtimeStat
  try {
    runtimeStat = await stat(runtimeEntry)
    if (!runtimeStat.isFile()) throw new Error("runtime is not a file")
    await access(runtimeEntry, constants.R_OK | constants.X_OK)
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime is unreadable or non-executable: ${messageOf(error)}`)
  }

  if (!(await fileExists(manifestPath))) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is missing: ${manifestPath}`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is unreadable or invalid JSON: ${messageOf(error)}`)
  }
  if (!isAstGrepRuntimeManifest(manifest)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is malformed: ${manifestPath}`)
  }

  let actualSha256: string
  try {
    actualSha256 = createHash("sha256").update(await readFile(runtimeEntry)).digest("hex")
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime hash could not be computed: ${messageOf(error)}`)
  }
  if (actualSha256 !== manifest.sha256) {
    throw astGrepIntegrityError(runtimeEntry, `sha256 mismatch: manifest=${manifest.sha256} actual=${actualSha256}`)
  }

  const actualMode = runtimeStat.mode & 0o777
  if (platform !== "win32" && actualMode !== manifest.mode) {
    throw astGrepIntegrityError(runtimeEntry, `mode mismatch: manifest=${manifest.mode} actual=${actualMode}`)
  }
}

function isAstGrepRuntimeManifest(value: unknown): value is { readonly sha256: string; readonly mode: number; readonly stagedAtUtc: string } {
  if (!isRecord(value)) return false
  return typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.mode === "number"
    && Number.isInteger(value.mode)
    && typeof value.stagedAtUtc === "string"
    && !Number.isNaN(Date.parse(value.stagedAtUtc))
}

function astGrepIntegrityError(runtimeEntry: string, reason: string): Error {
  return new Error(`Packed omo-senpi plugin ast-grep MCP runtime integrity error at ${runtimeEntry}: ${reason}`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false
    throw error
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}
