import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { actionBranches, argumentsError } from "./action-schema";

// gajae-code's `computer` action set (OpenAI computer-use snake_case), one action or a `batch` of them.
const Button = Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")]);
const shared = {
	timeout: Type.Optional(
		Type.Number({ exclusiveMinimum: 0, description: "Maximum time in seconds for this action." }),
	),
	include_screenshot: Type.Optional(Type.Boolean({ description: "Capture a screenshot after the action." })),
};
const point = { x: Type.Number(), y: Type.Number() };
const strict = { additionalProperties: false } as const;

/** Each action's exact shape; `execute` checks every call (and every batch item) against these. */
export const SingleActionBranches = [
	Type.Object({ action: Type.Literal("screenshot"), ...shared }, strict),
	Type.Object({ action: Type.Literal("click"), ...point, button: Type.Optional(Button), ...shared }, strict),
	Type.Object({ action: Type.Literal("double_click"), ...point, button: Type.Optional(Button), ...shared }, strict),
	Type.Object({ action: Type.Literal("move"), ...point, button: Type.Optional(Button), ...shared }, strict),
	Type.Object(
		{
			action: Type.Literal("drag"),
			...point,
			to_x: Type.Number(),
			to_y: Type.Number(),
			button: Type.Optional(Button),
			...shared,
		},
		strict,
	),
	Type.Object(
		{ action: Type.Literal("scroll"), ...point, scroll_x: Type.Number(), scroll_y: Type.Number(), ...shared },
		strict,
	),
	Type.Object({ action: Type.Literal("type"), text: Type.String(), ...shared }, strict),
	Type.Object(
		{ action: Type.Literal("keypress"), keys: Type.Array(Type.String(), { minItems: 1 }), ...shared },
		strict,
	),
	Type.Object({ action: Type.Literal("wait"), ms: Type.Integer({ minimum: 0 }), ...shared }, strict),
] as const;

const SingleAction = Type.Union([...SingleActionBranches]);

export const BatchShape = Type.Object(
	{ action: Type.Literal("batch"), actions: Type.Array(SingleAction, { minItems: 1 }), ...shared },
	strict,
);

export const ComputerActionsShape = Type.Union([SingleAction, BatchShape]);

const ACTION_NAMES = ["screenshot", "click", "double_click", "move", "drag", "scroll", "type", "keypress", "wait"] as const;

/** The flat fields of one action as published: every field optional, each description naming its actions. */
const flatActionFields = {
	x: Type.Optional(Type.Number({ description: "click, double_click, move, drag (start), scroll (required): x pixel" })),
	y: Type.Optional(Type.Number({ description: "click, double_click, move, drag (start), scroll (required): y pixel" })),
	button: Type.Optional(
		Type.Enum(["left", "right", "middle"], { type: "string", description: "click, double_click, move, drag: mouse button (default left)" }),
	),
	to_x: Type.Optional(Type.Number({ description: "drag (required): end x pixel" })),
	to_y: Type.Optional(Type.Number({ description: "drag (required): end y pixel" })),
	scroll_x: Type.Optional(Type.Number({ description: "scroll (required): horizontal scroll distance in pixels on every OS (one wheel notch is about 40 px); positive scrolls right" })),
	scroll_y: Type.Optional(Type.Number({ description: "scroll (required): vertical scroll distance in pixels on every OS (one wheel notch is about 40 px); positive moves the view toward the end of the content (down)" })),
	text: Type.Optional(Type.String({ description: "type (required): text to type" })),
	keys: Type.Optional(Type.Array(Type.String(), { minItems: 1, description: "keypress (required): keys pressed together" })),
	ms: Type.Optional(Type.Integer({ minimum: 0, description: "wait (required): milliseconds" })),
	...shared,
};

/**
 * The published `computer_actions` parameters: one root object (providers reject a root union). `action` is
 * one action or `batch`; `actions` (batch only) lists single actions with the same flat fields.
 */
export const ComputerActionsParams = Type.Object(
	{
		action: Type.Enum([...ACTION_NAMES, "batch"], {
			type: "string",
			description: "The action to perform, or batch to run `actions` in order",
		}),
		actions: Type.Optional(
			Type.Array(
				Type.Object(
					{ action: Type.Enum([...ACTION_NAMES], { type: "string", description: "The action to perform" }), ...flatActionFields },
					strict,
				),
				{ minItems: 1, description: "batch (required): actions to execute in order" },
			),
		),
		...flatActionFields,
	},
	strict,
);

export type ComputerAction = Static<typeof SingleAction>;
export type ComputerActionsInput = Static<typeof ComputerActionsShape>;

const SINGLE_BRANCHES = actionBranches(SingleActionBranches);
const TOP_BRANCHES = actionBranches([...SingleActionBranches, BatchShape]);

/** The flat published arguments narrowed to one action (or a batch of exact actions); `ComputerArgumentsError` otherwise. */
export function parseComputerActions(input: unknown): ComputerActionsInput {
	if (Check(ComputerActionsShape, input)) return input;
	const items = typeof input === "object" && input !== null ? Reflect.get(input, "actions") : undefined;
	if (Reflect.get(input ?? {}, "action") === "batch" && Array.isArray(items)) {
		const bad = items.findIndex((item) => !Check(SingleAction, item));
		if (bad >= 0) throw argumentsError(SINGLE_BRANCHES, items[bad], `computer_actions actions[${bad}]`);
	}
	throw argumentsError(TOP_BRANCHES, input, "computer_actions");
}

export interface ScreenshotBounds {
	readonly width: number;
	readonly height: number;
}

export function actionsOf(input: ComputerActionsInput): readonly ComputerAction[] {
	return input.action === "batch" ? input.actions : [input];
}

const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(["screenshot", "wait"]);

/** Malformed input is never read-only. */
export function isReadOnlyActions(input: Readonly<Record<string, unknown>>): boolean {
	const actions = input.action === "batch" ? input.actions : [input];
	return (
		Array.isArray(actions) &&
		actions.length > 0 &&
		actions.every(
			(action) =>
				typeof action === "object" &&
				action !== null &&
				READ_ONLY_ACTIONS.has(String(Reflect.get(action, "action"))),
		)
	);
}

/**
 * The `computer` run body that executes `actions` in order through the `desktop` facade and halts at the
 * first failure. Pointer coordinates are checked against the latest screenshot before any input, and an
 * in-batch screenshot becomes the frame for the actions after it. It returns
 * `{ steps, bounds, failedIndex }`; every step records its index, action, and outcome.
 */
export function actionsScript(actions: readonly ComputerAction[], bounds: ScreenshotBounds | null): string {
	return `const actions = ${JSON.stringify(actions)};
let bounds = ${JSON.stringify(bounds)};
const steps = [];
const outside = (x, y) => bounds !== null && (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height);
const shoot = async () => { const shot = await desktop.screenshot(); bounds = { width: shot.width, height: shot.height }; };
for (const [index, a] of actions.entries()) {
	const points = a.action === "drag" ? [[a.x, a.y], [a.to_x, a.to_y]] : "x" in a ? [[a.x, a.y]] : [];
	const off = points.find(([x, y]) => outside(x, y));
	if (off !== undefined) {
		const message = a.action + " coordinates (" + off[0] + "," + off[1] + ") are outside the latest screenshot bounds " + bounds.width + "x" + bounds.height + ".";
		steps.push({ index, action: a.action, status: "error", code: "COMPUTER_COORD_INVALID", message });
		return { steps, bounds, failedIndex: index };
	}
	try {
		const button = a.button === undefined ? {} : { button: a.button };
		switch (a.action) {
			case "screenshot": await shoot(); break;
			case "click": await desktop.click(a.x, a.y, button); break;
			case "double_click": await desktop.doubleClick(a.x, a.y, button); break;
			case "move": await desktop.move(a.x, a.y); break;
			case "drag": await desktop.drag([[a.x, a.y], [a.to_x, a.to_y]], button); break;
			case "scroll": await desktop.scroll(a.x, a.y, { dx: a.scroll_x, dy: a.scroll_y }); break;
			case "type": await desktop.type(a.text); break;
			case "keypress": await desktop.press(a.keys); break;
			case "wait": await wait(a.ms); break;
		}
		if (a.include_screenshot === true && a.action !== "screenshot") await shoot();
		steps.push({ index, action: a.action, status: "success" });
	} catch (error) {
		const code = error?.data?.code ?? error?.reason ?? error?.name ?? "Error";
		steps.push({ index, action: a.action, status: "error", code, message: String(error?.message ?? error), permission: error?.data?.permission });
		return { steps, bounds, failedIndex: index };
	}
}
return { steps, bounds, failedIndex: null };`;
}
