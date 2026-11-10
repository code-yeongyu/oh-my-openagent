import {
	type AuditEvent,
	type DesktopCapabilities,
	type EpochChanged,
	type StopPathStatus,
	UNKNOWN_AUDIT_VALUE,
} from "@oh-my-opencode/senpi-desktop-protocol";
import type {
	ActionReport,
	AxCut,
	AxEvidence,
	AxNode,
	AxSnapshot,
	Bounds,
	Display,
	Disposition,
	MenuItem,
	OpenedSurface,
	WindowIdentity,
	WindowSummary,
} from "./types";

// Engine replies are the trust boundary: each parser returns the facade shape, or `undefined` for a malformed
// reply, which the caller turns into `ComputerError` `Internal`.

type Fields = Record<string, unknown>;

export function isRecord(value: unknown): value is Fields {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isAbsent = (value: unknown): value is null | undefined => value === null || value === undefined;
const isStringList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isString);

function optional<T>(value: unknown, guard: (value: unknown) => value is T): T | null | false {
	if (isAbsent(value)) return null;
	return guard(value) ? value : false;
}

/** Parses each item; one malformed item makes the whole list malformed. */
export function parseList<T>(value: unknown, parse: (item: unknown) => T | undefined): readonly T[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items: T[] = [];
	for (const item of value) {
		const parsed = parse(item);
		if (parsed === undefined) return undefined;
		items.push(parsed);
	}
	return items;
}

function bounds(record: Fields): Bounds | undefined {
	const { x, y, width, height } = record;
	return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height) ? { x, y, width, height } : undefined;
}

export function parseIdentity(value: unknown): WindowIdentity | null | undefined {
	if (isAbsent(value)) return null;
	if (!isRecord(value) || !isString(value.windowNumber) || !isNumber(value.pid)) return undefined;
	const processStart = optional(value.processStart, isNumber);
	if (processStart === false) return undefined;
	return { windowNumber: value.windowNumber, pid: value.pid, processStart };
}

export function parseWindow(value: unknown): WindowSummary | undefined {
	if (!isRecord(value) || !isString(value.id) || !isString(value.app) || !isString(value.title)) return undefined;
	const box = bounds(value);
	const pid = optional(value.pid, isNumber);
	const identity = parseIdentity(value.identity);
	if (box === undefined || pid === false || identity === undefined || !isBoolean(value.focused)) return undefined;
	return { id: value.id, app: value.app, title: value.title, pid, bounds: box, focused: value.focused, identity };
}

export function parseDisplay(value: unknown): Display | undefined {
	if (!isRecord(value) || !isString(value.id) || !isString(value.name) || !isNumber(value.scale)) return undefined;
	const box = bounds(value);
	const { pixelX, pixelY, pixelWidth, pixelHeight } = value;
	if (box === undefined || !isBoolean(value.isPrimary)) return undefined;
	if (!isNumber(pixelX) || !isNumber(pixelY) || !isNumber(pixelWidth) || !isNumber(pixelHeight)) return undefined;
	return {
		id: value.id,
		name: value.name,
		bounds: box,
		scale: value.scale,
		pixelBounds: { x: pixelX, y: pixelY, width: pixelWidth, height: pixelHeight },
		isPrimary: value.isPrimary,
	};
}

const EVIDENCE_STATES: ReadonlySet<unknown> = new Set(["known", "absent", "unknown"]);
const EVIDENCE_FIELDS = ["title", "value", "description", "enabled", "focused", "bounds"] as const;

function parseEvidence(value: unknown): AxEvidence | null | undefined {
	if (isAbsent(value)) return null;
	if (!isRecord(value) || !EVIDENCE_FIELDS.every((field) => EVIDENCE_STATES.has(value[field]))) return undefined;
	return value as unknown as AxEvidence;
}

export function parseAxNode(value: unknown): AxNode | undefined {
	if (!isRecord(value) || !isString(value.ref) || !isString(value.role) || !isString(value.nativeRole)) return undefined;
	if (!isBoolean(value.enabled) || !isBoolean(value.focused) || !isNumber(value.childCount)) return undefined;
	const title = optional(value.title, isString);
	const text = optional(value.value, isString);
	const description = optional(value.description, isString);
	const actions = optional(value.actions, isStringList);
	const evidence = parseEvidence(value.evidence);
	const { x, y, width, height } = value;
	const coordinates = [x, y, width, height];
	const box = coordinates.every(isNumber) ? bounds(value) : null;
	if (box === undefined || (box === null && !coordinates.every((field) => isAbsent(field) || isNumber(field)))) {
		return undefined;
	}
	if (title === false || text === false || description === false || actions === false || evidence === undefined) {
		return undefined;
	}
	const subtreeTruncated = optional(value.subtreeTruncated, isBoolean);
	const secure = optional(value.secure, isBoolean);
	if (subtreeTruncated === false || secure === false) return undefined;
	return {
		ref: value.ref,
		role: value.role,
		nativeRole: value.nativeRole,
		title,
		value: text,
		description,
		enabled: value.enabled,
		focused: value.focused,
		bounds: box,
		actions: actions ?? [],
		childCount: value.childCount,
		evidence,
		subtreeTruncated: subtreeTruncated ?? false,
		secure: secure ?? false,
	};
}

function parseCut(value: unknown): AxCut | undefined {
	return isRecord(value) && isString(value.ref) && isNumber(value.childCount)
		? { ref: value.ref, childCount: value.childCount }
		: undefined;
}

/** An `ax.snapshot` reply, or the `ax`/`nodeCount`/`truncated` members of an `observe` reply. */
export function parseAxSnapshot(value: unknown, textField = "text"): AxSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	const text = value[textField];
	if (!isString(text) || !isNumber(value.nodeCount) || !isBoolean(value.truncated)) return undefined;
	const generation = optional(value.generation, isNumber);
	const parent = optional(value.parent, isNumber);
	const complete = optional(value.complete, isBoolean);
	const nodesObserved = optional(value.nodesObserved, isNumber);
	const cuts = isAbsent(value.cuts) ? [] : parseList(value.cuts, parseCut);
	if (generation === false || parent === false || complete === false || nodesObserved === false || cuts === undefined) {
		return undefined;
	}
	return { text, nodeCount: value.nodeCount, truncated: value.truncated, generation, parent, complete, nodesObserved, cuts };
}

export function parseMenuItem(value: unknown): MenuItem | undefined {
	if (!isRecord(value) || !isString(value.title) || !isStringList(value.path)) return undefined;
	if (!isBoolean(value.enabled) || !isBoolean(value.checked) || !isBoolean(value.hasSubmenu)) return undefined;
	const shortcut = optional(value.shortcut, isString);
	if (shortcut === false) return undefined;
	return {
		title: value.title,
		path: value.path,
		enabled: value.enabled,
		checked: value.checked,
		hasSubmenu: value.hasSubmenu,
		shortcut,
	};
}

/** The seven valid (delivery, retry) pairs; anything else is malformed, never guessed. */
const DISPOSITIONS: ReadonlySet<string> = new Set([
	"not_delivered/safe",
	"not_delivered/after_user",
	"delivery_uncertain/unsafe",
	"delivery_uncertain/unknown",
	"delivered_unverified/unsafe",
	"delivered_verified/unsafe",
	"unknown/unknown",
]);

export function parseDisposition(value: unknown): Disposition | undefined {
	if (!isRecord(value) || !isString(value.delivery) || !isString(value.retry)) return undefined;
	if (!DISPOSITIONS.has(`${value.delivery}/${value.retry}`)) return undefined;
	return { delivery: value.delivery, retry: value.retry } as Disposition;
}

const ENGINE_EFFECTS: ReadonlySet<unknown> = new Set(["confirmed", "unverifiable", "no_change"]);
const ROUTES: ReadonlySet<unknown> = new Set(["ax", "background_window", "background_pid", "foreground_hid"]);
const FOCUS_RESTORATIONS: ReadonlySet<unknown> = new Set(["not_needed", "restored", "user_moved_on", "not_confirmed"]);

function parseSurface(value: unknown): OpenedSurface | undefined {
	if (!isRecord(value) || !isString(value.kind)) return undefined;
	const title = optional(value.title, isString);
	const windowId = optional(value.windowId, isString);
	const ref = optional(value.ref, isString);
	if (title === false || windowId === false || ref === false) return undefined;
	return { kind: value.kind, title, windowId, ref };
}

/** An engine `ActionReport`; `refused` is SDK-only, so an engine reply carrying it is malformed. */
export function parseActionReport(value: unknown): ActionReport | undefined {
	if (!isRecord(value)) return undefined;
	const disposition = parseDisposition(value.disposition);
	if (disposition === undefined || !ENGINE_EFFECTS.has(value.effect) || !FOCUS_RESTORATIONS.has(value.focusRestoration)) {
		return undefined;
	}
	if (!isStringList(value.auditIds)) return undefined;
	if (!isAbsent(value.route) && !ROUTES.has(value.route)) return undefined;
	const delivered = isAbsent(value.delivered)
		? null
		: isRecord(value.delivered) && isNumber(value.delivered.count) && isNumber(value.delivered.of)
			? { count: value.delivered.count, of: value.delivered.of }
			: undefined;
	const hitLabel = isRecord(value.hit) ? optional(value.hit.label, isString) : false;
	const hit = isAbsent(value.hit)
		? null
		: isRecord(value.hit) && isString(value.hit.role) && hitLabel !== false
			? { role: value.hit.role, label: hitLabel }
			: undefined;
	const openedSurfaces = isAbsent(value.openedSurfaces) ? [] : parseList(value.openedSurfaces, parseSurface);
	const nextCall = isAbsent(value.nextCall)
		? null
		: isRecord(value.nextCall) && isString(value.nextCall.method) && isRecord(value.nextCall.args)
			? { method: value.nextCall.method, args: value.nextCall.args }
			: undefined;
	const note = optional(value.note, isString);
	const warning = optional(value.warning, isString);
	if (delivered === undefined || hit === undefined || openedSurfaces === undefined || nextCall === undefined) {
		return undefined;
	}
	if (note === false || warning === false) return undefined;
	return {
		disposition,
		delivered,
		effect: value.effect as ActionReport["effect"],
		route: (value.route ?? null) as ActionReport["route"],
		hit,
		focusRestoration: value.focusRestoration as ActionReport["focusRestoration"],
		openedSurfaces,
		nextCall,
		note,
		warning,
		auditIds: value.auditIds,
		timings: null,
		legacy: false,
	};
}

export function parseCapabilities(value: unknown): DesktopCapabilities | undefined {
	if (!isRecord(value) || !isString(value.backend) || !isBoolean(value.capture) || !isBoolean(value.input)) {
		return undefined;
	}
	if (!isBoolean(value.ax) || !isStringList(value.deliveryModes) || !isString(value.stopPath)) return undefined;
	return value as unknown as DesktopCapabilities;
}

export function parseStopPathStatus(value: unknown): StopPathStatus | undefined {
	if (!isRecord(value) || !isBoolean(value.suspended) || !isBoolean(value.globalLive)) return undefined;
	if (!isBoolean(value.hostRelayLive) || !isBoolean(value.heartbeatFresh) || !isString(value.stopPath)) return undefined;
	return value as unknown as StopPathStatus;
}

export function parseAuditEvent(value: unknown): AuditEvent | undefined {
	if (!isRecord(value) || !isString(value.target) || !isString(value.delivery) || !isNumber(value.durationMs)) {
		return undefined;
	}
	const action = isString(value.action) ? value.action : UNKNOWN_AUDIT_VALUE;
	return { ...value, action } as unknown as AuditEvent;
}

const EPOCH_REASONS: ReadonlySet<unknown> = new Set(["display", "lock", "sleep", "space", "engine_restarted", "idle_flush"]);

export function parseEpochChanged(value: unknown): EpochChanged | undefined {
	return isRecord(value) && EPOCH_REASONS.has(value.reason) ? (value as unknown as EpochChanged) : undefined;
}

export interface ControlStateResult {
	readonly active: boolean;
	readonly reason: string | null;
	readonly grantedAt: string | null;
}

export function parseControlState(value: unknown): ControlStateResult | undefined {
	if (!isRecord(value) || !isBoolean(value.active)) return undefined;
	const reason = optional(value.reason, isString);
	const grantedAt = optional(value.grantedAt, isString);
	if (reason === false || grantedAt === false) return undefined;
	return { active: value.active, reason, grantedAt };
}

export function parseAttributes(value: unknown): Readonly<Record<string, string>> | undefined {
	const pairs = parseList(value, (pair) => (isStringList(pair) && pair.length === 2 ? pair : undefined));
	return pairs === undefined ? undefined : Object.fromEntries(pairs.map(([name, text]) => [name, text]));
}

/** Which engine methods send input, so a failure of theirs cannot be assumed to have sent nothing. */
export type Tier = "read" | "exec";

export type Parser<T> = (value: unknown) => T | undefined;
