/**
 * Which values in a config omo is about to write are secrets, and where they are.
 *
 * The rule is the same everywhere: a field the engine reads as a reference gets one, a field
 * it cannot refuses the value by name, and nothing is ever written out as literal placeholder
 * text. This module only decides WHICH values are secrets; moving them is `secret-extract.js`.
 *
 * The path in a finding is inside the server or provider config for `mcp` and `models`, and
 * inside the credential item for `auth`, whose item IS the key holder.
 */

// Header names that carry a credential whatever the value looks like.
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "apikey",
  "x-auth-token",
  "x-access-token",
  "x-api-token",
  "x-goog-api-key",
  "x-openai-api-key",
  "x-csrf-token",
  "private-token",
  "x-hub-signature-256",
  "cookie",
])

// An environment variable name that carries a credential.
const CREDENTIAL_WORDS = ["TOKEN", "SECRET", "PASSWORD", "PASSWD", "CRED", "APIKEY", "API_KEY"]

// A value that is shaped like a token. Used where a field has no name to go by, an argument.
// The prefixes are written in upper case, because the value is compared in upper case: a token
// prefix is a shape, not a spelling, and `AKIA` and `akia` are the same shape.
const TOKEN_PREFIXES = [
  "SK-", "SK-ANT-", "GHP_", "GHO_", "GHU_", "GHS_", "GHR_", "GITHUB_PAT_", "GLPAT-",
  "AKIA", "ASIA", "AIZA", "XOXB-", "XOXP-", "XOXA-", "HF_", "NPM_", "SG.", "DOP_V1_",
  "R8_", "LIN_API_", "DCKR_PAT_",
]
const JWT = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./
const OPAQUE_TOKEN = /^[A-Za-z0-9+/_=.-]{40,}$/

// A field whose name is a prototype is not a field. Nothing reads it and nothing should write it.
function isSecretHeader(name) {
  if (isPrototypeName(name)) return false
  return CREDENTIAL_HEADERS.has(name.toLowerCase())
}

function isSecretVariable(name) {
  if (isPrototypeName(name)) return false
  const upper = name.toUpperCase()
  return CREDENTIAL_WORDS.some((word) => upper.includes(word))
}

function isSecretValue(value) {
  const upper = value.toUpperCase()
  if (TOKEN_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true
  if (JWT.test(value)) return true
  // A long opaque run with no path in it and no flag in front of it. A path, a url and a flag
  // are all long too, and none of them is a secret.
  if (value.startsWith("-") || value.includes("/")) return false
  return OPAQUE_TOKEN.test(value)
}

import { isPrototypeName } from "./config-keys.js"

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function headerFindings(kind, id, index, record, path) {
  if (!isPlainObject(record)) return []
  const found = []
  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== "string") continue
    if (!isSecretHeader(name)) continue
    found.push({ kind, id, index, path: [...path, name], value, reason: "credential header" })
  }
  return found
}

function variableFindings(kind, id, index, record, path) {
  if (!isPlainObject(record)) return []
  const found = []
  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== "string") continue
    if (!isSecretVariable(name)) continue
    found.push({ kind, id, index, path: [...path, name], value, reason: "credential variable" })
  }
  return found
}

function argumentFindings(kind, id, index, args, path) {
  if (!Array.isArray(args)) return []
  const found = []
  for (const [position, value] of args.entries()) {
    if (typeof value !== "string") continue
    if (!isSecretValue(value)) continue
    found.push({ kind, id, index, path: [...path, position], value, reason: "token in an argument" })
  }
  return found
}

/**
 * The secrets in the values setup is about to write.
 *
 * @param {"mcp" | "models" | "auth"} kind
 * @param {Array<Record<string, unknown>>} values the converted values, one per server,
 *   provider or credential
 * @returns {Array<{ kind: string, id: string, path: Array<string | number>, value: string, reason: string }>}
 */
function mcpCandidates(kind, id, index, config) {
  return [
    ...headerFindings(kind, id, index, config.headers, ["headers"]),
    ...variableFindings(kind, id, index, config.env, ["env"]),
    ...argumentFindings(kind, id, index, config.args, ["args"]),
  ]
}

function modelsCandidates(kind, id, index, config) {
  const found = headerFindings(kind, id, index, config.headers, ["headers"])
  if (typeof config.apiKey === "string" && config.apiKey !== "") {
    found.push({ kind, id, index, path: ["apiKey"], value: config.apiKey, reason: "credential key" })
  }
  return found
}

export function findSecretCandidates(kind, values) {
  const found = []
  const list = Array.isArray(values) ? values : []
  for (const [itemIndex, item] of list.entries()) {
    if (!isPlainObject(item)) continue
    if (kind === "auth") {
      const key = item.key
      if (typeof key !== "string" || key === "") continue
      found.push({ kind, id: String(item.provider), index: itemIndex, path: ["key"], value: key, reason: "credential key" })
      continue
    }
    const id = String(kind === "mcp" ? item.name : item.id)
    const config = item.config
    if (!isPlainObject(config)) continue
    found.push(...(kind === "mcp" ? mcpCandidates(kind, id, itemIndex, config) : modelsCandidates(kind, id, itemIndex, config)))
  }
  return found
}

/**
 * Whether a secret's bytes are ones the engine would read as something else.
 *
 * The engine resolves a config value as a template: `$$` is a literal `$`, `$!` a literal
 * `!`, and a value STARTING WITH `!` is run as a shell command. Whether the file resolver
 * reads a file's bytes as plain text or runs them through the same rules is the engine's
 * side to decide, and until it does, a secret holding those bytes is left where the user
 * wrote it rather than moved into a file that might hand it back changed.
 */
export function secretBytesAreAmbiguous(value) {
  return secretAmbiguityReason(value) !== undefined
}

/**
 * Why a secret's bytes are ones the engine might read as something else, or undefined when they
 * are not.
 *
 * The engine resolves a config value as a template: `$$` is a literal `$`, `$!` a literal `!`,
 * and a value STARTING WITH `!` is run as a shell command. Whether the file resolver reads a
 * file's bytes as plain text or runs them through the same rules is the engine's side to decide,
 * and until it does, a secret holding those bytes is left where the user wrote it rather than
 * moved into a file that might hand it back changed.
 */
export function secretAmbiguityReason(value) {
  if (typeof value !== "string") return "it is not a string"
  if (value.includes("$")) return "it holds a $, which the engine reads as a template"
  if (value.trimStart().startsWith("!")) return "it starts with !, which the engine reads as a command"
  return undefined
}
