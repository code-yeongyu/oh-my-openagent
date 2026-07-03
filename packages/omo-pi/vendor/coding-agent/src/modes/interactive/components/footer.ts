import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { theme } from "../theme/theme.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatTokens(count: number): string {
	return count.toLocaleString("en-US");
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Color the right side of the footer: (provider) muted, model accent, :thinking dim.
 * The text is the plain (uncolored) right-aligned segment from the layout pass.
 */
function colorRightSide(text: string): string {
	if (!text) return "";
	const providerMatch = text.match(/^\(([^)]+)\) (.*)$/);
	const body = providerMatch ? providerMatch[2] : text;
	const providerPrefix = providerMatch ? theme.fg("muted", `(${providerMatch[1]}) `) : "";
	const thinkingMatch = body.match(/^(.+):([^:]+)$/);
	if (!thinkingMatch) return providerPrefix + theme.fg("accent", body);
	return `${providerPrefix}${theme.fg("accent", thinkingMatch[1])}${theme.fg("dim", `:${thinkingMatch[2]}`)}`;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private autoCompactEnabled = true;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let latestCacheHitRate: number | undefined;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;

				const latestPromptTokens =
					entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
		const contextTokens =
			typeof contextUsage?.tokens === "number"
				? formatTokens(contextUsage.tokens)
				: typeof contextUsage?.percent === "number"
					? formatTokens(Math.round((contextWindow * contextUsage.percent) / 100))
					: "?";

		// Build colored segments. Each segment carries its own theme color
		// so the HUD stays readable at a glance instead of being one dim wash.
		const sep = theme.fg("borderMuted", " • ");
		const pwdRaw = formatCwdForFooter(
			this.session.sessionManager.getCwd(),
			process.env.HOME || process.env.USERPROFILE,
		);
		const branch = this.footerData.getGitBranch();
		const sessionName = this.session.sessionManager.getSessionName();

		const coloredSegments: string[] = [theme.fg("accent", pwdRaw)];
		const plainSegments: string[] = [pwdRaw];
		if (branch) {
			coloredSegments.push(theme.fg("warning", branch));
			plainSegments.push(branch);
		}
		if (sessionName) {
			coloredSegments.push(theme.fg("muted", sessionName));
			plainSegments.push(sessionName);
		}
		if (totalInput) {
			const text = `↑${formatTokens(totalInput)}`;
			coloredSegments.push(theme.fg("dim", text));
			plainSegments.push(text);
		}
		if (totalOutput) {
			const text = `↓${formatTokens(totalOutput)}`;
			coloredSegments.push(theme.fg("dim", text));
			plainSegments.push(text);
		}
		if (totalCacheRead || totalCacheWrite) {
			const text = `cache ${formatTokens(totalCacheRead)}/${formatTokens(totalCacheWrite)}`;
			coloredSegments.push(theme.fg("dim", text));
			plainSegments.push(text);
		}
		if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
			const text = `CH${latestCacheHitRate.toFixed(1)}%`;
			coloredSegments.push(theme.fg("dim", text));
			plainSegments.push(text);
		}

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
			coloredSegments.push(theme.fg("success", costStr));
			plainSegments.push(costStr);
		}

		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const ctxDisplay =
			contextPercent === "?"
				? `${contextTokens}/${formatTokens(contextWindow)} (?)${autoIndicator}`
				: `${contextTokens}/${formatTokens(contextWindow)} (${contextPercent}%)${autoIndicator}`;
		const ctxColored =
			contextPercentValue > 90
				? theme.fg("error", ctxDisplay)
				: contextPercentValue > 70
					? theme.fg("warning", ctxDisplay)
					: theme.fg("muted", ctxDisplay);
		coloredSegments.push(ctxColored);
		plainSegments.push(ctxDisplay);

		const statsLeftPlain = plainSegments.join(" • ");
		let statsLeft = coloredSegments.join(sep);
		let statsLeftWidth = visibleWidth(statsLeftPlain);

		// If statsLeft is too wide, truncate the plain version (color codes break truncation)
		if (statsLeftWidth > width) {
			const truncated = truncateToWidth(statsLeftPlain, width, "...");
			statsLeft = theme.fg("muted", truncated);
			statsLeftWidth = visibleWidth(truncated);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		const modelName = state.model?.id || "no-model";
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider = thinkingLevel === "off" ? `${modelName}:off` : `${modelName}:${thinkingLevel}`;
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSidePlain = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			const withProvider = `(${state.model.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(withProvider) <= width) {
				rightSidePlain = withProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSidePlain);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let rightSideRendered = rightSidePlain;
		let actualRightWidth = rightSideWidth;
		if (totalNeeded > width) {
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				rightSideRendered = truncateToWidth(rightSidePlain, availableForRight, "");
				actualRightWidth = visibleWidth(rightSideRendered);
			} else {
				rightSideRendered = "";
				actualRightWidth = 0;
			}
		}

		// Color the right side: provider muted, model accent, thinking dim
		const coloredRight = colorRightSide(rightSideRendered);
		const padding = " ".repeat(Math.max(0, width - statsLeftWidth - actualRightWidth));
		const lines = [statsLeft + padding + coloredRight];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
