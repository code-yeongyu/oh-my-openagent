import type { ComputerToolResult } from "./tool";

export interface EscapeStopGate {
	readonly signal: AbortSignal;
	admit(): Promise<boolean>;
}

function stopped(): ComputerToolResult {
	return {
		isError: true,
		content: [{ type: "text", text: "Computer use is escape-stopped. Wait for the user's next message before trying again." }],
		details: { isError: true },
	};
}

/** Refuse before activation; keep the admitted generation even if a new user message starts. */
export async function withEscapeAdmission(
	gate: EscapeStopGate | undefined,
	signal: AbortSignal | undefined,
	action: (signal: AbortSignal | undefined) => Promise<ComputerToolResult>,
): Promise<ComputerToolResult> {
	if (gate === undefined) return action(signal);
	if (!(await gate.admit())) return stopped();
	const escape = gate.signal;
	const combined = signal === undefined ? escape : AbortSignal.any([signal, escape]);
	try {
		const result = await action(combined);
		return escape.aborted ? stopped() : result;
	} catch (error) {
		// The native counter is the backstop if its notification was missed.
		await gate.admit();
		if (escape.aborted) return stopped();
		throw error;
	}
}
