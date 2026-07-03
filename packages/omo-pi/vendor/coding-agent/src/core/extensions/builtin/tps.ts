import type { ExtensionAPI } from "../types.ts";

type AssistantMessageLike = {
	role: "assistant";
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
	};
};

function isAssistantMessage(message: unknown): message is AssistantMessageLike {
	if (!message || typeof message !== "object") return false;
	const role = (message as { role?: unknown }).role;
	return role === "assistant";
}

export default function (pi: ExtensionAPI) {
	let activeAssistantStartMs: number | null = null;
	let assistantElapsedMs = 0;

	const finishActiveAssistantTiming = () => {
		if (activeAssistantStartMs === null) return;

		const elapsedMs = Date.now() - activeAssistantStartMs;
		if (elapsedMs > 0) {
			assistantElapsedMs += elapsedMs;
		}
		activeAssistantStartMs = null;
	};

	pi.on("agent_start", () => {
		activeAssistantStartMs = null;
		assistantElapsedMs = 0;
	});

	pi.on("message_start", (event) => {
		if (!isAssistantMessage(event.message)) return;

		finishActiveAssistantTiming();
		activeAssistantStartMs = Date.now();
	});

	pi.on("message_end", (event) => {
		if (!isAssistantMessage(event.message)) return;

		finishActiveAssistantTiming();
	});

	pi.on("agent_end", (event, ctx) => {
		finishActiveAssistantTiming();

		const elapsedMs = assistantElapsedMs;
		activeAssistantStartMs = null;
		assistantElapsedMs = 0;

		if (!ctx.hasUI) return;
		if (elapsedMs <= 0) return;

		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		let totalTokens = 0;

		for (const message of event.messages) {
			if (!isAssistantMessage(message)) continue;
			input += message.usage?.input ?? 0;
			output += message.usage?.output ?? 0;
			cacheRead += message.usage?.cacheRead ?? 0;
			cacheWrite += message.usage?.cacheWrite ?? 0;
			totalTokens += message.usage?.totalTokens ?? 0;
		}

		if (output <= 0) return;

		const elapsedSeconds = elapsedMs / 1000;
		const tokensPerSecond = output / elapsedSeconds;
		const message = `TPS ${tokensPerSecond.toFixed(1)} tok/s. out ${output.toLocaleString()}, in ${input.toLocaleString()}, cache r/w ${cacheRead.toLocaleString()}/${cacheWrite.toLocaleString()}, total ${totalTokens.toLocaleString()}, ${elapsedSeconds.toFixed(1)}s`;
		ctx.ui.notify(message, "info");
	});
}
