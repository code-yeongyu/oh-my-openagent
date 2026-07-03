import { isAbsolute, relative } from "node:path";
import type { InjectionCache } from "../core/injection-cache.ts";

export const STATUS_KEY = "ext:nested-agents:status";
export const WIDGET_KEY = "ext:nested-agents:widget";

export interface ThemeFn {
	fg(color: string, text: string): string;
}

export interface UiSurface {
	hasUI: boolean;
	cwd: string;
	ui?: {
		theme?: ThemeFn;
		setStatus?(key: string, text: string | undefined): void;
		setWidget?(
			key: string,
			lines: string[] | undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		): void;
		notify?(message: string, level?: "info" | "warn" | "warning" | "error"): void;
	};
}

export interface InjectedFileMeta {
	absolutePath: string;
	truncated: boolean;
}

export function updateStatus(ctx: UiSurface, cache: InjectionCache, sessionKey: string, hasErrors: boolean): void {
	if (!ctx.hasUI || !ctx.ui?.setStatus) return;
	const count = cache.getCacheSize(sessionKey);
	if (count === 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const theme = ctx.ui.theme ?? identityTheme;
	let text = theme.fg("dim", `🤖 ${count}`);
	if (hasErrors) text += theme.fg("warning", " ⚠️");
	ctx.ui.setStatus(STATUS_KEY, text);
}

export function clearStatus(ctx: UiSurface): void {
	if (!ctx.hasUI || !ctx.ui?.setStatus) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

export function updateWidget(ctx: UiSurface, visible: boolean, files: InjectedFileMeta[]): void {
	if (!ctx.hasUI || !ctx.ui?.setWidget) return;
	if (!visible || files.length === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}
	const theme = ctx.ui.theme ?? identityTheme;
	const lines = [theme.fg("accent", "Nested Context:")];
	for (const file of files) {
		const display = displayPath(ctx.cwd, file.absolutePath);
		const text = file.truncated ? `  ${display} (truncated)` : `  ${display}`;
		lines.push(theme.fg(file.truncated ? "warning" : "dim", text));
	}
	ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
}

export function clearWidget(ctx: UiSurface): void {
	if (!ctx.hasUI || !ctx.ui?.setWidget) return;
	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function buildDebugRecord(input: {
	cache: InjectionCache;
	sessionKey: string;
	files: InjectedFileMeta[];
}): Record<string, unknown> {
	return {
		sessionKey: input.sessionKey,
		cacheSize: input.cache.getCacheSize(input.sessionKey),
		injectedDirectories: input.cache.listInjected(input.sessionKey),
		injectedFiles: input.files.map((f) => ({
			path: f.absolutePath,
			truncated: f.truncated,
		})),
	};
}

function displayPath(cwd: string, absolutePath: string): string {
	if (!isAbsolute(absolutePath)) return absolutePath;
	const rel = relative(cwd, absolutePath);
	if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return absolutePath;
	return rel;
}

const identityTheme: ThemeFn = {
	fg: (_color: string, text: string) => text,
};
