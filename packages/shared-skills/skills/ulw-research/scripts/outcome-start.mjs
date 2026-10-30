// outcome-start.mjs - the run clock (outcome.json startedAt). `outcome init` is its one writer and
// records it once: --started-at from the orchestrator, else the startedAt of a valid manifest an
// earlier init wrote (a re-init keeps the clock), else terminal-state.json.started_at when a
// supervisor wrote one, else the YYYYMMDD-HHMMSS session dir name. A recorded value must be a real
// ISO time with Z or an offset, not after `now`, and within a day of a stamped dir name; otherwise
// init refuses instead of falling back. Never the interview's as-of date. No clock reads.
import { readFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
const SESSION_STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/
const DAY_MS = 86_400_000

/** A real calendar time (no 2026-02-30, no T24:00), or null. */
function strictIso(value) {
	const match = typeof value === "string" ? ISO.exec(value) : null
	if (!match) return null
	const [y, mo, d, h, mi, s, oh = 0, om = 0] = match.slice(1).map((part) => Number(part ?? 0))
	const day = new Date(Date.UTC(y, mo - 1, d))
	if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59 || s > 59 || oh > 23 || om > 59) return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

/** Local start time from a YYYYMMDD-HHMMSS dir name, null when the name is not a stamp. */
function dirStamp(sessionDir, fail) {
	const match = SESSION_STAMP.exec(basename(sessionDir))
	if (!match) return null
	const [y, mo, d, h, mi, s] = match.slice(1).map(Number)
	const date = new Date(y, mo - 1, d, h, mi, s)
	if (date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) fail(`session dir basename is not a real local time: ${sessionDir}`)
	return date
}

function readJson(sessionDir, file) {
	try {
		return { data: JSON.parse(readFileSync(join(sessionDir, file), "utf8")) }
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ENOTDIR") return null
		if (error instanceof SyntaxError) return { corrupt: `${join(sessionDir, file)} is not valid JSON (${error.message})` }
		throw error
	}
}

/**
 * @param {{ sessionDir: string, startedAt?: string, now?: Date, validManifest: (data: unknown) => boolean, fail: (message: string) => never }} input
 * @returns {Date}
 */
export function runStart({ sessionDir, startedAt, now, validManifest, fail }) {
	const dir = dirStamp(sessionDir, fail)
	const check = (value, location) => {
		const date = strictIso(value)
		if (!date) fail(`invalid run timestamp in ${location}: ${JSON.stringify(value)} is not a real ISO time with Z or an offset`)
		if (now && date > now) fail(`run timestamp in ${location} (${value}) is after now (${now.toISOString()})`)
		if (dir && Math.abs(date - dir) > DAY_MS) fail(`run timestamp in ${location} (${value}) is not within a day of the session dir name ${basename(sessionDir)}: a copied or stale value`)
		return date
	}
	if (startedAt !== undefined) return check(startedAt, "--started-at")
	const manifest = readJson(sessionDir, "outcome.json")
	if (manifest?.data && validManifest(manifest.data) && resolve(String(manifest.data.sessionDir)) === resolve(sessionDir)) return check(manifest.data.startedAt, "outcome.json.startedAt")
	const terminal = readJson(sessionDir, "terminal-state.json")
	if (terminal?.corrupt) fail(terminal.corrupt)
	if (terminal?.data?.started_at !== undefined) return check(terminal.data.started_at, "terminal-state.json.started_at")
	if (dir) return dir
	return fail(`missing run timestamp: pass --started-at <ISO>, record terminal-state.json.started_at, or name the session dir YYYYMMDD-HHMMSS (${sessionDir})`)
}
