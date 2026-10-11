/** Input delivery: `background` targets the window without focusing it; `foreground` briefly activates it. */
type ComputerDelivery = "background" | "foreground";

/** Options shared by every native input helper. */
interface ComputerDeliveryOptions {
	delivery?: ComputerDelivery;
}

/** Options for pointer clicks. */
interface ComputerClickOptions extends ComputerDeliveryOptions {
	button?: "left" | "right" | "middle";
	count?: number;
	modifiers?: string[];
}

/** Options for pointer drags. */
interface ComputerDragOptions extends ComputerDeliveryOptions {
	modifiers?: string[];
}

/** Options for wheel scrolling at the pointer position; `dx`/`dy` are pixels, the same unit on every OS, and one mouse-wheel notch is about 40 px (so `dy: 120` scrolls about three notches). The direction is semantic and the same on every OS: a positive `dy` moves the view toward the end of the content (the content moves up) and a positive `dx` toward its right edge, regardless of the user's natural-scrolling setting. */
interface ComputerScrollOptions extends ComputerDeliveryOptions {
	dx?: number;
	dy?: number;
}

/** Options for capturing a screenshot; `silent` skips the auto-displayed image. */
interface ComputerScreenshotOptions {
	silent?: boolean;
}

/** Options for an accessibility-tree snapshot. */
interface ComputerAxOptions {
	/** Include nodes that are normally pruned as non-interactive. */
	all?: boolean;
	maxDepth?: number;
}

/** Accessibility query matched against role, title, and value. */
interface ComputerAxQuery {
	role?: string;
	title?: string;
	value?: string;
	limit?: number;
}

/** Window filter matched case-insensitively against the owning app name and title. */
interface ComputerWindowFilter {
	app?: string;
	title?: string;
}

/** Rectangle in global logical desktop coordinates. */
interface ComputerBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A native menu item snapshot; selection revalidates the command before dispatch. */
interface ComputerMenuItem {
	title: string;
	path: string[];
	enabled: boolean;
	checked: boolean;
	hasSubmenu: boolean;
	shortcut?: string | null;
}

/** One capturable top-level window in global logical desktop coordinates. */
interface ComputerWindowInfo extends ComputerBounds {
	/** Opaque backend-defined id; never parse it. */
	id: string;
	app: string;
	title: string;
	pid?: number | null;
	focused: boolean;
	/** Windows only: the window belongs to an elevated process, so input into it is refused. */
	elevated?: boolean | null;
}

/** Monitor geometry in both desktop coordinates and composite screenshot pixels. */
interface ComputerDisplay extends ComputerBounds {
	id: string;
	name: string;
	scale: number;
	pixelX: number;
	pixelY: number;
	pixelWidth: number;
	pixelHeight: number;
	isPrimary: boolean;
}

/** One capture; later pointer `x`/`y` on the same target are pixels of this frame. */
interface ComputerScreenshotResult {
	target: string;
	frameId: string;
	/** Emitted image size. */
	width: number;
	height: number;
	/** Captured size before downscaling. */
	sourceWidth: number;
	sourceHeight: number;
	scale: number;
	/** Full-resolution artifact, when the engine wrote one. */
	path?: string;
}

/** Native desktop backend, permission state, and safety facts. */
interface ComputerCapabilities {
	/** Active native backend identifier. */
	backend: string;
	/** Linux display-server kind when applicable. */
	displayServer?: string | null;
	capture: boolean;
	input: boolean;
	/** Whether OS accessibility automation is available. */
	ax: boolean;
	/** Whether input can target a background window. */
	backgroundWindowInput: boolean;
	deliveryModes: string[];
	capturePermission: string;
	inputPermission: string;
	axPermission: string;
	displayCount: number;
	/** Whether foreground delivery restores the previous front window and cursor. */
	focusGuard: boolean;
	/** Live stop path: `global` (the user's stop chord), `host-relay`, or `none`; input is refused without one. */
	stopPath: string;
	/** Why the stop path is not `global`, when it is not. */
	stopReason?: string | null;
	/** Windows mandatory integrity level of the engine process. */
	integrityLevel?: string | null;
	/** Input is refused while the screen is locked. */
	screenLocked: boolean;
}

/** Live accessibility element resolved from a snapshot ref; expired refs throw `StaleRef`. */
interface ComputerElement {
	/** Snapshot ref tag, e.g. `e5`. */
	readonly ref: string;
	readonly role: string;
	readonly nativeRole: string;
	readonly title?: string;
	readonly description?: string;
	readonly enabled: boolean;
	readonly focused: boolean;
	readonly childCount: number;
	value(): Promise<string | undefined>;
	setValue(value: string): Promise<void>;
	/** Bounds in global desktop coordinates, or null when the element has none. */
	bounds(): Promise<ComputerBounds | null>;
	attributes(): Promise<Record<string, string>>;
	actions(): Promise<string[]>;
	perform(action: string): Promise<void>;
	/** Perform the element's native press action; needs no screenshot. */
	press(): Promise<void>;
	/** Click the element's center with native input. */
	click(options?: ComputerDeliveryOptions): Promise<void>;
	focus(): Promise<void>;
	parent(): Promise<ComputerElement | null>;
	children(): Promise<ComputerElement[]>;
}

/** Native input helpers shared by the desktop root and window handles; `x`/`y` are pixels in the most recent screenshot of the same target. */
interface ComputerInputTarget {
	screenshot(options?: ComputerScreenshotOptions): Promise<ComputerScreenshotResult>;
	click(x: number, y: number, options?: ComputerClickOptions): Promise<void>;
	doubleClick(x: number, y: number, options?: Omit<ComputerClickOptions, "count">): Promise<void>;
	move(x: number, y: number): Promise<void>;
	drag(points: Array<[number, number]>, options?: ComputerDragOptions): Promise<void>;
	scroll(x: number, y: number, options?: ComputerScrollOptions): Promise<void>;
	type(text: string, options?: ComputerDeliveryOptions): Promise<void>;
	/** Key chord such as `"cmd+shift+p"` or `["cmd", "shift", "p"]`. */
	press(chord: string | string[], options?: ComputerDeliveryOptions): Promise<void>;
}

/** Window handle resolved by `window`/`focusedWindow`; identity fields are a snapshot taken at resolution. */
interface ComputerWindow extends ComputerInputTarget {
	readonly id: string;
	readonly app: string;
	readonly title: string;
	readonly pid?: number;
	readonly bounds: ComputerBounds;
	readonly focused: boolean;
	raise(): Promise<void>;
	readonly menu: {
		/** Inspect a menu path without activating the application (empty path = the menu bar). */
		items(path?: string[]): Promise<ComputerMenuItem[]>;
		/** Select one unambiguous enabled leaf command using the window's native menu context. */
		select(path: string[]): Promise<void>;
	};
	/** Formatted accessibility tree as one string, one node per line with `[ref=eN]` tags. */
	ax(options?: ComputerAxOptions): Promise<string>;
	find(query: ComputerAxQuery): Promise<ComputerElement[]>;
	ref(ref: string): Promise<ComputerElement | null>;
}

/** Desktop helpers shared by the direct `computer` facade and the `desktop` object inside `computer.run`. */
interface ComputerDesktop extends ComputerInputTarget {
	displays(): Promise<ComputerDisplay[]>;
	windows(filter?: ComputerWindowFilter): Promise<ComputerWindowInfo[]>;
	/** Resolve exactly one window by opaque id or filter; ambiguous filters throw listing candidates. */
	window(selector: string | ComputerWindowFilter): Promise<ComputerWindow>;
	focusedWindow(): Promise<ComputerWindow | null>;
	/** Element under a global desktop coordinate. */
	elementAt(x: number, y: number): Promise<ComputerElement | null>;
	focusedElement(): Promise<ComputerElement | null>;
	ref(ref: string): Promise<ComputerElement | null>;
	readonly clipboard: {
		read(): Promise<string>;
		write(text: string): Promise<void>;
	};
	readonly control: {
		/** Ask the human for the foreground-control grant; returns `{ active }` (false when headless or refused). */
		acquire(options: { reason: string }): Promise<ComputerControlState>;
		/** Release the foreground-control grant; belongs in `finally`. */
		release(): Promise<void>;
		/** Read the foreground-control grant state. */
		state(): Promise<ComputerControlState>;
	};
	/** Native backend capabilities, permission state, stop path, and focus guard. */
	capabilities(): Promise<ComputerCapabilities>;
}

/** The foreground-control grant state (#9651). */
interface ComputerControlState {
	active: boolean;
	reason?: string | null;
	grantedAt?: string | null;
}

/** Scope object passed as the first argument to a computer run function. */
interface ComputerRunScope {
	/** Persistent host-desktop facade with the same helpers as `computer`. */
	readonly desktop: ComputerDesktop;
	/** Sleep for milliseconds or poll a predicate until truthy. */
	readonly wait: (
		msOrPredicate: number | (() => unknown),
		options?: {
			/** Maximum polling time in milliseconds. */
			timeout?: number;
			/** Delay between predicate calls in milliseconds. */
			interval?: number;
		},
	) => Promise<unknown>;
	/** Throw with `message` when `condition` is falsy. */
	readonly assert: (condition: unknown, message?: string) => void;
}

/** Arguments and policy for code executed by `computer.run`. */
interface ComputerRunOptions {
	/** Positional arguments passed after the run-scope object: JSON data, functions, or RegExp values. */
	args?: unknown[];
	/** Allow desktop inspection while blocking desktop-facade input and mutation. */
	read_only?: boolean;
	/** Execution timeout in seconds. */
	timeout?: number;
}

/**
 * Session-scoped host-computer facade in JavaScript eval while the `computer` tool is active. Every helper is one
 * `tool.computer(...)` call, so it passes the same permission check as a direct tool call.
 */
declare const computer: ComputerDesktop & {
	/** Run a serialized function in the persistent computer runtime for multi-step sequences. */
	run<R>(
		fn: (scope: ComputerRunScope, ...args: unknown[]) => R | Promise<R>,
		options?: ComputerRunOptions,
	): Promise<Awaited<R>>;
	/** Run a JavaScript function body in the persistent computer runtime. */
	run<R = unknown>(code: string, options?: ComputerRunOptions): Promise<R>;
	/** End the persistent desktop session; later calls fail. */
	close(): Promise<void>;
};
