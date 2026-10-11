import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { type FieldSpec, isRecord, isStringArray, matches } from "../service/parse";
import { DesktopServiceError } from "../service/rpc-client";

// Result shapes of the engine methods the run facade calls, mirrored from senpi-desktop-core
// (`DesktopDisplay`, `DesktopWindow`, `AxNode`, `CaptureResult`). Engine stdout is the trust
// boundary: every result is shape-checked here before the facade hands it to user code.

/** Monitor geometry in global logical points plus composite screenshot pixels. */
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
	readonly scale: number;
	readonly target: string;
	readonly frameId: string;
	readonly note?: string | null;
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

export const isCaptureResult: Guard<CaptureResult> = (value): value is CaptureResult => matches(value, CAPTURE);

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
