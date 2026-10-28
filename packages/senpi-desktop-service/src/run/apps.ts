import { lstat } from "node:fs/promises";
import path from "node:path";
import type { FacadeMethod, RunScope } from "./context";
import { type DesktopWindow, expectResult, isWindow, listOf } from "./engine-results";
import { WindowHandle } from "./handles";
import { isRecord, matches } from "../service/parse";

/** One installed or running application (`apps.list`). */
export interface Application {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly running: boolean;
	readonly pid?: number | null;
}

/** `apps.open`'s result: the application and the window it shows, as a handle. */
export interface OpenedApplication extends Application {
	readonly window: WindowHandle | null;
}

export interface AppsListOptions {
	readonly query?: string;
	readonly runningOnly?: boolean;
}

export interface AppsOpenOptions {
	/** Bring the application to the front; takes the user's foreground, so it needs the control grant. */
	readonly activate?: boolean;
	/** Show the file or folder selected in Finder, which comes to the front (macOS; needs the grant). */
	readonly reveal?: boolean;
	/** The application to open a document with (id, name or path). */
	readonly app?: string;
}

const APPLICATION = { id: "string", name: "string", path: "string", running: "boolean", pid: "number?" } as const;

export const isApplication = (value: unknown): value is Application => matches(value, APPLICATION);

interface OpenedApplicationWire extends Application {
	readonly window: DesktopWindow | null;
}

const isOpenedApplication = (value: unknown): value is OpenedApplicationWire =>
	isApplication(value) && isRecord(value) && (value.window === null || isWindow(value.window));

/** A URL (`https:`, `x-apple.systempreferences:`); never a drive letter. */
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]+:/;

async function entryExists(local: string): Promise<boolean> {
	try {
		await lstat(local);
		return true;
	} catch {
		return false;
	}
}

/**
 * `apps.open`'s target or `app` selector resolved against the session's folder `cwd` when it names a path
 * there: one written as a relative path (`./a`, `a/b`), even if missing, or a bare name of an existing
 * entry. An exact application id or native path (`listed`) keeps precedence over a same-named entry;
 * absolute paths, URLs and other names pass through to native resolution.
 */
export async function sessionPath(
	value: string,
	cwd: string,
	listed: (value: string) => Promise<boolean>,
): Promise<string> {
	if (path.isAbsolute(value) || URL_SCHEME.test(value)) return value;
	const local = path.resolve(cwd, value);
	const written = value.startsWith(".") || value.includes("/") || value.includes(path.sep);
	if (!written && !(await entryExists(local))) return value;
	return (await listed(value)) ? value : local;
}

/** `desktop.apps`: the application inventory and the non-activating open. */
export function createAppsFacade(scope: RunScope, method: FacadeMethod) {
	const list = async ({ call }: RunScope, options: AppsListOptions = {}): Promise<readonly Application[]> =>
		expectResult("apps.list", await call("apps.list", { ...options }), listOf(isApplication));
	return {
		list: (options?: AppsListOptions): Promise<readonly Application[]> =>
			method("apps.list", (run) => list(run, options)),
		open: (id: string, options: AppsOpenOptions = {}): Promise<OpenedApplication> =>
			method("apps.open", async (run) => {
				if (typeof id !== "string" || id.length === 0) {
					throw new TypeError("apps.open(id) requires a non-empty application id, name, path or URL");
				}
				const listed = async (value: string): Promise<boolean> =>
					(await list(run)).some((app) => app.id === value || app.path === value);
				const cwd = run.context.snapshot.cwd;
				const target = await sessionPath(id, cwd, listed);
				const app = typeof options.app === "string" ? await sessionPath(options.app, cwd, listed) : undefined;
				const params = { id: target, activate: options.activate, reveal: options.reveal, app };
				const opened = expectResult("apps.open", await run.call("apps.open", params), isOpenedApplication);
				const { window, ...application } = opened;
				return { ...application, window: window === null ? null : new WindowHandle(scope, window) };
			}),
	};
}
