import { ELEMENT_METHODS, type EngineMethod, WINDOW_METHODS } from "@oh-my-opencode/senpi-desktop-protocol";
import { type FacadeMethod, facadeMethod, type RunScope } from "./context";
import {
	type AxNode,
	type DesktopWindow,
	type MenuItem,
	expectResult,
	isAttributePairs,
	isAxNode,
	isMenuItem,
	isText,
	listOf,
	optional,
} from "./engine-results";
import { type DeliveryOptions, InputTarget, pointerOptions, send } from "./input-target";
import { observeWindow, type ObserveOptions, type ObservationResult } from "./observe";
export { type ClickOptions, type DeliveryOptions, InputTarget, type ScrollOptions } from "./input-target";

export interface AxOptions {
	readonly all?: boolean;
	readonly maxDepth?: number;
	readonly maxNodes?: number;
}

export interface AxQuery {
	readonly role?: string;
	readonly title?: string;
	readonly value?: string;
	readonly limit?: number;
}

export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A window resolved by `desktop.window()`; identity fields are a snapshot, every call goes by id. */
export class WindowHandle extends InputTarget {
	readonly id: string;
	readonly app: string;
	readonly title: string;
	readonly pid: number | undefined;
	readonly bounds: Bounds;
	readonly focused: boolean;
	readonly #method: FacadeMethod;

	constructor(scope: RunScope, window: DesktopWindow) {
		super(scope, window.id, WINDOW_METHODS);
		this.#method = facadeMethod(scope, WINDOW_METHODS);
		this.id = window.id;
		this.app = window.app;
		this.title = window.title;
		this.pid = window.pid ?? undefined;
		this.bounds = { x: window.x, y: window.y, width: window.width, height: window.height };
		this.focused = window.focused;
	}

	raise(): Promise<void> {
		return send(this.#method, "raise", "raiseWindow", { windowId: this.id });
	}

	/** The window's native menu: `items` lists children (empty path = the menu bar), `select` invokes a leaf. */
	readonly menu = {
		items: (path?: readonly string[]): Promise<readonly MenuItem[]> =>
			this.#method("menu.items", async ({ call }) => {
				const items = await call("menus.items", { windowId: this.id, path: [...(path ?? [])] });
				return expectResult("menus.items", items, listOf(isMenuItem));
			}),
		select: (path: readonly string[], options?: { readonly delivery?: string }): Promise<void> =>
			send(this.#method, "menu.select", "menus.select", {
				windowId: this.id,
				path: [...path],
				// Foreground keys the target window and needs the control grant (#9888); omitted stays background.
				...(options?.delivery === undefined ? {} : { deliveryMode: options.delivery }),
			}),
	};

	/** The formatted accessibility tree, one node per line with `[ref=eN]` tags. */
	ax(options?: AxOptions): Promise<string> {
		return this.#method("ax", async ({ call }) => {
			const snapshot = await call("ax.snapshot", { target: this.id, opts: options });
			return expectResult("ax.snapshot", snapshot, isText).text;
		});
	}

	observe(options?: ObserveOptions): Promise<ObservationResult> {
		return this.#method("observe", (scope) => observeWindow(scope, this.id, options));
	}

	find(query: AxQuery): Promise<readonly ElementHandle[]> {
		return this.#method("find", async (scope) => {
			const nodes = await scope.call("ax.query", { target: this.id, query });
			return expectResult("ax.query", nodes, listOf(isAxNode)).map((node) => new ElementHandle(scope, node));
		});
	}

	ref(ref: string): Promise<ElementHandle> {
		return this.#method("ref", (scope) => resolveElement(scope, ref));
	}
}

export async function resolveElement(scope: RunScope, ref: string): Promise<ElementHandle> {
	return new ElementHandle(scope, expectResult("ax.node", await scope.call("ax.node", { ref }), isAxNode));
}

/** An accessibility element; identity fields are a snapshot, every call re-resolves `ref` in the engine. */
export class ElementHandle {
	readonly ref: string;
	readonly role: string;
	readonly nativeRole: string;
	readonly title: string | undefined;
	readonly description: string | undefined;
	readonly enabled: boolean;
	readonly focused: boolean;
	readonly childCount: number;
	readonly #method: FacadeMethod;

	constructor(scope: RunScope, node: AxNode) {
		this.#method = facadeMethod(scope, ELEMENT_METHODS);
		this.ref = node.ref;
		this.role = node.role;
		this.nativeRole = node.nativeRole;
		this.title = node.title ?? undefined;
		this.description = node.description ?? undefined;
		this.enabled = node.enabled;
		this.focused = node.focused;
		this.childCount = node.childCount;
	}

	#send(method: string, engineMethod: EngineMethod, params: object): Promise<void> {
		return this.#method(method, async ({ call }) => {
			await call(engineMethod, { ref: this.ref, ...params });
		});
	}

	#node<T>(method: string, project: (node: AxNode) => T): Promise<T> {
		return this.#method(method, async ({ call }) =>
			project(expectResult("ax.node", await call("ax.node", { ref: this.ref }), isAxNode)),
		);
	}

	value(): Promise<string | undefined> {
		return this.#node("value", (node) => node.value ?? undefined);
	}

	setValue(value: string): Promise<void> {
		return this.#send("setValue", "ax.setValue", { value });
	}

	/** Bounds in global logical points, or `null` when the element has none. */
	bounds(): Promise<Bounds | null> {
		return this.#node("bounds", ({ x, y, width, height }) =>
			x == null || y == null || width == null || height == null ? null : { x, y, width, height },
		);
	}

	attributes(): Promise<Readonly<Record<string, string>>> {
		return this.#method("attributes", async ({ call }) =>
			Object.fromEntries(
				expectResult("ax.attributes", await call("ax.attributes", { ref: this.ref }), isAttributePairs),
			),
		);
	}

	actions(): Promise<readonly string[]> {
		return this.#node("actions", (node) => node.actions ?? []);
	}

	perform(action: string): Promise<void> {
		return this.#send("perform", "ax.perform", { action });
	}

	press(): Promise<void> {
		return this.#send("press", "ax.perform", { action: "press" });
	}

	click(options?: DeliveryOptions): Promise<void> {
		return this.#send("click", "ax.click", { opts: pointerOptions(options) });
	}

	focus(): Promise<void> {
		return this.#send("focus", "ax.focus", {});
	}

	parent(): Promise<ElementHandle | null> {
		return this.#method("parent", async (scope) => {
			const node = expectResult("ax.parent", await scope.call("ax.parent", { ref: this.ref }), optional(isAxNode));
			return node === null ? null : new ElementHandle(scope, node);
		});
	}

	children(): Promise<readonly ElementHandle[]> {
		return this.#method("children", async (scope) => {
			const nodes = await scope.call("ax.children", { ref: this.ref });
			return expectResult("ax.children", nodes, listOf(isAxNode)).map((node) => new ElementHandle(scope, node));
		});
	}
}
