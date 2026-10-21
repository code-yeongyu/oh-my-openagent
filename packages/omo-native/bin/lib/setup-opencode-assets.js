/**
 * Reads the OpenCode user-scope config and skill tree and converts what it finds into the shapes
 * the engine's global `mcp.json` and global skill root accept. Read-only: nothing here writes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { compareSemver, REFERENCE_OBJECTS_MIN_SENPI_VERSION } from "./engine-version.js"
import { literalConfigValue } from "./engine-config-value.js"
import { parseJsonc } from "./jsonc.js"
import { senpiPackageRoot } from "./package-paths.js"

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
  return readDocuments(files, label, notices).reduce((merged, parsed) => mergeDeep(merged, parsed), {})
}

// OpenCode substitutes `{env:NAME}`; the engine substitutes `${NAME}`. Same intent, same value.
// `{file:...}` and `{env:...}` placeholders in fields that accept a plain string today
// (`mcp.json`: `headers.*`, `env.*`, `args[]`; `models.json`: provider and model `apiKey` and
// `headers.*`; `auth.json`: the API key `key`, and pool `accounts[].key`) become a structured
// reference object — `{$file: "/abs/path"}` or `{$env: "NAME"}` — and any surrounding text plus
// the reference goes into a `{$concat: ["text", {ref}, ...]}` array. The engine reads these
// references at load time, so setup never inlines secret bytes into `mcp.json`, `models.json`,
// or `auth.json`; rotation of the source file is picked up on the next engine load.
//
// The maintainer ships the engine half themselves. The senpi PR will name the version that
// supports the `$file` / `$env` / `$concat` shapes, and until that version is known the gate
// stays closed, so setup uses the pre-change plain-string path (a `{file:...}` or malformed
// `{env:...}` is refused with a notice). `OMO_REFERENCE_OBJECTS=1` forces the new shape
// regardless of the engine version, for tests and early adopters.
//
// The version is read straight off the engine's own package.json, without resolveSenpi's
// CLI-file existence checks: this is a version comparison, not a launch.
function readSenpiVersion() {
  try {
    return JSON.parse(readFileSync(join(senpiPackageRoot(), "package.json"), "utf8")).version
  } catch {
    return "unresolved"
  }
}

// Whether the installed engine is new enough to receive reference objects. The comparison is
// semver, so the gate opens on purpose and not by accident of how a version string happens to
// sort. The threshold is the exact version the maintainer's senpi PR names.
function engineSupportsReferenceObjects(version) {
  if (version === "unresolved") return false
  if (REFERENCE_OBJECTS_MIN_SENPI_VERSION === null) return false
  return compareSemver(version, REFERENCE_OBJECTS_MIN_SENPI_VERSION) >= 0
}

// Per-call override (also driven by the OMO_REFERENCE_OBJECTS env var). Tests set this directly.
export function shouldEmitReferenceObjects(opts = {}) {
  if (opts.referenceObjects === true) return true
  if (opts.referenceObjects === false) return false
  if (process.env.OMO_REFERENCE_OBJECTS === "1") return true
  return engineSupportsReferenceObjects(readSenpiVersion())
}

// The placeholder pattern also matches an EMPTY argument, so `{file:}` and `{env:}` reach the
// refusal below instead of being written out as literal text. The two other placeholder readers
// (`findFileRefIn`, `findMalformedEnvRef`) already match the empty form.
const PLACEHOLDER_REGEX = /\{(file|env):([^}]*)\}/g
const ENV_NAME = /^\w+$/

// Resolve a `{file:...}` path against `baseDir` (the directory of the OpenCode config file the
// value came from) so a RELATIVE path becomes absolute. A `~` path is left as the user wrote it:
// the engine expands `~` at load time, and baking an absolute path in here would make the
// config non-portable across machines.
function resolveFilePath(raw, baseDir) {
  if (raw === "~" || raw.startsWith("~/")) return raw
  if (raw.startsWith("/")) return raw
  if (baseDir === "") return raw
  return resolve(baseDir, raw)
}

// Walk a string left-to-right and split it into a sequence of plain-string fragments and
// `{$file: ...}` / `{$env: ...}` reference objects. Returns null if any placeholder is malformed
// (e.g. `{env:MY-TOKEN}` with a non-identifier name, or an empty `{file:}`) — the caller surfaces
// a named refusal notice in that case.
//
// A single bare placeholder (e.g. `"{env:TOKEN}"` alone) is returned as just the reference
// object, not a one-element concat. Surrounding text wraps it in a concat array.
//
// Every plain-string fragment is ESCAPED, exactly as the plain-string path escapes a whole
// value: the engine resolves every config value as a template, so a literal `$` would be read as
// an environment lookup and a literal `!` at the start as a shell command. The maintainer's rule
// is that a literal value stays a plain string "exactly as today", and today means escaped.
// The literal fragment of a value, escaped only where the field's spelling escapes.
function literalFragment(text, escaped) {
  return escaped ? literalConfigValue(text) : text
}

function splitStringByPlaceholders(value, baseDir, escaped) {
  const result = []
  let lastIndex = 0
  let m
  PLACEHOLDER_REGEX.lastIndex = 0
  while ((m = PLACEHOLDER_REGEX.exec(value)) !== null) {
    const kind = m[1]
    const arg = m[2]
    if (m.index > lastIndex) {
      result.push(literalFragment(value.slice(lastIndex, m.index), escaped))
    }
    if (kind === "env") {
      // The maintainer's wording: `{env:MY-TOKEN}: not a valid environment variable name`.
      if (!ENV_NAME.test(arg)) return { error: `${m[0]}: not a valid environment variable name` }
      result.push({ $env: arg })
    } else {
      if (arg.trim() === "") return { error: `${m[0]}: not a valid file path` }
      result.push({ $file: resolveFilePath(arg, baseDir) })
    }
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < value.length) {
    result.push(literalFragment(value.slice(lastIndex), escaped))
  }
  if (result.length === 0) return { parts: [""] }
  return { parts: result }
}

// Build a `{$concat: [...]}` object from a parts array, collapsing a single bare reference
// (no surrounding text) to just the reference, and collapsing a single literal-string part to
// just the string.
function buildConcat(parts) {
  if (parts.length === 1) return parts[0]
  return { $concat: parts }
}

// `convertPlaceholders` is the field-scoped legacy substitution: OpenCode's `{env:NAME}`
// becomes the engine's `${NAME}`. It applies to the fields that do NOT accept objects
// (url, command, cwd, oauth.clientId, and every other field) and, when the engine version gate
// is closed, to the object fields too.
//
// It is NOT safe to call on a field whose value may still hold a placeholder: it rewrites only
// `{env:NAME}` with a valid identifier and leaves everything else as literal text. A field that
// does not accept objects must never end up holding a `{file:...}` or `{env:...}` token, so
// every such field goes through `convertPlainField` instead, which refuses them.
export function convertPlaceholders(value) {
  if (typeof value !== "string") return value
  return value.replace(/\{env:(\w+)\}/g, "${$1}")
}

// A `{file:...}` reference in a field that does NOT accept reference objects has no engine
// spelling: the engine would send the reference text as the literal value.
export function findFileRefIn(value) {
  if (typeof value !== "string") return undefined
  const match = /\{file:[^}]*\}/.exec(value)
  return match ? match[0] : undefined
}

// A `{env:NAME}` whose NAME is not a valid identifier has no engine spelling either: the
// engine's `resolveConfigValue` only expands a valid identifier, so the name would reach the
// wire as text.
export function findMalformedEnvRef(value) {
  if (typeof value !== "string") return undefined
  const match = /\{env:([^}]*)\}/.exec(value)
  if (match === null) return undefined
  return ENV_NAME.test(match[1]) ? undefined : match[0]
}

/**
 * Convert a value for a field that accepts a plain string only.
 *
 * A `{file:...}` is refused ("not supported in this field") and a malformed `{env:NAME}` is
 * refused with the named message. A valid `{env:NAME}` becomes the engine's `${NAME}`.
 * Anything else passes through untouched.
 *
 * @returns {{ ok: true, value: unknown } | { refused: true, reason: string }}
 */
export function convertPlainField(value) {
  if (typeof value !== "string") return { ok: true, value }
  const fileRef = findFileRefIn(value)
  if (fileRef !== undefined) {
    return { refused: true, reason: `${fileRef}: not supported in this field` }
  }
  const malformedEnv = findMalformedEnvRef(value)
  if (malformedEnv !== undefined) {
    return { refused: true, reason: `${malformedEnv}: not a valid environment variable name` }
  }
  return { ok: true, value: convertPlaceholders(value) }
}

// `legacyConfigValue` is the PRE-CHANGE behavior for a value that lands in the engine config as
// a plain string: the literal bytes are escaped (so the engine reads `$` and `!` verbatim) and
// OpenCode's `{env:NAME}` becomes the engine's `${NAME}`. A `{file:...}` or a malformed
// `{env:...}` has no spelling in that shape, so it is refused.
//
// The escape runs FIRST and the substitution SECOND, which is the order the engine's own
// `resolveConfigValue` parser expects: `$$` is a literal `$` and `${NAME}` is an env lookup.
// Doing it the other way round turns `${NAME}` into `$${NAME}`, which the engine reads as a
// literal `$` followed by the text `{NAME}`.
export function legacyConfigValue(value, escaped = true) {
  if (typeof value !== "string") return undefined
  // A `{file:...}` or a malformed `{env:...}` has no spelling in the plain-string shape, so it
  // is refused here rather than written as literal text.
  if (findFileRefIn(value) !== undefined) return undefined
  if (findMalformedEnvRef(value) !== undefined) return undefined
  return convertPlaceholders(escaped ? literalConfigValue(value) : value)
}

// `convertToObjectField` takes a value destined for a structured field and returns either the
// reference object, a concat object, or the original string (if no placeholders were present).
// Used by convertRecordAsObjects / convertHeaders / convertKey for `headers.*`, `env.*`,
// `args[]`, `apiKey`, and the auth.json key fields. Returns `{ refused: true, reason }` if the
// value contains a placeholder that has no engine spelling (e.g. `{env:MY-TOKEN}` with a
// non-identifier name, or an empty `{file:}`).
export function convertToObjectField(value, baseDir, escaped = true) {
  if (typeof value !== "string") return { ok: true, value }
  const split = splitStringByPlaceholders(value, baseDir, escaped)
  if (split.error) return { refused: true, reason: split.error }
  // No placeholder — original string passes through verbatim. The engine reads it as-is.
  if (split.parts.length === 1 && typeof split.parts[0] === "string") {
    return { ok: true, value: split.parts[0] }
  }
  return { ok: true, value: buildConcat(split.parts) }
}

// Object fields are mcp.json `headers.*`, `env.*`, `args[]`, models.json `apiKey` and `headers.*`,
// auth.json `key` and pool `accounts[].key`. Every other field keeps the legacy `${NAME}` conversion
// only (no objects, no `{file:...}` reads).
function convertRecordAsObjects(record, baseDir, escaped = true) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return { result: undefined, refused: null }
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") continue
    const split = convertToObjectField(value, baseDir, escaped)
    if (split.refused) return { result: undefined, refused: { key, reason: split.reason } }
    out[key] = split.value
  }
  return { result: Object.keys(out).length > 0 ? out : undefined, refused: null }
}

function disabled(entry) {
  return entry.enabled === false ? { enabled: false } : {}
}

// convertLocal / convertRemote return `{ config, refusal }` instead of pushing the refusal
// themselves, so the SERVER name is attached in one place (convertServer) rather than each
// callee guessing which name belongs in the setup summary.
// args[], env.* and headers.* are spelled one of two ways: as plain strings when the engine
// cannot read a reference object, or as reference objects when it can. Each spelling has its own
// refusal message, so each is a function of its own and the caller picks one.
//
// Every helper here returns the COMPLETE refusal, so the caller holds no branch of its own:
// that is what keeps `convertLocal` and `convertRemote` readable. `noticeFor` names the field and
// the server in a refusal, because the environment notice and the header notice name them
// differently, and that difference is what omo has always printed.
function convertArgsPlain(parts) {
  const record = []
  for (const part of parts) {
    const converted = convertPlainField(part)
    if (converted.refused) {
      return {
        result: undefined,
        refusal: {
          reason: "uses {file:...} in args",
          notice: `NOTICE opencode: mcp server args uses ${converted.reason} which omo does not write in the args field; not imported - inline the value or move the path to a header or env entry`,
        },
      }
    }
    record.push(converted.value)
  }
  return { result: record.length > 0 ? record : undefined, refusal: undefined }
}

function convertArgsObjects(parts, baseDir) {
  const record = []
  for (const part of parts) {
    const converted = convertToObjectField(part, baseDir, false)
    if (converted.refused) {
      return {
        result: undefined,
        refusal: { reason: converted.reason, notice: `NOTICE opencode: mcp server args has ${converted.reason}` },
      }
    }
    record.push(converted.value)
  }
  return { result: record.length > 0 ? record : undefined, refusal: undefined }
}

// A record field in the plain-string spelling. `convert` produces the value or refuses it, and
// `noticeFor` writes the refusal notice.
function convertRecordPlain(record, convert, noticeFor) {
  const out = {}
  for (const [key, value] of Object.entries(isPlainObject(record) ? record : {})) {
    if (typeof value !== "string") continue
    const converted = convert(value)
    if (converted.refused) {
      return { result: undefined, refusal: noticeFor(key, converted.reason) }
    }
    out[key] = converted.value
  }
  return { result: Object.keys(out).length > 0 ? out : undefined, refusal: undefined }
}

// A record field in the reference-object spelling, over the same record reader the environment
// and the headers share.
function convertRecordObjects(record, baseDir, noticeFor) {
  const converted = convertRecordAsObjects(record, baseDir, false)
  if (converted.refused) {
    return { result: undefined, refusal: noticeFor(converted.refused.key, converted.refused.reason) }
  }
  return { result: converted.result, refusal: undefined }
}

function convertLocal(entry, baseDir, legacy) {
  const command = Array.isArray(entry.command) ? entry.command.filter((part) => typeof part === "string") : []
  if (command.length === 0) return { config: undefined, refusal: undefined }
  // `command[0]` is the executable: a field that does not accept reference objects. The
  // remaining parts of OpenCode's command array become `args[]`, which DOES accept them.
  const executable = convertPlainField(command[0])
  if (executable.refused) {
    return {
      config: undefined,
      refusal: {
        reason: "uses {file:...} in command",
        notice: `NOTICE opencode: mcp server command uses ${executable.reason} which omo does not write in the command field; not imported - inline the value or move the path to a header, env, or args entry`,
      },
    }
  }
  // args[] takes reference objects in the new mode; in the legacy mode it takes plain strings
  // and a reference there has no spelling, so it is refused.
  const args = legacy ? convertArgsPlain(command.slice(1)) : convertArgsObjects(command.slice(1), baseDir)
  if (args.refusal) return { config: undefined, refusal: args.refusal }
  const cwd = convertPlainField(entry.cwd)
  if (cwd.refused) {
    return {
      config: undefined,
      refusal: {
        reason: "uses {file:...} in cwd",
        notice: `NOTICE opencode: mcp server cwd uses ${cwd.reason} which omo does not write in the cwd field; not imported - inline the value or move the path to a header or env entry`,
      },
    }
  }
  const env = legacy
    ? convertRecordPlain(
        entry.environment,
        (value) => {
          const converted = convertPlainField(value)
          return converted.refused ? converted : { value: converted.value }
        },
        (key, reason) => ({
          reason: "environment value has a placeholder omo cannot express in the plain-string form",
          notice: `NOTICE opencode: mcp server environment.${key} has ${reason}`,
        }),
      )
    : convertRecordObjects(
        entry.environment,
        baseDir,
        (key, reason) => ({ reason, notice: `NOTICE opencode: mcp server environment.${key} has ${reason}` }),
      )
  if (env.refusal) return { config: undefined, refusal: env.refusal }
  return {
    config: {
      type: "stdio",
      command: executable.value,
      ...(args.result ? { args: args.result } : {}),
      ...(env.result ? { env: env.result } : {}),
      ...(typeof entry.cwd === "string" && entry.cwd.trim() !== "" ? { cwd: cwd.value } : {}),
      ...disabled(entry),
    },
    refusal: undefined,
  }
}

// OpenCode's pre-registered OAuth client, in the engine's `oauth` shape (a space-separated `scope`
// becomes the `scopes` list). The engine has no client secret or per-server redirect URI, so a
// server that needs either is reported rather than silently imported as a public client.
function convertOauth(name, oauth) {
  if (oauth === null || typeof oauth !== "object" || Array.isArray(oauth)) return { config: undefined, refusal: undefined }
  const scopes = typeof oauth.scope === "string" ? oauth.scope.split(/\s+/).filter(Boolean) : []
  // oauth.clientId is NOT an object field — it stays a plain string, so a reference in it has
  // no engine spelling and is refused rather than written as literal text.
  let clientId
  if (typeof oauth.clientId === "string" && oauth.clientId !== "") {
    const converted = convertPlainField(oauth.clientId)
    if (converted.refused) {
      return {
        config: undefined,
        refusal: {
          reason: converted.reason,
          notice: `NOTICE opencode: mcp server ${name} oauth clientId has ${converted.reason} which omo does not write in the clientId field; not imported - inline the value`,
        },
      }
    }
    clientId = converted.value
  }
  const converted = {
    ...(clientId !== undefined ? { clientId } : {}),
    ...(Number.isInteger(oauth.callbackPort) && oauth.callbackPort >= 0 && oauth.callbackPort <= 65_535 ? { callbackPort: oauth.callbackPort } : {}),
    ...(scopes.length > 0 ? { scopes } : {}),
  }
  return { config: Object.keys(converted).length > 0 ? converted : undefined, refusal: undefined }
}

function convertRemote(name, entry, baseDir, legacy, notices) {
  if (typeof entry.url !== "string" || entry.url.trim() === "") return { config: undefined, refusal: undefined }
  // A `{file:...}` in a url is refused in BOTH modes: a file read at the URL would let a secret
  // leave the machine, and the engine sends baseUrl verbatim. A `{env:...}` in a url keeps the
  // pre-change behavior on an engine that cannot read objects (it becomes `${NAME}`, which the
  // engine interpolates), and is refused once the object shape is available.
  const fileRef = findFileRefIn(entry.url)
  if (fileRef !== undefined) {
    return {
      config: undefined,
      refusal: {
        reason: "url field contains a {file:...} reference",
        notice: `NOTICE opencode: mcp server ${name} url contains ${fileRef}; omo refuses a file reference in a url field because a file read at the URL would let a secret leave the machine. Set the url to a fixed value.`,
      },
    }
  }
  if (!legacy && /\{env:[^}]+\}/.test(entry.url)) {
    return {
      config: undefined,
      refusal: {
        reason: "url field contains a {env:...} placeholder",
        notice: `NOTICE opencode: mcp server ${name} url contains an {env:NAME} placeholder; omo refuses placeholders in url fields. Set the url to a fixed value.`,
      },
    }
  }
  const headers = legacy
    ? convertRecordPlain(
        entry.headers,
        (value) => {
          const converted = legacyConfigValue(value, false)
          return converted === undefined
            ? { refused: true, reason: "a placeholder omo cannot express in the plain-string form" }
            : { value: converted }
        },
        (key) => ({
          reason: "header value has a placeholder omo cannot express in the plain-string form",
          notice: `NOTICE opencode: mcp server ${name} headers.${key} has a placeholder omo cannot express in the plain-string form; not imported`,
        }),
      )
    : convertRecordObjects(
        entry.headers,
        baseDir,
        (key, reason) => ({ reason, notice: `NOTICE opencode: mcp server ${name} headers.${key} has ${reason}` }),
      )
  if (headers.refusal) return { config: undefined, refusal: headers.refusal }
  const oauth = convertOauth(name, entry.oauth)
  if (oauth.refusal) return { config: undefined, refusal: oauth.refusal }
  const dropped = ["clientSecret", "redirectUri"].filter((key) => entry.oauth?.[key] !== undefined)
  if (dropped.length > 0) {
    notices.push(`NOTICE opencode: mcp server ${name} oauth ${dropped.join(" and ")} has no omo equivalent and was not carried over; start omo and run /mcp auth ${name} to sign in`)
  }
  return {
    config: {
      type: "http",
      url: convertPlaceholders(entry.url),
      ...(headers.result ? { headers: headers.result } : {}),
      // OpenCode's `oauth: false` disables OAuth auto-detection; the engine spells that `auth: false`.
      ...(entry.oauth === false ? { auth: false } : {}),
      ...(oauth.config ? { oauth: oauth.config } : {}),
      ...disabled(entry),
    },
    refusal: undefined,
  }
}

// A refused server is recorded with a short reason for the setup summary; the notice says what to do.
function convertServer(name, entry, baseDir, legacy, notices, refused) {
  if (entry === null || typeof entry !== "object") return undefined
  const result = entry.type === "remote" ? convertRemote(name, entry, baseDir, legacy, notices) : convertLocal(entry, baseDir, legacy)
  if (result.refusal) {
    notices.push(result.refusal.notice)
    refused.push({ name, reason: result.refusal.reason })
    return undefined
  }
  const config = result.config
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
  // The `{file:...}` / `{env:...}` checks now happen at the field level in convertRecordAsObjects
  // and convertRemote, so there's no top-level "unconverted placeholder" check needed here.
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
    readSkillDir(root, skills, notices, skipped)
  }
  // readdir order is filesystem-dependent; the printed plan and the import order must not be.
  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

// One skill directory's entries. Split out of `readSkills` so neither function carries the
// nesting of both loops.
function readSkillDir(root, skills, notices, skipped) {
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


export function planOpencodeAssets(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const sources = opencodeConfigSources(home, env)
  const notices = []
  const mcpServers = []
  const refusedServers = []
  const refObjects = shouldEmitReferenceObjects(options)
  const legacy = !refObjects
  const mcpSection = readOpencodeSection(sources.files, "mcp", "mcp servers", notices)
  // The engine-version notice only matters when a reference was actually DOWNGRADED. A config
  // with no `{file:...}` / `{env:...}` in it imports identically either way, so a host with a
  // plain MCP config gets no notice about an engine version it is not going to use.
  let downgraded = false
  for (const [name, entry] of Object.entries(mcpSection)) {
    // baseDir is the directory of the OpenCode config file the entry came from. The config is
    // MERGED across every file OpenCode reads, so the file a given entry came from is not known
    // here; the global config directory is the best available anchor. A relative `{file:...}` path
    // therefore resolves against the global dir, not against the file that wrote it.
    const baseDir = sources.files[0] ? dirname(sources.files[0]) : ""
    const before = refusedServers.length
    const converted = convertServer(name, entry, baseDir, legacy, notices, refusedServers)
    if (converted) mcpServers.push({ name, config: converted })
    // A refusal in the legacy shape means a reference the object shape would have carried.
    if (refusedServers.length > before) downgraded = true
  }
  if (legacy && downgraded) {
    notices.push(
      `NOTICE omo: the installed senpi engine does not support {file:...} / {env:...} reference objects yet, so omo imported these servers in the plain-string form and refused any reference it could not express that way. Update senpi to pick up the reference-object support.`,
    )
  }
  const skippedSkills = []
  const skills = readSkills(sources.directories, notices, skippedSkills)
  return { mcpServers, refusedServers, skills, skippedSkills, notices }
}
