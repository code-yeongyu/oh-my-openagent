import type { EngineMethod } from "@oh-my-opencode/senpi-desktop-protocol";
import { ComputerRunError, type FacadeMethod, facadeMethod, type MethodTiers, type RunScope } from "./context";
import type { CaptureRegion } from "./engine-results";
import { callHold } from "./hold-call";
import { captureScreenshot, type ScreenshotOptions, type ScreenshotResult } from "./screenshot";

export interface DeliveryOptions {
	/** `background` targets the window without focusing it; `foreground` briefly activates it. */
	readonly delivery?: string;
}

export interface ClickOptions extends DeliveryOptions {
	readonly button?: string;
	readonly count?: number;
	readonly modifiers?: readonly string[];
}

export interface ScrollOptions extends DeliveryOptions {
	readonly dx?: number;
	readonly dy?: number;
}

export interface HoldOptions extends DeliveryOptions {
	/** Finite seconds in 0..=100. Input is released when the call ends. */
	readonly duration: number;
}

export interface HoldMouseOptions extends HoldOptions {
	readonly button?: string;
	readonly keys?: readonly string[];
	readonly frameId?: string;
}

function validateHoldDuration(duration: number): void {
	if (!Number.isFinite(duration) || duration < 0 || duration > 100) {
		throw new ComputerRunError("assertion", "hold duration must be finite seconds in 0..=100");
	}
}

/** The engine `PointerOptions`; `undefined` fields are dropped on the wire. */
export function pointerOptions(options: ClickOptions = {}): object {
	const { button, count, modifiers, delivery } = options;
	return { button, count, modifiers, deliveryMode: delivery };
}

function chordKeys(chord: string | readonly string[]): readonly string[] {
	if (typeof chord !== "string") return chord;
	return chord
		.split("+")
		.map((key) => key.trim())
		.filter((key) => key.length > 0);
}

/** Facade `method` sending one engine request whose result carries nothing. */
export function send(method: FacadeMethod, name: string, engineMethod: EngineMethod, params: object): Promise<void> {
	return method(name, async ({ call }) => {
		await call(engineMethod, params);
	});
}

/**
 * Input helpers aimed at one engine target (`desktop` or a window id). `x`/`y` are pixels of the
 * target's latest capture; the engine owns that frame and fails `InvalidCoordinateFrame` without one.
 * The facade method seam is a true private, so run code holding a handle can call only its named
 * helpers and never send an arbitrary engine method such as `control.grant` (#9967).
 */
export class InputTarget {
	readonly #target: string;
	readonly #method: FacadeMethod;

	constructor(scope: RunScope, target: string, tiers: MethodTiers) {
		this.#target = target;
		this.#method = facadeMethod(scope, tiers);
	}

	screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
		return this.#method("screenshot", (scope) => captureScreenshot(scope, this.#target, options));
	}

	/** Recaptures native detail; zoom pixels never replace the full input frame. */
	zoom(region: CaptureRegion, options?: ScreenshotOptions): Promise<ScreenshotResult> {
		return this.#method("zoom", (scope) => captureScreenshot(scope, this.#target, options, region));
	}

	click(x: number, y: number, options?: ClickOptions): Promise<void> {
		return send(this.#method, "click", "click", { target: this.#target, x, y, opts: pointerOptions(options) });
	}

	doubleClick(x: number, y: number, options?: ClickOptions): Promise<void> {
		const opts = pointerOptions({ ...options, count: 2 });
		return send(this.#method, "doubleClick", "click", { target: this.#target, x, y, opts });
	}

	move(x: number, y: number): Promise<void> {
		return send(this.#method, "move", "moveMouse", { target: this.#target, x, y });
	}

	drag(points: readonly (readonly [number, number])[], options?: ClickOptions): Promise<void> {
		const path = points.map(([x, y]) => ({ x, y }));
		return send(this.#method, "drag", "drag", { target: this.#target, path, opts: pointerOptions(options) });
	}

	scroll(x: number, y: number, options: ScrollOptions = {}): Promise<void> {
		const { dx = 0, dy = 0 } = options;
		const params = { target: this.#target, x, y, dx, dy, opts: pointerOptions(options) };
		return send(this.#method, "scroll", "scroll", params);
	}

	type(text: string, options?: DeliveryOptions): Promise<void> {
		return send(this.#method, "type", "typeText", { target: this.#target, text, opts: pointerOptions(options) });
	}

	press(chord: string | readonly string[], options?: DeliveryOptions): Promise<void> {
		const params = { target: this.#target, keys: chordKeys(chord), opts: pointerOptions(options) };
		return send(this.#method, "press", "keyChord", params);
	}

	/** Presses in order and releases in reverse, including after interruption. */
	holdKeys(keys: readonly string[], options: HoldOptions): Promise<void> {
		return this.#method("holdKeys", async (scope) => {
			validateHoldDuration(options?.duration);
			if (!Array.isArray(keys) || keys.length === 0) {
				throw new ComputerRunError("assertion", "held keys must not be empty");
			}
			await callHold(scope, "holdKeys", {
				target: this.#target, keys, duration: options.duration, opts: pointerOptions(options),
			});
		});
	}

	/** The point is in the latest full screenshot, never a zoom's pixels. */
	holdMouse(x: number, y: number, options: HoldMouseOptions): Promise<void> {
		return this.#method("holdMouse", async (scope) => {
			validateHoldDuration(options?.duration);
			await callHold(scope, "holdMouse", {
				target: this.#target,
				x,
				y,
				duration: options.duration,
				button: options.button,
				keys: options.keys,
				frameId: options.frameId,
				opts: pointerOptions(options),
			});
		});
	}
}
