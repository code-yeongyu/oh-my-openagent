import type { Message } from "./engine";
import { WINDOW } from "./error-code-cases";

/**
 * Every pointer, keyboard, window, and AX input method with parseable params. `clipboard.write` is absent:
 * the engine answers it `Internal` until the clipboard lands with the backends.
 */
export const INPUT_CALLS: ReadonlyArray<readonly [string, Message]> = [
	["click", { target: "desktop", x: 10, y: 10 }],
	["moveMouse", { target: "desktop", x: 10, y: 10 }],
	[
		"drag",
		{
			target: "desktop",
			path: [
				{ x: 1, y: 1 },
				{ x: 5, y: 5 },
			],
		},
	],
	["scroll", { target: "desktop", x: 10, y: 10, dx: 0, dy: 3 }],
	["typeText", { target: WINDOW, text: "hi" }],
	["keyChord", { target: WINDOW, keys: ["ctrl", "a"] }],
	["raiseWindow", { windowId: WINDOW }],
	["ax.perform", { ref: "e1", action: "press" }],
	["ax.setValue", { ref: "e1", value: "hi" }],
	["ax.focus", { ref: "e1" }],
	["ax.click", { ref: "e1" }],
	["ax.typeText", { ref: "e1", text: "hi" }],
];
