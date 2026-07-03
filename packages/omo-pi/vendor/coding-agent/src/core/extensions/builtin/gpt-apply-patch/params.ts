import type { ApplyPatchParams } from "./types.ts";

export function normalizeApplyPatchArguments(args: unknown): ApplyPatchParams {
	if (typeof args === "string") {
		return { input: args };
	}

	if (args && typeof args === "object" && "input" in args) {
		const input = args.input;
		if (typeof input === "string") {
			return { input };
		}
	}

	return { input: "" };
}
