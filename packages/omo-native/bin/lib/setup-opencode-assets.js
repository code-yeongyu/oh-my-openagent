/**
 * Reads the OpenCode user-scope config and skill tree and converts what it finds into the shapes
 * the engine's global `mcp.json` and global skill root accept. Read-only: nothing here writes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseJsonc } from "./jsonc.js"

// `{file:...}` opens once, at setup time: the engine cannot read files, so the bytes that end up in
// auth.json / models.json / mcp.json must be the literal secret. A leading `~` resolves against the
// user HOME the caller passed in (the test fixture's `home`, never `os.homedir()` blind); an empty
// or non-absolute path returns undefined so the literal `{file:...}` falls through unchanged and
// `unconvertedPlaceholder` later refuses the server. Every other fs error re-throws - only ENOENT,
// EACCES, and EISDIR are silent refusals; the test author's setup ought to hear about, say, a JSON
// parse error in the secret file, not lose it to a swallowed catch.
function readFileRef(rawPath, home) {
  if (typeof rawPath !== "string") return undefined
  const trimmed = rawPath.trim()
  if (trimmed === "") return undefined
  let resolved
  if (trimmed === "~") resolved = home
  else if (trimmed.startsWith("~/")) resolved = home + trimmed.slice(1)
  else if (trimmed.startsWith("/")) resolved = trimmed
  else return undefined
  let bytes
  try {
    bytes = readFileSync(resolved, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EISDIR")) {
      return undefined
    }
    throw error
  }
  // Trailing whitespace only (typical LF/CRLF on a credential file); interior whitespace stays.
  const stripped = bytes.replace(/\s+$/, "")
  return stripped === "" ? undefined : stripped
}

// `interpolateString` in the engine's mcp config rejects any string value that looks like command
// substitution - one containing `$(` or starting (after leading whitespace) with `!` - and one bad
// value fails the whole file, so such a server is dropped, not copied.
function rejectedByEngine(value) {
  if (typeof value === "string") return value.trimStart().startsWith("!") || value.includes("$(")
  if (Array.isArray(value)) return value.some(rejectedByEngine)
  if (value !== null && typeof value === "object") return Object.values(value).some(rejectedByEngine)
  return false
}

// OpenCode's global config is every one of these files deep-merged in this order, later keys
// winning - not the first one found - so a server declared in opencode.jsonc is live even when an
// opencode.json sits next to it.
const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"]

// Every other user-scope config directory contributes only these two, on top of the global dir.
const DIRECTORY_CONFIG_FILES = ["opencode.json", "opencode.jsonc"]

/**
 * Where OpenCode itself reads user-scope config, in its merge order: the global dir's files, then
 * `$OPENCODE_CONFIG`, then `~/.opencode` and `$OPENCODE_CONFIG_DIR`. `OPENCODE_CONFIG_DIR` is one
 * more layer on top of the global dir, not a replacement for it, and every directory can hold
 * skills.
 */
export function opencodeConfigSources(home, env) {
  const globalDir = join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode")
  const directories = [globalDir, join(home, ".opencode")]
  const explicitDir = env.OPENCODE_CONFIG_DIR?.trim()
  if (explicitDir && !directories.includes(resolve(explicitDir))) directories.push(resolve(explicitDir))
  const files = GLOBAL_CONFIG_FILES.map((name) => join(globalDir, name))
  const explicitFile = env.OPENCODE_CONFIG?.trim()
  if (explicitFile) files.push(resolve(explicitFile))
  for (const directory of directories.slice(1)) files.push(...DIRECTORY_CONFIG_FILES.map((name) => join(directory, name)))
  return { files, directories }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function mergeDeep(base, overlay) {
  const merged = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "__proto__") continue
    merged[key] = isPlainObject(merged[key]) && isPlainObject(value) ? mergeDeep(merged[key], value) : value
  }
  return merged
}

// Every existing file of `files` that parses to an object, in order. `label` names what a file
// that cannot be read costs, in its notice.
function readDocuments(files, label, notices) {
  const documents = []
  for (const path of files) {
    if (!existsSync(path)) continue
    let parsed
    try {
      parsed = parseJsonc(readFileSync(path, "utf8"))
    } catch (error) {
      notices.push(`WARN opencode: could not parse ${path}: ${error.message}; its ${label} were not imported`)
      continue
    }
    if (!isPlainObject(parsed)) {
      notices.push(`WARN opencode: ${path} is not an object; its ${label} were not imported`)
      continue
    }
    documents.push(parsed)
  }
  return documents
}

/** One top-level object section (`mcp`, `provider`) of the merged OpenCode config. */
export function readOpencodeSection(files, section, label, notices) {
  let declared = {}
  for (const parsed of readDocuments(files, label, notices)) {
    if (isPlainObject(parsed[section])) declared = mergeDeep(declared, parsed[section])
  }
  return declared
}

/** Every file of `files` deep-merged in order, later keys winning. */
export function readOpencodeConfig(files, label, notices) {
  return readDocuments(files, label, notices).reduce(mergeDeep, {})
}

// OpenCode substitutes `{env:NAME}`; the engine substitutes `${NAME}`. Same intent, same value.
// OmO additionally substitutes `{file:...}` at setup time by reading the file's contents inline;
// the engine does not see placeholders, only the bytes OpenCode would have sent.
const PLACEHOLDER_REGEX = /\{(?:env:([A-Za-z_][A-Za-z0-9_]*)|file:([^}]+))\}/g

export function convertPlaceholders(value, options = {}) {
  if (typeof value !== "string") return value
  const home = options.home ?? homedir()
  return value.replace(PLACEHOLDER_REGEX, (match, envName, filePath) => {
    if (envName !== undefined) return "${" + envName + "}"
    return readFileRef(filePath, home) ?? match
  })
}

// What is left after conversion is a placeholder the engine has no spelling for: `{file:path}`
// (OpenCode inlines that file's contents) or `{env:NAME}` with a NAME outside [A-Za-z_][A-Za-z0-9_]*.
// Copied as-is it would reach the server as literal text, so the server is refused instead.
export function unconvertedPlaceholder(value) {
  if (typeof value === "string") return /\{(?:file|env):[^}]+\}/.test(value)
  if (Array.isArray(value)) return value.some(unconvertedPlaceholder)
  if (value !== null && typeof value === "object") return Object.values(value).some(unconvertedPlaceholder)
  return false
}

function convertRecord(record, options) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return undefined
  const entries = Object.entries(record).filter(([, value]) => typeof value === "string")
  return entries.length > 0 ? Object.fromEntries(entries.map(([key, value]) => [key, convertPlaceholders(value, options)])) : undefined
}

function disabled(entry) {
  return entry.enabled === false ? { enabled: false } : {}
}

function convertLocal(entry, options) {
  const command = Array.isArray(entry.command) ? entry.command.filter((part) => typeof part === "string") : []
  if (command.length === 0) return undefined
  const env = convertRecord(entry.environment, options)
  return {
    type: "stdio",
    command: convertPlaceholders(command[0], options),
    ...(command.length > 1 ? { args: command.slice(1).map((part) => convertPlaceholders(part, options)) } : {}),
    ...(env ? { env } : {}),
    // Both sides resolve a relative cwd from the workspace directory the session runs in.
    ...(typeof entry.cwd === "string" && entry.cwd.trim() !== "" ? { cwd: convertPlaceholders(entry.cwd, options) } : {}),
    ...disabled(entry),
  }
}

// OpenCode's pre-registered OAuth client, in the engine's `oauth` shape (a space-separated `scope`
// becomes the `scopes` list). The engine has no client secret or per-server redirect URI, so a
// server that needs either is reported rather than silently imported as a public client.
function convertOauth(name, oauth, notices, options) {
  if (oauth === null || typeof oauth !== "object" || Array.isArray(oauth)) return undefined
  const scopes = typeof oauth.scope === "string" ? oauth.scope.split(/\s+/).filter(Boolean) : []
  const converted = {
    ...(typeof oauth.clientId === "string" && oauth.clientId !== "" ? { clientId: convertPlaceholders(oauth.clientId, options) } : {}),
    ...(Number.isInteger(oauth.callbackPort) && oauth.callbackPort >= 0 && oauth.callbackPort <= 65_535 ? { callbackPort: oauth.callbackPort } : {}),
    ...(scopes.length > 0 ? { scopes } : {}),
  }
  const dropped = ["clientSecret", "redirectUri"].filter((key) => oauth[key] !== undefined)
  if (dropped.length > 0) {
    notices.push(`NOTICE opencode: mcp server ${name} oauth ${dropped.join(" and ")} has no omo equivalent and was not carried over; start omo and run /mcp auth ${name} to sign in`)
  }
  return Object.keys(converted).length > 0 ? converted : undefined
}

function convertRemote(name, entry, notices, options) {
  if (typeof entry.url !== "string" || entry.url.trim() === "") return undefined
  const headers = convertRecord(entry.headers, options)
  const oauth = convertOauth(name, entry.oauth, notices, options)
  return {
    type: "http",
    url: convertPlaceholders(entry.url, options),
    ...(headers ? { headers } : {}),
    // OpenCode's `oauth: false` disables OAuth auto-detection; the engine spells that `auth: false`.
    ...(entry.oauth === false ? { auth: false } : {}),
    ...(oauth ? { oauth } : {}),
    ...disabled(entry),
  }
}

// A refused server is recorded with a short reason for the setup summary; the notice says what to do.
function convertServer(name, entry, notices, refused, options) {
  if (entry === null || typeof entry !== "object") return undefined
  const config = entry.type === "remote" ? convertRemote(name, entry, notices, options) : convertLocal(entry, options)
  if (!config) {
    notices.push(`NOTICE opencode: mcp server ${name} has no usable command or url; not imported`)
    refused.push({ name, reason: "no usable command or url" })
    return undefined
  }
  if (rejectedByEngine(config)) {
    notices.push(`NOTICE opencode: mcp server ${name} uses command substitution ($(...) or a leading !), which omo refuses to run; not imported - resolve it to a fixed value or a \${NAME} environment reference and add the server to mcp.json by hand`)
    refused.push({ name, reason: "uses $(...) or a leading !" })
    return undefined
  }
  if (unconvertedPlaceholder(config)) {
    notices.push(`NOTICE opencode: mcp server ${name} uses a {file:...} or {env:...} placeholder omo cannot express; not imported - put the value in an environment variable and reference it as \${NAME} in mcp.json`)
    refused.push({ name, reason: "uses a {file:...} or {env:...} placeholder" })
    return undefined
  }
  return config
}

// The engine drops a SKILL.md whose frontmatter has no `description` (skills.js `loadSkillFromFile`),
// so copying one would report an import the next session never shows.
function hasDescription(skillFile) {
  const text = readFileSync(skillFile, "utf8").replace(/^\uFEFF/, "")
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return frontmatter !== null && /^description:/m.test(frontmatter[1])
}

function readSkills(configDirs, notices, skipped) {
  const skills = []
  for (const root of configDirs.flatMap((configDir) => [join(configDir, "skills"), join(configDir, "skill")])) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const source = join(root, entry.name)
      const skillFile = join(source, "SKILL.md")
      if (!existsSync(skillFile)) {
        notices.push(`NOTICE opencode: skill ${entry.name} has no SKILL.md at its top level; not imported - copy it into the omo skills dir by hand if it holds nested skills`)
        skipped.push({ name: entry.name, reason: "no SKILL.md" })
        continue
      }
      if (!hasDescription(skillFile)) {
        notices.push(`NOTICE opencode: skill ${entry.name} has no description in its SKILL.md frontmatter, so omo would not load it; not imported`)
        skipped.push({ name: entry.name, reason: "no description in SKILL.md" })
        continue
      }
      if (skills.some((skill) => skill.name === entry.name)) continue
      skills.push({ name: entry.name, source })
    }
  }
  // readdir order is filesystem-dependent; the printed plan and the import order must not be.
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

export function planOpencodeAssets(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const sources = opencodeConfigSources(home, env)
  const notices = []
  const mcpServers = []
  const refusedServers = []
  for (const [name, entry] of Object.entries(readOpencodeSection(sources.files, "mcp", "mcp servers", notices))) {
    const converted = convertServer(name, entry, notices, refusedServers, { home })
    if (converted) mcpServers.push({ name, config: converted })
  }
  const skippedSkills = []
  const skills = readSkills(sources.directories, notices, skippedSkills)
  return { mcpServers, refusedServers, skills, skippedSkills, notices }
}
