import { type Static, Type } from "typebox";
import { Check, Errors } from "typebox/value";
import { defaultStopHotkey, isSupportedHost } from "./host-policy";

/**
 * The `computer` block of coding-agent's `settings.json` (AD-1: codemode declares none of it). Every key is
 * optional; `resolveComputerSettings` fills the defaults. `enabled` and `stopHotkey` default per host.
 */
export const ComputerSettingsSchema = Type.Object(
	{
		enabled: Type.Optional(Type.Boolean({ description: "Register the computer tool (default: host supported)" })),
		display: Type.Optional(Type.String({ description: "`all` composites every display; otherwise a display id" })),
		maxWidth: Type.Optional(Type.Integer({ minimum: 1, default: 3840 })),
		maxHeight: Type.Optional(Type.Integer({ minimum: 1, default: 2400 })),
		screenshotMaxBytes: Type.Optional(Type.Integer({ minimum: 1, default: 5_000_000 })),
		stopHotkey: Type.Optional(Type.String({ minLength: 1, description: "Stop chord, e.g. ctrl+alt+shift+escape" })),
		allowHostRelayOnlyStop: Type.Optional(Type.Boolean({ default: false })),
		macosCanary: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("off")], { default: "session" })),
		auditLog: Type.Optional(
			Type.Object({ enabled: Type.Optional(Type.Boolean({ default: true })) }, { additionalProperties: false }),
		),
		screenshotGc: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(Type.Boolean({ default: true })),
					staleMs: Type.Optional(Type.Integer({ minimum: 0, default: 43_200_000 })),
					scanIntervalMs: Type.Optional(Type.Integer({ minimum: 0, default: 1_800_000 })),
				},
				{ additionalProperties: false },
			),
		),
		enginePath: Type.Optional(Type.String({ minLength: 1, description: "Override the located engine binary" })),
		cuaAdapter: Type.Optional(
			Type.Boolean({ default: false, description: "Also register computer_actions (OpenAI computer-use actions)" }),
		),
	},
	{ additionalProperties: false },
);

export type ComputerSettingsInput = Static<typeof ComputerSettingsSchema>;

/** Fully resolved `computer.*` settings. */
export interface ComputerSettings {
	readonly enabled: boolean;
	readonly display: string;
	readonly maxWidth: number;
	readonly maxHeight: number;
	readonly screenshotMaxBytes: number;
	readonly stopHotkey: string;
	readonly allowHostRelayOnlyStop: boolean;
	readonly macosCanary: "session" | "off";
	readonly auditLog: { readonly enabled: boolean };
	readonly screenshotGc: { readonly enabled: boolean; readonly staleMs: number; readonly scanIntervalMs: number };
	readonly enginePath: string | undefined;
	readonly cuaAdapter: boolean;
}

/** A `computer` settings block that does not match `ComputerSettingsSchema`. */
export class ComputerSettingsError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(`invalid computer settings: ${issues.join("; ")}`);
		this.name = "ComputerSettingsError";
		this.issues = issues;
	}
}

/** Parses the raw `computer` settings value (`undefined` when absent) and fills the per-host defaults. */
export function resolveComputerSettings(raw: unknown, platform: string = process.platform): ComputerSettings {
	const value = raw ?? {};
	if (!Check(ComputerSettingsSchema, value)) {
		const issues = Errors(ComputerSettingsSchema, value).map(
			(error) => `${error.instancePath || "computer"}: ${error.message}`,
		);
		throw new ComputerSettingsError(issues);
	}
	return {
		enabled: value.enabled ?? isSupportedHost(platform),
		display: value.display ?? "all",
		maxWidth: value.maxWidth ?? 3840,
		maxHeight: value.maxHeight ?? 2400,
		screenshotMaxBytes: value.screenshotMaxBytes ?? 5_000_000,
		stopHotkey: value.stopHotkey ?? defaultStopHotkey(platform),
		allowHostRelayOnlyStop: value.allowHostRelayOnlyStop ?? false,
		macosCanary: value.macosCanary ?? "session",
		auditLog: { enabled: value.auditLog?.enabled ?? true },
		screenshotGc: {
			enabled: value.screenshotGc?.enabled ?? true,
			staleMs: value.screenshotGc?.staleMs ?? 43_200_000,
			scanIntervalMs: value.screenshotGc?.scanIntervalMs ?? 1_800_000,
		},
		enginePath: value.enginePath,
		cuaAdapter: value.cuaAdapter ?? false,
	};
}
