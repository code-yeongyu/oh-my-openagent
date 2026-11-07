import { ELEMENT_METHODS, type EngineMethod, WINDOW_METHODS } from "@oh-my-opencode/senpi-desktop-protocol";
import type {
	Delivery,
	AxNode as SdkAxNode,
	MenuItem as SdkMenuItem,
	Window as SdkWindow,
} from "@oh-my-opencode/senpi-desktop-sdk";
import { isDesktopCapabilities } from "../service/parse";
import { type FacadeMethod, facadeMethod, type ReplyGuard, type RunScope, viaSdk } from "./context";
import {
	type AxInputResult,
	type AxNode,
	type DesktopWindow,
	type MenuItem,
	expectResult,
	isAttributePairs,
	isAxInputResult,
	isAxNode,
	isDisplay,
	isExecResult,
	isMenuItem,
	isText,
	isWindow,
	listOf,
	optional,
} from "./engine-results";
import { type DeliveryOptions, InputTarget, pointerOptions } from "./input-target";
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

/**
 * The run facade's checks of the engine replies it reads through the SDK, kept so a malformed reply fails with
 * the same `DesktopServiceError` as before the facade wrapped the SDK.
 */
export const RUN_REPLY_GUARDS: Readonly<Partial<Record<EngineMethod, ReplyGuard>>> = {
	capabilities: isDesktopCapabilities,
	displays: listOf(isDisplay),
	windows: listOf(isWindow),
	raiseWindow: isExecResult,
	"menus.items": listOf(isMenuItem),
	"menus.select": isExecResult,
	"ax.query": listOf(isAxNode),
};

function menuItem({ title, path, enabled, checked, hasSubmenu, shortcut }: SdkMenuItem): MenuItem {
	return { title, path, enabled, checked, hasSubmenu, shortcut };
}

/** The run's `AxNode` shape (flat bounds) of an SDK node. */
function runAxNode(node: SdkAxNode): AxNode {
	const { ref, role, nativeRole, title, value, description, enabled, focused, actions, childCount, bounds } = node;
	return {
		ref,
		role,
		nativeRole,
		title,
		value,
		description,
		enabled,
		focused,
		x: bounds?.x ?? null,
		y: bounds?.y ?? null,
		width: bounds?.width ?? null,
		height: bounds?.height ?? null,
		actions,
		childCount,
	};
}

/**
 * A window resolved by `desktop.window()` over the SDK `Window` of the same lookup; identity fields are the
 * engine's snapshot, every call goes by id.
 */
export class WindowHandle extends InputTarget {
	readonly id: string;
	readonly app: string;
	readonly title: string;
	readonly pid: number | undefined;
	readonly bounds: Bounds;
	readonly focused: boolean;
	readonly #method: FacadeMethod;
	readonly #window: SdkWindow;

	constructor(scope: RunScope, window: DesktopWindow, sdkWindow: SdkWindow) {
		super(scope, window.id, WINDOW_METHODS);
		this.#method = facadeMethod(scope, WINDOW_METHODS);
		this.#window = sdkWindow;
		this.id = window.id;
		this.app = window.app;
		this.title = window.title;
		this.pid = window.pid ?? undefined;
		this.bounds = { x: window.x, y: window.y, width: window.width, height: window.height };
		this.focused = window.focused;
	}

	raise(): Promise<void> {
		return this.#method("raise", () =>
			viaSdk("raiseWindow", async () => {
				await this.#window.raise();
			}),
		);
	}

	/** The window's native menu: `items` lists children (empty path = the menu bar), `select` invokes a leaf. */
	readonly menu = {
		items: (path?: readonly string[]): Promise<readonly MenuItem[]> =>
			this.#method("menu.items", () =>
				viaSdk("menus.items", async () => (await this.#window.menu.items(path ?? [])).map(menuItem)),
			),
		// Foreground keys the target window and needs the control grant (#9888); omitted stays background.
		select: (path: readonly string[], options?: { readonly delivery?: string }): Promise<void> =>
			this.#method("menu.select", () =>
				viaSdk("menus.select", async () => {
					// The engine validates the mode, as it did when the run facade sent the string itself.
					const delivery = options?.delivery as Delivery | undefined;
					await this.#window.menu.select(path, delivery === undefined ? undefined : { delivery });
				}),
			),
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
		return this.#method("find", (scope) =>
			viaSdk("ax.query", async () =>
				(await this.#window.find(query)).flatMap((element) =>
					element.node === null ? [] : [new ElementHandle(scope, runAxNode(element.node))],
				),
			),
		);
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
			expectResult(engineMethod, await call(engineMethod, { ref: this.ref, ...params }), isExecResult);
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

	/**
	 * Types into this element without taking the user's focus: a native text field takes the text through its own
	 * selection (`inserted`), anything else takes keys once it holds its app's keyboard focus (`keys`); keys are never sent
	 * to an element that did not take focus. Foreground delivery raises the window first and needs the control grant.
	 */
	type(text: string, options?: DeliveryOptions): Promise<AxInputResult> {
		return this.#method("type", async ({ call }) => {
			const result = await call("ax.typeText", { ref: this.ref, text, opts: pointerOptions(options) });
			return expectResult("ax.typeText", result, isAxInputResult);
		});
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
