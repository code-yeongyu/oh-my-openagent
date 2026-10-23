/**
 * The capability gate for the reference-object setup path.
 *
 * omO setup can write `{file:...}` / `{env:...}` as reference objects
 * (`{$file: ...}`, `{$env: ...}`, `{$concat: [...]}`) that the engine resolves
 * at load time. An engine that does not understand those objects would pass
 * them through unvalidated, so the shape is only written for an engine that
 * says it supports them.
 *
 * The engine says so with a field in its own package.json:
 *
 *     "senpiCapabilities": { "configReferenceObjects": 1 }
 *
 * A value of 1 or higher means the engine resolves the three reference
 * objects in the string-only slots the approved design names. A missing field,
 * or a missing `senpiCapabilities` object, means it does not, and setup keeps
 * writing plain values or refuses, exactly as before. A higher number will
 * only ever add to what 1 means.
 *
 * A CAPABILITY and not a version, because no released version can be named
 * before the release that ships this is cut: a version threshold would either
 * stay null, or could open for a build that does not carry the code. The
 * engine declares the field in the same commit as the resolver, so the two
 * cannot drift apart there.
 *
 * A number of 1 or higher opens the gate. The engine's contract is that a
 * higher number only ever adds to what 1 means; this side cannot enforce
 * that, so it does not pretend to, and it treats every number from 1 up the
 * same way.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { senpiPackageRoot } from "./package-paths.js"

export const CONFIG_REFERENCE_OBJECTS_CAPABILITY = "configReferenceObjects"

/**
 * What the installed engine says it can do.
 *
 * @param {{ capabilities?: Record<string, unknown>, senpiPackageRoot?: string }} [source]
 * @returns {Record<string, unknown> | undefined}
 */
export function readEngineCapabilities(source = {}) {
  if (source.capabilities !== undefined) return source.capabilities
  try {
    const root = source.senpiPackageRoot ?? senpiPackageRoot()
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).senpiCapabilities
  } catch {
    return undefined
  }
}

/**
 * Whether the engine resolves the reference objects.
 *
 * @param {{ capabilities?: Record<string, unknown> }} [source]
 * @returns {boolean}
 */
export function engineSupportsReferenceObjects(source = {}) {
  const capabilities = readEngineCapabilities(source)
  const value = capabilities?.[CONFIG_REFERENCE_OBJECTS_CAPABILITY]
  return typeof value === "number" && value >= 1
}

/**
 * Whether setup may write the reference-object shapes.
 *
 * `OMO_REFERENCE_OBJECTS=1` forces the new shape and `0` forces the old one,
 * whatever the engine declares, for tests and for a user who knows their
 * engine supports it.
 *
 * Only the three fields named here are read. A caller's whole options bag is
 * not passed in, so an option that happens to be called `capabilities` cannot
 * become a gate override by accident.
 */
export function shouldEmitReferenceObjects({ referenceObjects, env, senpiPackageRoot } = {}) {
  if (referenceObjects === true) return true
  if (referenceObjects === false) return false
  const forced = (env ?? process.env).OMO_REFERENCE_OBJECTS
  if (forced === "1") return true
  if (forced === "0") return false
  return engineSupportsReferenceObjects({ senpiPackageRoot })
}
