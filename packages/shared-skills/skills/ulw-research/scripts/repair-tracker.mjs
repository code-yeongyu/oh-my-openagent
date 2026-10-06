// repair-tracker.mjs - the bounded repair loop as a pure state machine.
//
// Every decide() call is one check of the current artifact: the first call is attempt 0 (the
// initial check), each later call follows one repair already taken. The loop stops on max
// attempts, a measure plateau, a repeated defect signature (oscillation), or the wall clock.
// On a stop the artifact is delivered with its residual defects unless a content-integrity
// code remains, which blocks delivery. Time is always injected; this module never reads a
// clock. Severities come from contracts.mjs only, so no caller can demote a defect.

import { DEFECT_CODES, INTEGRITY_CODES, REPAIR_DEFAULTS, SCHEMA_VERSION, validateRepairState } from "./contracts.mjs"

/**
 * @typedef {{ code: string, message?: string }} Defect
 * @typedef {{ at: string, measure: number[], signature: string, action: string }} Attempt
 * @typedef {{ schemaVersion: number, startedAt: string, budget: { maxAttempts: number, plateauLimit: number, wallClockMs: number }, integrityCodes: string[], attempts: Attempt[], consecutiveNonProgress: number, seenSignatures: string[] }} RepairState
 * @typedef {{ action: "repair"|"deliver"|"block", reason: string|null, residual: Defect[], blocking: Defect[] }} Decision
 */

const SEVERITY_INDEX = Object.freeze({ blocker: 0, major: 1, minor: 2 })
const MIN_ARTIFACT_BYTES = 512
const MIN_RENDERS = 1

export class RepairTrackerError extends Error {
	/** @param {string} code @param {string} message */
	constructor(code, message) {
		super(message)
		this.name = "RepairTrackerError"
		this.code = code
	}
}

function toIso(value, label) {
	const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null
	if (date === null || !Number.isFinite(date.getTime())) {
		throw new RepairTrackerError("invalid_time", `${label} must be a Date, an ISO timestamp, or epoch milliseconds`)
	}
	return date.toISOString()
}

function assertKnownCode(code, label) {
	if (typeof code !== "string" || !Object.hasOwn(DEFECT_CODES, code)) {
		throw new RepairTrackerError("unknown_defect_code", `${label} ${JSON.stringify(code)} is not a known defect code`)
	}
}

/** Callers may add integrity codes; the contract set is always included, so none can be removed. */
function integritySet(extra) {
	return new Set([...INTEGRITY_CODES, ...(extra ?? [])])
}

/**
 * @param {{ maxAttempts?: number, plateauLimit?: number, wallClockMs?: number, integrityCodes?: Iterable<string>, startedAt: Date|string|number }} options
 * @returns {RepairState}
 */
export function createTracker({ maxAttempts, plateauLimit, wallClockMs, integrityCodes, startedAt }) {
	if (startedAt === undefined) throw new RepairTrackerError("invalid_time", "startedAt is required (the tracker never reads the clock)")
	const codes = [...integritySet(integrityCodes)].sort()
	for (const code of codes) assertKnownCode(code, "integrity code")
	const state = {
		schemaVersion: SCHEMA_VERSION,
		startedAt: toIso(startedAt, "startedAt"),
		budget: {
			maxAttempts: maxAttempts ?? REPAIR_DEFAULTS.maxAttempts,
			plateauLimit: plateauLimit ?? REPAIR_DEFAULTS.plateauLimit,
			wallClockMs: wallClockMs ?? REPAIR_DEFAULTS.wallClockMs,
		},
		integrityCodes: codes,
		attempts: [],
		consecutiveNonProgress: 0,
		seenSignatures: [],
	}
	assertValid(state)
	return state
}

/** The artifact is worth delivering with residual defects only when it exists and was rendered. */
export function isArtifactOk({ bytes, renders }) {
	return Number.isFinite(bytes) && bytes >= MIN_ARTIFACT_BYTES && Number.isFinite(renders) && renders >= MIN_RENDERS
}

export function measureOf(defects) {
	const measure = [0, 0, 0]
	for (const defect of defects) measure[SEVERITY_INDEX[DEFECT_CODES[defect.code].severity]] += 1
	return measure
}

export function signatureOf(defects) {
	return [...new Set(defects.map((defect) => defect.code))].sort().join("|")
}

function lessThan(a, b) {
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return a[i] < b[i]
	}
	return false
}

function stopReason(state, { signature, consecutiveNonProgress, repairsTaken, elapsedMs }) {
	const { maxAttempts, plateauLimit, wallClockMs } = state.budget
	if (state.seenSignatures.includes(signature)) return "oscillation"
	if (consecutiveNonProgress >= plateauLimit) return "plateau"
	if (repairsTaken >= maxAttempts) return "max_attempts"
	if (elapsedMs >= wallClockMs) return "wall_clock"
	return null
}

/**
 * @param {RepairState} state a tracker state (createTracker or deserializeState)
 * @param {Defect[]} defects the current check's defects
 * @param {Date|string|number} now injected time of this check
 * @param {{ artifactOk?: boolean }} [artifact] caller-supplied; see isArtifactOk
 * @returns {{ state: RepairState, decision: Decision }}
 */
export function decide(state, defects, now, { artifactOk = false } = {}) {
	if (!Array.isArray(defects)) throw new RepairTrackerError("invalid_defects", "defects must be an array")
	defects.forEach((defect, index) => assertKnownCode(defect?.code, `defects[${index}].code`))
	const at = toIso(now, "now")
	const measure = measureOf(defects)
	const signature = signatureOf(defects)
	const previous = state.attempts.at(-1)
	const consecutiveNonProgress = previous && !lessThan(measure, previous.measure) ? state.consecutiveNonProgress + 1 : 0
	const repairsTaken = state.attempts.filter((attempt) => attempt.action === "repair").length
	const integrity = integritySet(state.integrityCodes)
	const blocking = defects.filter((defect) => integrity.has(defect.code))

	/** @type {Decision} */
	let decision
	if (defects.length === 0) decision = { action: "deliver", reason: "clean", residual: [], blocking: [] }
	else {
		const elapsedMs = Date.parse(at) - Date.parse(state.startedAt)
		const reason = stopReason(state, { signature, consecutiveNonProgress, repairsTaken, elapsedMs })
		if (reason === null) decision = { action: "repair", reason: null, residual: [...defects], blocking }
		else if (blocking.length > 0) decision = { action: "block", reason: "blocking", residual: [...defects], blocking }
		else decision = { action: artifactOk ? "deliver" : "block", reason, residual: [...defects], blocking }
	}

	const next = {
		...state,
		budget: { ...state.budget },
		integrityCodes: [...state.integrityCodes],
		attempts: [...state.attempts, { at, measure, signature, action: decision.action }],
		consecutiveNonProgress,
		seenSignatures: state.seenSignatures.includes(signature) ? [...state.seenSignatures] : [...state.seenSignatures, signature],
	}
	return { state: next, decision }
}

function assertValid(state) {
	const { ok, errors } = validateRepairState(state)
	if (!ok) throw new RepairTrackerError("invalid_repair_state", `invalid repair state: ${errors.join("; ")}`)
	if (!Array.isArray(state.integrityCodes)) throw new RepairTrackerError("invalid_repair_state", "integrityCodes must be an array")
	for (const code of state.integrityCodes) assertKnownCode(code, "integrity code")
}

/** @returns {string} the repair-state.json text */
export function serializeState(state) {
	assertValid(state)
	return `${JSON.stringify(state, null, 2)}\n`
}

/** @param {string} text repair-state.json contents @returns {RepairState} */
export function deserializeState(text) {
	let state
	try {
		state = JSON.parse(text)
	} catch (error) {
		throw new RepairTrackerError("invalid_repair_state", `repair state is not JSON: ${error.message}`)
	}
	assertValid(state)
	return state
}
