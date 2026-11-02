// fidelity-state.mjs - per-sentence failure counts for the fidelity repair loop. A sentence is
// keyed by its section slug and the sorted fact ids it cites, so a reworded sentence that
// cites the same facts keeps its count. The exact slug and id rules are in the comment above
// slugify in fact-fill.mjs. node: builtins only.

import { existsSync } from "node:fs"
import { join } from "node:path"

import { CliError, readJsonFile, writeJsonAtomic } from "./cli-support.mjs"

export const STATE_FILENAME = "fidelity-state.json"
export const STATE_SCHEMA_VERSION = 1

/** slug + '#' + the fact ids sorted and joined by ','. */
export function sentenceKey(sectionSlug, factIds) {
	return `${sectionSlug}#${[...factIds].sort().join(",")}`
}

function emptyState() {
	return { schemaVersion: STATE_SCHEMA_VERSION, failures: {}, replaced: [] }
}

function isValid(state) {
	return (
		state !== null &&
		typeof state === "object" &&
		state.schemaVersion === STATE_SCHEMA_VERSION &&
		state.failures !== null &&
		typeof state.failures === "object" &&
		!Array.isArray(state.failures) &&
		Object.values(state.failures).every((count) => Number.isInteger(count) && count >= 0) &&
		Array.isArray(state.replaced) &&
		state.replaced.every((key) => typeof key === "string")
	)
}

export function readState(dir) {
	const file = join(dir, STATE_FILENAME)
	if (!existsSync(file)) return emptyState()
	const state = readJsonFile(file)
	if (!isValid(state)) throw new CliError(`${file} is not a valid fidelity state`)
	return state
}

export function recordFailure(state, key) {
	state.failures[key] = (state.failures[key] ?? 0) + 1
	return state.failures[key]
}

export function failureCount(state, key) {
	return state.failures[key] ?? 0
}

export function markReplaced(state, key) {
	if (!state.replaced.includes(key)) state.replaced.push(key)
	return state
}

export function writeState(dir, state) {
	if (!isValid(state)) throw new CliError("refusing to write an invalid fidelity state")
	const file = join(dir, STATE_FILENAME)
	writeJsonAtomic(file, state)
	return file
}
