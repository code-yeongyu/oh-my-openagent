import type { DesktopWindow } from "./engine-results";

const MAX_APPS = 12;
const WINDOWS_PER_APP = 3;
const WINDOWS_PER_MATCHED_APP = 10;
const MAX_TITLE_CHARS = 80;

/**
 * What `computer.apps.open` does for an app with no listed window: on macOS it also shows a window of a
 * running app that has none and returns it; elsewhere it only launches. A read-only run still gets the
 * hint, since the next call can open the app.
 */
export type AppOpenRoute = "shows-window" | "launches";

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Lists the open windows by app, apps matching `app` first, for a selector that matched nothing. */
export function describeWindowMiss(
	windows: readonly DesktopWindow[],
	app: string | undefined,
	route: AppOpenRoute,
): string {
	// An empty `app` filters nothing in `matchesFilter`, so it matches no app here either.
	const needle = app?.toLocaleLowerCase() || undefined;
	const matched = (name: string): boolean => needle !== undefined && name.toLocaleLowerCase().includes(needle);
	const call = `computer.apps.open(${JSON.stringify(app)})`;
	const hint =
		route === "shows-window"
			? `${call} opens it by that exact name or id, or shows a window of it if it runs without one, and returns it with that window (window: null if none appears within 3 s).\n`
			: `${call} launches it by that exact name or id.\n`;
	const note =
		needle !== undefined && !windows.some((window) => matched(window.app))
			? `No open window belongs to an app matching ${JSON.stringify(app)}.\n${hint}`
			: "";
	if (windows.length === 0) return `${note}No windows are open.`;
	const byApp = new Map<string, DesktopWindow[]>();
	for (const window of windows) {
		const group = byApp.get(window.app);
		if (group === undefined) byApp.set(window.app, [window]);
		else group.push(window);
	}
	const focusedApp = windows.find((window) => window.focused)?.app;
	const rank = (name: string): number => (matched(name) ? 0 : name === focusedApp ? 1 : 2);
	const apps = [...byApp.keys()].sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
	const lines = apps.slice(0, MAX_APPS).map((name) => {
		const group = byApp.get(name) ?? [];
		// Titled windows first; untitled ones still list their ids, since macOS without Screen Recording blanks other apps' titles.
		const ordered = [...group].sort((left, right) => Number(!left.title.trim()) - Number(!right.title.trim()));
		const limit = matched(name) ? WINDOWS_PER_MATCHED_APP : WINDOWS_PER_APP;
		const entries = ordered
			.slice(0, limit)
			.map((window) => `${window.id} ${JSON.stringify(truncate(window.title, MAX_TITLE_CHARS))}`);
		if (ordered.length > limit) entries.push(`${ordered.length - limit} more`);
		return `- ${name}: ${entries.join(", ")}`;
	});
	const omitted = apps.slice(MAX_APPS);
	if (omitted.length > 0) {
		const count = omitted.reduce((sum, name) => sum + (byApp.get(name)?.length ?? 0), 0);
		lines.push(`- ${omitted.length} more ${omitted.length === 1 ? "app" : "apps"} with ${count} windows`);
	}
	return `${note}Open windows by app (id "title"):\n${lines.join("\n")}`;
}
