import { type Static, Type } from "typebox";

/** Default and maximum budget of one `call` or `run`, in seconds. */
export const DEFAULT_TIMEOUT_SECONDS = 60;
export const MAX_TIMEOUT_SECONDS = 600;

const CallStep = Type.Object(
	{
		method: Type.String({ description: "desktop helper name, e.g. screenshot, window, click, clipboard.read" }),
		args: Type.Optional(Type.Array(Type.Unknown(), { description: "positional helper arguments" })),
	},
	{ additionalProperties: false },
);

const RunTimeout = Type.Number({
	minimum: 1,
	maximum: MAX_TIMEOUT_SECONDS,
	description: `run: budget in seconds (default ${DEFAULT_TIMEOUT_SECONDS})`,
});

/**
 * Each `computer` action's exact shape (oh-my-pi `ComputerParams` minus `fn`/`args`: the prelude serializes
 * functions into `code`). There is deliberately no `resume`: only the user resumes, through `/computer resume`.
 * `execute` checks calls against these; the model sees the flat {@link ComputerParams}.
 */
export const ComputerActionBranches = [
	Type.Object(
		{
			action: Type.Literal("call"),
			chain: Type.Array(CallStep, {
				description: "one desktop helper call, optionally followed by one call on the window/element it returns",
			}),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("run"),
			code: Type.String({
				description:
					"JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; `return` sets the value",
			}),
			read_only: Type.Optional(
				Type.Boolean({ description: "true = inspection only: screenshots and AX reads, input/mutation blocked" }),
			),
			timeout: Type.Optional(RunTimeout),
		},
		{ additionalProperties: false },
	),
	Type.Object({ action: Type.Literal("capabilities") }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("close") }, { additionalProperties: false }),
] as const;

export const ComputerActionShape = Type.Union([...ComputerActionBranches]);

export type ComputerToolParams = Static<typeof ComputerActionShape>;

/**
 * The published `computer` parameters: one root object (providers reject a root union), the `action` enum,
 * and every action's fields as optional, each description naming the action it belongs to.
 */
export const ComputerParams = Type.Object(
	{
		action: Type.Enum(["call", "run", "capabilities", "close"], {
			type: "string",
			description: "call: one desktop helper chain; run: a JavaScript body; capabilities: host report; close: end the session",
		}),
		chain: Type.Optional(
			Type.Array(CallStep, {
				description:
					"call (required): one desktop helper call, optionally followed by one call on the window/element it returns",
			}),
		),
		code: Type.Optional(
			Type.String({
				description:
					"run (required): JavaScript async function body; `desktop`, `wait`, `assert`, `tool` in scope; `return` sets the value",
			}),
		),
		read_only: Type.Optional(
			Type.Boolean({ description: "run: true = inspection only: screenshots and AX reads, input/mutation blocked" }),
		),
		timeout: Type.Optional(RunTimeout),
	},
	{ additionalProperties: false },
);
