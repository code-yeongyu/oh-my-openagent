import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { type FieldSpec, isRecord, isStringArray, matches } from "../service/parse";
import { DesktopServiceError } from "../service/rpc-client";

// Result shapes of the engine methods the run facade calls, mirrored from senpi-desktop-core
// (`DesktopDisplay`, `DesktopWindow`, `AxNode`, `CaptureResult`). Engine stdout is the trust
// boundary: every result is shape-checked here before the facade hands it to user code.

/** Monitor geometry in global points plus `display("all")` composite pixels, not active-capture pixels. */
export interface DesktopDisplay {
	readonly id: string;
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly pixelX: number;
	readonly pixelY: number;
	readonly pixelWidth: number;
	readonly pixelHeight: number;
	readonly isPrimary: boolean;
}

/** One top-level window in global logical points; `id` is opaque. */
export interface DesktopWindow {
	readonly id: string;
	readonly title: string;
	readonly app: string;
	readonly pid?: number | null;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly focused: boolean;
	readonly elevated?: boolean | null;
}

/** One accessibility element; bounds are global logical points. */
export interface AxNode {
	readonly ref: string;
	readonly role: string;
	readonly nativeRole: string;
	readonly title?: string | null;
	readonly value?: string | null;
	readonly description?: string | null;
	readonly enabled: boolean;
	readonly focused: boolean;
	readonly x?: number | null;
	readonly y?: number | null;
	readonly width?: number | null;
	readonly height?: number | null;
	readonly actions?: readonly string[] | null;
	readonly childCount: number;
}

/** The `capture` result: inline image bytes, or only an artifact path when over the byte budget. */
export interface CaptureResult {
	/** `artifact-only` when no bytes are inline; otherwise an inline image mode. */
	readonly mode: string;
	readonly data?: string | null;
	readonly mimeType?: string | null;
	readonly artifactPath?: string | null;
	readonly width: number;
	readonly height: number;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	/** The full screenshot's frame for input; absent from engines that predate zoom, where it is `width`x`height`. */
	readonly coordinateWidth?: number | null;
	readonly coordinateHeight?: number | null;
	readonly region?: CaptureRegion | null;
	readonly scale: number;
	readonly target: string;
	readonly frameId: string;
	readonly note?: string | null;
}

/** Rectangle in the last full screenshot's pixels. */
export interface CaptureRegion {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Screenshot and AX text from one serialized, committed observation. */
export interface ObserveResult extends CaptureResult {
	readonly ax: string;
	readonly nodeCount: number;
	readonly truncated: boolean;
}

const DISPLAY: FieldSpec = {
	id: "string",
	name: "string",
	x: "number",
	y: "number",
	width: "number",
	height: "number",
	scale: "number",
	pixelX: "number",
	pixelY: "number",
	pixelWidth: "number",
	pixelHeight: "number",
	isPrimary: "boolean",
};

const WINDOW: FieldSpec = {
	id: "string",
	title: "string",
	app: "string",
	pid: "number?",
	x: "number",
	y: "number",
	width: "number",
	height: "number",
	focused: "boolean",
	elevated: "boolean?",
};

const AX_NODE: FieldSpec = {
	ref: "string",
	role: "string",
	nativeRole: "string",
	title: "string?",
	value: "string?",
	description: "string?",
	enabled: "boolean",
	focused: "boolean",
	x: "number?",
	y: "number?",
	width: "number?",
	height: "number?",
	childCount: "number",
};

const MENU_ITEM: FieldSpec = {
	title: "string",
	enabled: "boolean",
	checked: "boolean",
	hasSubmenu: "boolean",
	shortcut: "string?",
};

const CAPTURE: FieldSpec = {
	mode: "string",
	data: "string?",
	mimeType: "string?",
	artifactPath: "string?",
	width: "number",
	height: "number",
	sourceWidth: "number",
	sourceHeight: "number",
	coordinateWidth: "number?",
	coordinateHeight: "number?",
	scale: "number",
	target: "string",
	frameId: "string",
	note: "string?",
};

type Guard<T> = (value: unknown) => value is T;

export const isDisplay: Guard<DesktopDisplay> = (value): value is DesktopDisplay => matches(value, DISPLAY);

export const isWindow: Guard<DesktopWindow> = (value): value is DesktopWindow => matches(value, WINDOW);

export const isAxNode: Guard<AxNode> = (value): value is AxNode =>
	matches(value, AX_NODE) && (value.actions === undefined || value.actions === null || isStringArray(value.actions));

/** One immediate child of a native menu; `path` holds the native labels, ellipses included. */
export interface MenuItem {
	readonly title: string;
	readonly path: readonly string[];
	readonly enabled: boolean;
	readonly checked: boolean;
	readonly hasSubmenu: boolean;
	readonly shortcut?: string | null;
}

export const isMenuItem: Guard<MenuItem> = (value): value is MenuItem =>
	matches(value, MENU_ITEM) && isStringArray(value.path);

export const isCaptureResult: Guard<CaptureResult> = (value): value is CaptureResult =>
	matches(value, CAPTURE) && (value.region == null ||
		matches(value.region, { x: "number", y: "number", width: "number", height: "number" }));

/** A zoom reply must carry the full input frame and its region; only plain captures may predate them. */
export const isZoomResult: Guard<CaptureResult> = (value): value is CaptureResult =>
	isCaptureResult(value) && typeof value.coordinateWidth === "number" &&
	typeof value.coordinateHeight === "number" && value.region != null;

/** An observe reply comes only from engines that already send the full input frame. */
export const isObserveResult: Guard<ObserveResult> = (value): value is ObserveResult =>
	isCaptureResult(value) && typeof value.coordinateWidth === "number" && typeof value.coordinateHeight === "number" &&
	matches(value, { ax: "string", nodeCount: "number", truncated: "boolean" });

/** `ax.typeText` reply: how the text reached the element. */
export interface AxInputResult {
	readonly method: "inserted" | "keys";
}

export const isAxInputResult: Guard<AxInputResult> = (value): value is AxInputResult =>
	typeof value === "object" && value !== null && ((value as { method?: unknown }).method === "inserted" || (value as { method?: unknown }).method === "keys");

/** Whether input reached the target, and whether sending the same request again could duplicate it. */
export type Disposition =
	| { readonly delivery: "not_delivered"; readonly retry: "safe" | "after_user" }
	| { readonly delivery: "delivery_uncertain"; readonly retry: "unsafe" | "unknown" }
	| { readonly delivery: "delivered_unverified" | "delivered_verified"; readonly retry: "unsafe" }
	| { readonly delivery: "unknown"; readonly retry: "unknown" };

/**
 * The exec reply of a session opened with `reportMode: "object"` (core `ActionReport`). Members other
 * than the four required ones are open: a newer engine may fill more of them.
 */
export interface ActionReport {
	readonly disposition: Disposition;
	readonly delivered?: { readonly count: number; readonly of: number } | null;
	readonly effect: string;
	readonly route?: string | null;
	readonly hit?: { readonly role: string; readonly label?: string | null } | null;
	readonly focusRestoration: string;
	readonly openedSurfaces?: readonly Readonly<Record<string, unknown>>[];
	readonly nextCall?: { readonly method: string; readonly args: Readonly<Record<string, unknown>> } | null;
	readonly note?: string | null;
	readonly warning?: string | null;
	readonly auditIds: readonly string[];
}

/** The seven valid (delivery, retry) pairs; anything else is a malformed reply, never a guess. */
const DISPOSITIONS: ReadonlySet<string> = new Set([
	"not_delivered/safe",
	"not_delivered/after_user",
	"delivery_uncertain/unsafe",
	"delivery_uncertain/unknown",
	"delivered_unverified/unsafe",
	"delivered_verified/unsafe",
	"unknown/unknown",
]);

function isDisposition(value: unknown): value is Disposition {
	return matches(value, { delivery: "string", retry: "string" }) && DISPOSITIONS.has(`${value.delivery}/${value.retry}`);
}

const isActionReport: Guard<ActionReport> = (value): value is ActionReport =>
	matches(value, { effect: "string", focusRestoration: "string", route: "string?", note: "string?", warning: "string?" }) &&
	isDisposition(value.disposition) &&
	isStringArray(value.auditIds) &&
	(value.delivered == null || matches(value.delivered, { count: "number", of: "number" })) &&
	(value.hit == null || matches(value.hit, { role: "string", label: "string?" })) &&
	(value.openedSurfaces === undefined || (Array.isArray(value.openedSurfaces) && value.openedSurfaces.every(isRecord))) &&
	(value.nextCall == null || (matches(value.nextCall, { method: "string" }) && isRecord(value.nextCall.args)));

/** An exec reply: `null` from a `reportMode: "null"` session or an older engine, else an `ActionReport`. */
export const isExecResult: Guard<ActionReport | null> = (value): value is ActionReport | null =>
	value === null || isActionReport(value);

export const isText: Guard<{ readonly text: string }> = (value): value is { readonly text: string } =>
	isRecord(value) && typeof value.text === "string";

export const isAttributePairs: Guard<readonly (readonly [string, string])[]> = (
	value,
): value is readonly (readonly [string, string])[] =>
	Array.isArray(value) && value.every((pair) => isStringArray(pair) && pair.length === 2);

export function listOf<T>(guard: Guard<T>): Guard<readonly T[]> {
	return (value): value is readonly T[] => Array.isArray(value) && value.every(guard);
}

export function optional<T>(guard: Guard<T>): Guard<T | null> {
	return (value): value is T | null => value === null || guard(value);
}

/** `value` as `T`, or a `DesktopServiceError` naming the method whose result was malformed. */
export function expectResult<T>(method: EngineMethod, value: unknown, guard: Guard<T>): T {
	if (!guard(value)) throw new DesktopServiceError("Internal", `desktop engine sent a malformed ${method} result`);
	return value;
}
