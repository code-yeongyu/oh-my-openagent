/**
 * Classifies and writes the OpenCode assets `setup-opencode-assets.js` planned: MCP servers into
 * the engine's GLOBAL `<agentDir>/mcp.json` (the one config source the engine always trusts) and
 * skills into the GLOBAL `<agentDir>/skills` root. A name that already exists is never overwritten.
 * `planAssets` only reads; `applyAssets` is the one writer.
 */

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { packageRoot } from "./package-paths.js"
import { planOpencodeAssets } from "./setup-opencode-assets.js"

// The plugin's bundled skills reach the engine through `resources_discover`, which senpi appends
// after `<agentDir>/skills`, and the first skill of a name wins - so a same-named copy imported
// into the user root would silently replace the bundled skill in every session.
function bundledSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) return new Set()
  return new Set(readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, "SKILL.md"))))
}

function readMcpTarget(path) {
  if (!existsSync(path)) return { document: {}, bytes: undefined }
  const bytes = readFileSync(path, "utf8")
  try {
    const document = JSON.parse(bytes)
    if (document === null || typeof document !== "object" || Array.isArray(document)) throw new Error("expected object")
    // A non-object `mcpServers` is a file the engine already rejects; merging into it would spread an
    // array into "0", "1" keys, so it is left alone like any other malformed file.
    const servers = document.mcpServers
    if (servers !== undefined && (servers === null || typeof servers !== "object" || Array.isArray(servers))) throw new Error("expected mcpServers object")
    return { document, bytes }
  } catch {
    return { malformed: true, bytes }
  }
}

function classifyAssets(plan, paths, bundled) {
  const target = readMcpTarget(paths.mcp)
  const existingServers = target.malformed ? {} : (target.document.mcpServers ?? {})
  const servers = { added: [], skippedExisting: [], blocked: [] }
  for (const server of plan.mcpServers) {
    if (target.malformed) servers.blocked.push(server.name)
    else if (Object.hasOwn(existingServers, server.name)) servers.skippedExisting.push(server.name)
    else servers.added.push(server)
  }
  const skills = { added: [], skippedExisting: [], skippedBundled: [] }
  for (const skill of plan.skills) {
    if (existsSync(join(paths.skills, skill.name))) skills.skippedExisting.push(skill.name)
    else if (bundled.has(skill.name)) skills.skippedBundled.push(skill.name)
    else skills.added.push(skill)
  }
  return { servers, skills, target }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "")
}

function writeMcp(path, target, added) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (target.bytes !== undefined) copyFileSync(path, `${path}.bak-${timestamp()}`)
  const next = { ...target.document, mcpServers: { ...(target.document.mcpServers ?? {}) } }
  for (const server of added) next.mcpServers[server.name] = server.config
  const temporary = `${path}.tmp-${process.pid}`
  try {
    // Server env and headers can carry tokens, so this file gets the same 0600 the auth store does.
    writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/** The asset stage's one writer: the servers and skills `planAssets` classified as new. */
export function applyAssets(plan) {
  const { result, paths } = plan
  if (result.servers.added.length > 0) writeMcp(paths.mcp, result.target, result.servers.added)
  for (const skill of result.skills.added) {
    // classifyAssets already skipped every name that exists; force: false only keeps a directory
    // created between that check and this copy from being overwritten file by file.
    cpSync(skill.source, join(paths.skills, skill.name), { recursive: true, force: false })
  }
}

function list(label, ids) {
  return `${label}: ${ids.length > 0 ? ids.join(", ") : "none"}`
}

export function assetPlanLines({ result }) {
  return [
    list("planned-mcp", result.servers.added.map((server) => server.name)),
    list("mcp-skipped-existing", result.servers.skippedExisting),
    list("planned-skills", result.skills.added.map((skill) => skill.name)),
    list("skills-skipped-existing", result.skills.skippedExisting),
    list("skills-skipped-bundled", result.skills.skippedBundled),
  ]
}

export function assetCounts({ result }) {
  return [
    `mcp-imported: ${result.servers.added.length}`,
    `mcp-skipped-existing: ${result.servers.skippedExisting.length}`,
    `skills-imported: ${result.skills.added.length}`,
    `skills-skipped-existing: ${result.skills.skippedExisting.length}`,
    `skills-skipped-bundled: ${result.skills.skippedBundled.length}`,
  ]
}

export function assetQuestion(plan) {
  return `Import ${plan.result.servers.added.length} MCP server(s) and ${plan.result.skills.added.length} skill(s) into ${plan.agentDir}? [y/N] `
}

/**
 * The asset stage of `omo setup`, read-only: what `planOpencodeAssets` converted, classified against
 * the engine's global mcp.json and skill root. `present` is false when opencode declares neither.
 */
export function planAssets({ runtime, agentDir }) {
  const source = planOpencodeAssets(runtime)
  const notices = [...source.notices]
  const present = source.mcpServers.length > 0 || source.skills.length > 0
  const paths = { mcp: join(agentDir, "mcp.json"), skills: join(agentDir, "skills") }
  const result = classifyAssets(source, paths, bundledSkillNames(join(packageRoot, "plugin", "skills")))
  if (result.servers.blocked.length > 0) notices.push(`WARN senpi: malformed mcp.json; these servers were not imported: ${result.servers.blocked.join(", ")}`)
  return {
    agentDir,
    paths,
    notices,
    present,
    result,
    refusedServers: source.refusedServers,
    skippedSkills: source.skippedSkills,
    pending: result.servers.added.length + result.skills.added.length,
  }
}
