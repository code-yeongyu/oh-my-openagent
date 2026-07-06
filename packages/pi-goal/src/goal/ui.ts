import type { ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { formatGoalElapsedSeconds, formatTokensCompact } from "./format.js";
import type { Goal, GoalStatus } from "./types.js";
import { isRecord } from "./types.js";

export const STATUS_KEY = "goal";
const LEGACY_WIDGET_KEY = "goal";
let goalFooterInstalled = false;

type GoalFooterIndicator = {
	text: string;
	color: ThemeColor;
};

type FooterTokenStats = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costTotal: number;
};

type FooterAssistantMessage = {
	role: "assistant";
	usage: Record<string, unknown>;
};

export function updateGoalUi(ctx: ExtensionContext, goal: Goal | null): void {
	if (!ctx.hasUI) return;

	ctx.ui.setWidget(LEGACY_WIDGET_KEY, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);

	if (!goal) {
		if (goalFooterInstalled) {
			ctx.ui.setFooter(undefined);
			goalFooterInstalled = false;
		}
		return;
	}

	goalFooterInstalled = true;
	ctx.ui.setFooter((_tui, theme, footerData) => new GoalFooterComponent(ctx, footerData, theme, goal));
}

export function goalFooterIndicator(goal: Goal): GoalFooterIndicator {
	const usageText = goalStatusUsage(goal);
	const color = goalStatusColor(goal.status);
	switch (goal.status) {
		case "active":
			return { color, text: usageText === null ? "Pursuing goal" : `Pursuing goal (${usageText})` };
		case "paused":
			return { color, text: "Goal paused (/goal resume)" };
		case "budgetLimited":
			return { color, text: usageText === null ? "Goal abandoned" : `Goal unmet (${usageText})` };
		case "complete":
			return { color, text: usageText === null ? "Goal achieved" : `Goal achieved (${usageText})` };
	}
}

export function composeFooterStatusLine(leftText: string, rightText: string, width: number): string {
	if (width <= 0) return "";

	const sanitizedLeftText = sanitizeStatusText(leftText);
	const rightTextWidth = visibleWidth(rightText);
	if (sanitizedLeftText.length === 0) {
		return rightAlignFooterText(rightText, width, rightTextWidth);
	}

	const leftTextWidth = visibleWidth(sanitizedLeftText);
	if (leftTextWidth + 2 + rightTextWidth <= width) {
		return `${sanitizedLeftText}${" ".repeat(width - leftTextWidth - rightTextWidth)}${rightText}`;
	}

	if (rightTextWidth <= width) {
		return rightAlignFooterText(rightText, width, rightTextWidth);
	}

	return truncateToWidth(rightText, width, "");
}

class GoalFooterComponent implements Component {
	private readonly observedAtMilliseconds = Date.now();

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly theme: Theme,
		private readonly goal: Goal,
	) {}

	render(width: number): string[] {
		const goal = this.renderedGoal();
		return [this.workingDirectoryLine(width), this.statsLine(width), this.goalStatusLine(goal, width)];
	}

	invalidate(): void {}

	private renderedGoal(): Goal {
		if (this.goal.status !== "active" || this.ctx.isIdle()) return this.goal;
		const elapsedSeconds = Math.max(0, Math.round((Date.now() - this.observedAtMilliseconds) / 1000));
		return { ...this.goal, timeUsedSeconds: this.goal.timeUsedSeconds + elapsedSeconds };
	}

	private workingDirectoryLine(width: number): string {
		let workingDirectory = this.ctx.sessionManager.getCwd();
		const homeDirectory = process.env["HOME"] ?? process.env["USERPROFILE"];
		if (homeDirectory !== undefined && workingDirectory.startsWith(homeDirectory)) {
			workingDirectory = `~${workingDirectory.slice(homeDirectory.length)}`;
		}

		const branch = this.footerData.getGitBranch();
		if (branch !== null) {
			workingDirectory = `${workingDirectory} (${branch})`;
		}

		const sessionName = this.ctx.sessionManager.getSessionName();
		if (sessionName !== undefined) {
			workingDirectory = `${workingDirectory} • ${sessionName}`;
		}

		return truncateToWidth(this.theme.fg("dim", workingDirectory), width, this.theme.fg("dim", "..."));
	}

	private statsLine(width: number): string {
		const tokenStats = collectFooterTokenStats(this.ctx);
		const statsParts = footerStatsParts(this.ctx, tokenStats, this.theme);
		let statsLeft = statsParts.join(" ");
		let statsLeftWidth = visibleWidth(statsLeft);
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		const rightSide = footerRightSide(this.ctx, this.footerData);
		const rightSideWidth = visibleWidth(rightSide);
		const minimumPadding = 2;
		const totalNeededWidth = statsLeftWidth + minimumPadding + rightSideWidth;
		const statsLine =
			totalNeededWidth <= width
				? `${statsLeft}${" ".repeat(width - statsLeftWidth - rightSideWidth)}${rightSide}`
				: compactStatsLine(statsLeft, statsLeftWidth, rightSide, width);

		const dimStatsLeft = this.theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length);
		return `${dimStatsLeft}${this.theme.fg("dim", remainder)}`;
	}

	private goalStatusLine(goal: Goal, width: number): string {
		const indicator = goalFooterIndicator(goal);
		const rightText = this.theme.fg(indicator.color, indicator.text);
		const leftText = Array.from(this.footerData.getExtensionStatuses().entries())
			.filter(([key]) => key !== STATUS_KEY)
			.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
			.map(([, text]) => text)
			.join(" ");

		return truncateToWidth(composeFooterStatusLine(leftText, rightText, width), width, this.theme.fg("dim", "..."));
	}
}

function goalStatusUsage(goal: Goal): string | null {
	switch (goal.status) {
		case "active":
			return goal.tokenBudget === undefined
				? formatGoalElapsedSeconds(goal.timeUsedSeconds)
				: `${formatTokensCompact(goal.tokensUsed)} / ${formatTokensCompact(goal.tokenBudget)}`;
		case "paused":
			return null;
		case "budgetLimited":
			return goal.tokenBudget === undefined
				? null
				: `${formatTokensCompact(goal.tokensUsed)} / ${formatTokensCompact(goal.tokenBudget)} tokens`;
		case "complete":
			return goal.tokenBudget === undefined
				? formatGoalElapsedSeconds(goal.timeUsedSeconds)
				: `${formatTokensCompact(goal.tokensUsed)} tokens`;
	}
}

function goalStatusColor(status: GoalStatus): ThemeColor {
	switch (status) {
		case "active":
			return "accent";
		case "paused":
			return "muted";
		case "budgetLimited":
			return "warning";
		case "complete":
			return "success";
	}
}

function rightAlignFooterText(text: string, width: number, textWidth: number): string {
	if (textWidth >= width) return truncateToWidth(text, width, "");
	return `${" ".repeat(width - textWidth)}${text}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function collectFooterTokenStats(ctx: ExtensionContext): FooterTokenStats {
	const stats: FooterTokenStats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		costTotal: 0,
	};

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || !isFooterAssistantMessage(entry.message)) continue;
		stats.input += numericUsageField(entry.message.usage, "input");
		stats.output += numericUsageField(entry.message.usage, "output");
		stats.cacheRead += numericUsageField(entry.message.usage, "cacheRead");
		stats.cacheWrite += numericUsageField(entry.message.usage, "cacheWrite");
		stats.costTotal += nestedNumericUsageField(entry.message.usage, "cost", "total");
	}

	return stats;
}

function isFooterAssistantMessage(message: unknown): message is FooterAssistantMessage {
	return isRecord(message) && message["role"] === "assistant" && isRecord(message["usage"]);
}

function footerStatsParts(ctx: ExtensionContext, tokenStats: FooterTokenStats, theme: Theme): string[] {
	const parts: string[] = [];
	if (tokenStats.input !== 0) parts.push(`↑${formatFooterTokens(tokenStats.input)}`);
	if (tokenStats.output !== 0) parts.push(`↓${formatFooterTokens(tokenStats.output)}`);
	if (tokenStats.cacheRead !== 0) parts.push(`R${formatFooterTokens(tokenStats.cacheRead)}`);
	if (tokenStats.cacheWrite !== 0) parts.push(`W${formatFooterTokens(tokenStats.cacheWrite)}`);

	const usingSubscription = ctx.model === undefined ? false : ctx.modelRegistry.isUsingOAuth(ctx.model);
	if (tokenStats.costTotal !== 0 || usingSubscription) {
		parts.push(`$${tokenStats.costTotal.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	parts.push(contextUsageText(ctx, theme));
	return parts;
}

function contextUsageText(ctx: ExtensionContext, theme: Theme): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = usage?.percent ?? 0;
	const autoIndicator = " (auto)";
	const contextPercentDisplay =
		usage?.percent === null || usage?.percent === undefined
			? `?/${formatFooterTokens(contextWindow)}${autoIndicator}`
			: `${usage.percent.toFixed(1)}%/${formatFooterTokens(contextWindow)}${autoIndicator}`;

	if (contextPercentValue > 90) return theme.fg("error", contextPercentDisplay);
	if (contextPercentValue > 70) return theme.fg("warning", contextPercentDisplay);
	return contextPercentDisplay;
}

function footerRightSide(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): string {
	const model = ctx.model;
	const modelName = model?.id ?? "no-model";
	const thinkingLevel = currentThinkingLevel(ctx) ?? "off";
	const rightSideWithoutProvider =
		model?.reasoning !== true
			? modelName
			: thinkingLevel === "off"
				? `${modelName} • thinking off`
				: `${modelName} • ${thinkingLevel}`;

	if (model === undefined || footerData.getAvailableProviderCount() <= 1) return rightSideWithoutProvider;

	const rightSideWithProvider = `(${model.provider}) ${rightSideWithoutProvider}`;
	return rightSideWithProvider;
}

function compactStatsLine(statsLeft: string, statsLeftWidth: number, rightSide: string, width: number): string {
	const minimumPadding = 2;
	const availableForRightSide = width - statsLeftWidth - minimumPadding;
	if (availableForRightSide <= 0) return statsLeft;

	const truncatedRightSide = truncateToWidth(rightSide, availableForRightSide, "");
	const padding = " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRightSide)));
	return `${statsLeft}${padding}${truncatedRightSide}`;
}

function currentThinkingLevel(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "thinking_level_change") return entry.thinkingLevel;
	}
	return undefined;
}

function formatFooterTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function numericUsageField(usage: Record<string, unknown>, key: string): number {
	const value = usage[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nestedNumericUsageField(usage: Record<string, unknown>, outerKey: string, innerKey: string): number {
	const outerValue = usage[outerKey];
	if (!isRecord(outerValue)) return 0;
	return numericUsageField(outerValue, innerKey);
}
