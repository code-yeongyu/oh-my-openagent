import { AxElement } from "./element";
import type { Element, Menus, Window } from "./facade";
import type { Link } from "./link";
import { CaptureTarget } from "./target";
import type {
	ActionOptions,
	ActionReport,
	AxQuery,
	Bounds,
	MenuItem,
	Ref,
	WindowIdentity,
	WindowSummary,
} from "./types";
import { parseAxNode, parseList, parseMenuItem } from "./validate";

class WindowMenus implements Menus {
	readonly #link: Link;
	readonly #windowId: string;

	constructor(link: Link, windowId: string) {
		this.#link = link;
		this.#windowId = windowId;
	}

	items(path: readonly string[] = []): Promise<readonly MenuItem[]> {
		return this.#link.read("menus.items", { windowId: this.#windowId, path: [...path] }, (value) =>
			parseList(value, parseMenuItem),
		);
	}

	select(path: readonly string[], options?: ActionOptions): Promise<ActionReport> {
		const params = {
			windowId: this.#windowId,
			path: [...path],
			...(options?.delivery === undefined ? {} : { deliveryMode: options.delivery }),
		};
		return this.#link.act("menus.select", params, options?.verify);
	}
}

export class DesktopWindow extends CaptureTarget implements Window {
	declare readonly kind: "window";
	readonly id: string;
	readonly identity: WindowIdentity | null;
	readonly app: string;
	readonly title: string;
	readonly pid: number | null;
	readonly bounds: Bounds;
	readonly focused: boolean;
	readonly menu: Menus;

	constructor(link: Link, summary: WindowSummary) {
		super(link, "window", summary.id);
		this.id = summary.id;
		this.identity = summary.identity;
		this.app = summary.app;
		this.title = summary.title;
		this.pid = summary.pid;
		this.bounds = summary.bounds;
		this.focused = summary.focused;
		this.menu = new WindowMenus(link, summary.id);
	}

	raise(options?: ActionOptions): Promise<ActionReport> {
		return this.link.act("raiseWindow", { windowId: this.id }, options?.verify);
	}

	element(ref: Ref): Element {
		return new AxElement(this.link, this.id, ref, null);
	}

	async find(query: AxQuery): Promise<readonly Element[]> {
		const nodes = await this.link.read("ax.query", { target: this.id, query }, (value) => parseList(value, parseAxNode));
		return nodes.map((node) => new AxElement(this.link, this.id, node.ref, node));
	}
}
