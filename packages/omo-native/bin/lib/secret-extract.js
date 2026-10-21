/**
 * Moving a secret out of the config omo is about to write, and into the store.
 *
 * The value in the config becomes a reference object the engine reads at load time, and the
 * bytes live in one file in the store instead of in every config that carries them. The file
 * holds the bytes exactly as the value spells them, with nothing added.
 */

import { homedir } from "node:os"

import { isPrototypeName } from "./config-keys.js"
import { findSecretCandidates, secretAmbiguityReason } from "./secret-detect.js"
import { secretStoreDir, writeSecret } from "./secret-store.js"
import { shouldEmitReferenceObjects } from "./engine-version.js"

// Where in the item the path is: an mcp server and a provider carry a config, a credential
// item IS the key holder.
const ITEM_ROOT = { mcp: "config", models: "config", auth: null }

function itemPath(kind, path) {
  const root = ITEM_ROOT[kind]
  if (root === null) return [...path]
  return [root, ...path]
}

// The copy the extractor works on. The records inside a config are copied too, so the plan the
// caller keeps does not change under it.
function copyItem(kind, item) {
  if (kind === "auth") return { ...item }
  const config = item.config
  if (config === null || typeof config !== "object") return { ...item }
  const copied = { ...config }
  if (copied.headers !== null && typeof copied.headers === "object") copied.headers = { ...copied.headers }
  if (copied.env !== null && typeof copied.env === "object") copied.env = { ...copied.env }
  if (Array.isArray(copied.args)) copied.args = [...copied.args]
  return { ...item, config: copied }
}

function setAtPath(target, path, value) {
  let node = target
  for (const [index, key] of path.entries()) {
    if (isPrototypeName(key)) return
    if (index === path.length - 1) {
      node[key] = value
      return
    }
    node = node[key] // nosemgrep: rules.javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- the path comes from a config field name, and a prototype name is refused above
  }
}

/** The name a moved secret is stored under: the file it came from and where it was. */
/**
 * The name a moved secret is filed under.
 *
 * The parts are encoded as JSON, not joined with a dot: a server called `a.env` with a header
 * called `x` and a server called `a` with an env called `headers.x` would otherwise land on the
 * same file, and the second write would replace the first secret's bytes. The item's place in
 * the list is part of the key too, so two items that share a name cannot share a file either.
 */
function storeKeyPath(kind, id, index, path) {
  return JSON.stringify([kind, id, index, ...path])
}

/**
 * Move every secret in the values into the store and leave a reference behind.
 *
 * A secret whose bytes the engine would read as something else is refused and left where the
 * user wrote it, and a store that cannot be written to refuses the same way. A value that is
 * already a reference is left alone: there is no secret in it to move.
 *
 * @returns {{ values: Array<Record<string, unknown>>, extracted: Array<{ id: string, path: Array<string | number>, file: string }>, refused: Array<{ id: string, path: Array<string | number>, reason: string }> }}
 */
export function extractSecrets(kind, values, options) {
  const storeDir = options?.storeDir
  const candidates = findSecretCandidates(kind, values)
  const next = (Array.isArray(values) ? values : []).map((item) => copyItem(kind, item))
  const extracted = []
  const refused = []
  for (const candidate of candidates) {
    const ambiguity = secretAmbiguityReason(candidate.value)
    if (ambiguity !== undefined) {
      refused.push({ id: candidate.id, path: candidate.path, reason: `${ambiguity}; it was left where you wrote it` })
      continue
    }
    // The item the finding came from is resolved before anything is written, so a finding that
    // points at nothing cannot leave an orphan file in the store.
    const item = next[candidate.index]
    if (item === undefined) continue
    const written = writeSecret(storeDir, storeKeyPath(kind, candidate.id, candidate.index, candidate.path), candidate.value)
    if (!written.ok) {
      refused.push({ id: candidate.id, path: candidate.path, reason: written.reason })
      continue
    }
    setAtPath(item, itemPath(kind, candidate.path), { $file: written.path })
    extracted.push({ id: candidate.id, path: candidate.path, file: written.path })
  }
  return { values: next, extracted, refused }
}

/**
 * Whether omo may move a secret out of a config at all.
 *
 * It is off unless it is asked for, and it stays off until the installed engine reads
 * reference objects: a config that points at a file the engine cannot read is worse than a
 * config that holds the value.
 */
export function secretExtractionPlan(runtime = {}) {
  const storeDir = secretStoreDir(runtime.home ?? homedir())
  const env = runtime.env ?? process.env
  if (runtime.extractSecrets !== true && env.OMO_EXTRACT_SECRETS !== "1") {
    return { storeDir, enabled: false, reason: "moving secrets out of a config was not asked for", extracted: [], refused: [] }
  }
  if (!shouldEmitReferenceObjects({ env })) {
    return { storeDir, enabled: false, reason: "the installed engine does not read reference objects yet", extracted: [], refused: [] }
  }
  return { storeDir, enabled: true, reason: undefined, extracted: [], refused: [] }
}

/**
 * Move the secrets out of the values a writer is about to write, when that is allowed.
 *
 * The refusal reasons come back with the result, because a secret that could not be moved
 * has to be said out loud: the value is still in the config.
 */
export function moveSecrets(kind, values, secrets) {
  if (!secrets?.enabled) return { values, extracted: [], refused: [] }
  return extractSecrets(kind, values, { storeDir: secrets.storeDir })
}

/**
 * Move the secrets out of the values and record what happened on the plan.
 *
 * The records ACCUMULATE: one plan can write two files, and the second write must not hide what
 * the first one left behind.
 */
export function moveAndReport(kind, values, secrets) {
  const moved = moveSecrets(kind, values, secrets)
  if (secrets !== undefined) {
    secrets.extracted = [...(secrets.extracted ?? []), ...moved.extracted]
    secrets.refused = [...(secrets.refused ?? []), ...moved.refused]
  }
  return moved.values
}

/**
 * The lines the setup summary carries about the secrets.
 *
 * They are only there when the moving was asked for and allowed, so a setup that does not move
 * anything says nothing about it.
 */
export function secretPlanLines(secrets) {
  if (secrets?.enabled !== true) return []
  return [`secrets-to-store: ${secrets.candidates?.length ?? 0} (into ${secrets.storeDir})`]
}

export function secretCountLines(secrets) {
  if (secrets?.enabled !== true) return []
  return [
    `secrets-moved: ${secrets.extracted?.length ?? 0}`,
    ...(secrets.refused ?? []).map((item) => `secret-left-inline: ${item.id}.${item.path.join(".")} (${item.reason})`),
  ]
}
