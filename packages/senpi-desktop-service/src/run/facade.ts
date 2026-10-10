import { randomUUID } from "node:crypto";
import { DESKTOP_METHODS, type DesktopCapabilities } from "@oh-my-opencode/senpi-desktop-protocol";
import { isDesktopCapabilities } from "../service/parse";
import { ComputerRunError, facadeMethod, type RunScope } from "./context";
import {
	type DesktopDisplay,
	type DesktopWindow,
	expectResult,
	isAxNode,
	isDisplay,
	isText,
	isWindow,
	listOf,
	optional,
} from "./engine-results";
import { ElementHandle, InputTarget, resolveElement, WindowHandle } from "./handles";

export interface WindowFilter {
	/** Case-insensitive substring of the owning app name. */
	readonly app?: string;
	/** Case-insensitive substring of the window title. */
	readonly title?: string;
}

function matchesFilter(window: DesktopWindow, filter: WindowFilter = {}): boolean {
	const app = filter.app?.toLocaleLowerCase();
	const title = filter.title?.toLocaleLowerCase();
	return (
		(!app || window.app.toLocaleLowerCase().includes(app)) &&
		(!title || window.title.toLocaleLowerCase().includes(title))
	);
}

/** The `desktop` global of a computer run (and the root of direct `call` chains): one engine target plus lookups. */
export function createDesktopFacade(scope: RunScope) {
	const method = facadeMethod(scope, DESKTOP_METHODS);
	const listWindows = async ({ call }: RunScope): Promise<readonly DesktopWindow[]> =>
		expectResult("windows", await call("windows", {}), listOf(isWindow));
	const element = async (
		engineMethod: "ax.elementAt" | "ax.focused",
		params: object,
	): Promise<ElementHandle | null> => {
		const node = expectResult(engineMethod, await scope.call(engineMethod, params), optional(isAxNode));
		return node === null ? null : new ElementHandle(scope, node);
	};
	const root = new InputTarget(scope, "desktop", DESKTOP_METHODS);
	return {
		capabilities: (): Promise<DesktopCapabilities> =>
			method("capabilities", async ({ call }) =>
				expectResult("capabilities", await call("capabilities", {}), isDesktopCapabilities),
			),
		displays: (): Promise<readonly DesktopDisplay[]> =>
			method("displays", async ({ call }) =>
				expectResult("displays", await call("displays", {}), listOf(isDisplay)),
			),
		windows: (filter?: WindowFilter): Promise<readonly DesktopWindow[]> =>
			method("windows", async (run) => (await listWindows(run)).filter((window) => matchesFilter(window, filter))),
		/** Exactly one window by opaque id or filter; an ambiguous filter throws listing the candidates. */
		window: (selector: string | WindowFilter): Promise<WindowHandle> =>
			method("window", async (run) => {
				const found = (await listWindows(run)).filter((window) =>
					typeof selector === "string" ? window.id === selector : matchesFilter(window, selector),
				);
				const [only, ...others] = found;
				if (only === undefined)
					throw new ComputerRunError("window", `no window matches ${JSON.stringify(selector)}`);
				if (others.length > 0) {
					const candidates = found.map((window) => `${window.id} ${window.app} ${JSON.stringify(window.title)}`);
					throw new ComputerRunError(
						"window",
						`multiple windows match ${JSON.stringify(selector)}:\n${candidates.join("\n")}`,
					);
				}
				return new WindowHandle(scope, only);
			}),
		focusedWindow: (): Promise<WindowHandle | null> =>
			method("focusedWindow", async (run) => {
				const focused = (await listWindows(run)).find((window) => window.focused);
				return focused === undefined ? null : new WindowHandle(scope, focused);
			}),
		screenshot: root.screenshot.bind(root),
		click: root.click.bind(root),
		doubleClick: root.doubleClick.bind(root),
		move: root.move.bind(root),
		drag: root.drag.bind(root),
		scroll: root.scroll.bind(root),
		type: root.type.bind(root),
		press: root.press.bind(root),
		/** The element under a point in global logical desktop coordinates (not screenshot pixels). */
		elementAt: (x: number, y: number): Promise<ElementHandle | null> =>
			method("elementAt", () => element("ax.elementAt", { target: "desktop", x, y })),
		focusedElement: (): Promise<ElementHandle | null> => method("focusedElement", () => element("ax.focused", {})),
		ref: (ref: string): Promise<ElementHandle> => method("ref", (run) => resolveElement(run, ref)),
		clipboard: {
			read: (): Promise<string> =>
				method(
					"clipboard.read",
					async ({ call }) => expectResult("clipboard.read", await call("clipboard.read", {}), isText).text,
				),
			write: (text: string): Promise<void> =>
				method("clipboard.write", async ({ call }) => {
					await call("clipboard.write", { text });
				}),
		},
		control: createControlFacade(scope, method),
	};
}

/** The `control.state` result shape, mirrored from the engine's `ControlStateResult` (#9651 B5). */
export interface ControlState {
	readonly active: boolean;
	readonly reason?: string | null;
	readonly grantedAt?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isControlState(value: unknown): value is ControlState {
	return isRecord(value) && typeof value.active === "boolean";
}

/**
 * `desktop.control`: the foreground-control grant. `acquire` asks the human through the run's confirm
 * channel and only then calls the host-only `control.grant`; a "yes" that arrives after the run was
 * aborted is discarded (the fence oh-my-pi's `#controlEpoch` guards, here the run's own signal).
 */
function createControlFacade(scope: RunScope, method: ReturnType<typeof facadeMethod>) {
	const state = (): Promise<ControlState> =>
		method("control.state", async ({ call }) =>
			expectResult("control.state", await call("control.state", {}), isControlState),
		);
	return {
		acquire: (options: { reason: string }): Promise<ControlState> =>
			method("control.acquire", async ({ context, call }) => {
				const reason = typeof options?.reason === "string" ? options.reason.trim() : "";
				if (reason.length === 0) {
					throw new ComputerRunError("assertion", "control.acquire requires a non-empty reason");
				}
				const current = expectResult("control.state", await call("control.state", {}), isControlState);
				if (current.active) return current;
				const confirm = scope.confirmControl;
				if (confirm === undefined) return { active: false };
				const approved = await confirm(reason, context.signal);
				context.signal.throwIfAborted();
				if (approved !== true) return { active: false };
				return expectResult(
					"control.grant",
					await call("control.grant", { reason, confirmationId: randomUUID() }),
					isControlState,
				);
			}),
		release: (): Promise<void> =>
			method("control.release", async ({ call }) => {
				await call("control.revoke", {});
			}),
		state,
	};
}

export type DesktopFacade = ReturnType<typeof createDesktopFacade>;
