import type { SessionStats } from "../../core/agent-session.ts";
import { theme } from "./theme/theme.ts";

const money = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

const UNKNOWN = "—";

export function formatSessionInfo(stats: SessionStats, sessionName?: string): string {
	let info = `${theme.bold("Session Info")}\n\n`;
	if (sessionName) {
		info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
	}
	info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
	info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;

	info += `${theme.bold("Messages")}\n`;
	info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
	info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
	info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
	info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
	info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;

	info += `${theme.bold("Tokens")}\n`;
	info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
	info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
	if (stats.tokens.cacheRead > 0) {
		info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
	}
	if (stats.tokens.cacheWrite > 0) {
		info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
	}
	info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

	const contextUsage = stats.contextUsage;
	if (contextUsage && contextUsage.contextWindow > 0) {
		const usedTokens = typeof contextUsage.tokens === "number" ? contextUsage.tokens.toLocaleString() : UNKNOWN;
		const totalWindow = contextUsage.contextWindow.toLocaleString();
		const percent = typeof contextUsage.percent === "number" ? `${Math.round(contextUsage.percent)}%` : UNKNOWN;
		info += `\n${theme.bold("Context Window")}\n`;
		info += `${theme.fg("dim", "Used:")} ${usedTokens} / ${totalWindow} (${percent})`;
	}

	if (stats.cost > 0) {
		info += `\n\n${theme.bold("Cost")}\n`;
		info += `${theme.fg("dim", "Total:")} ${money.format(stats.cost)}`;
	}

	return info;
}
