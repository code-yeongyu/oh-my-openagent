import { Box, Markdown, type MarkdownTheme, Spacer, Text } from "@earendil-works/pi-tui";
import type { CompactionSummaryMessage } from "../../../core/messages.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCompactionDetails(details: unknown): string | undefined {
	if (!isRecord(details)) return undefined;
	if (details.schema !== "senpi.compaction.openai-remote.v1") return undefined;
	const retained = typeof details.retainedInputItemCount === "number" ? details.retainedInputItemCount : undefined;
	const requested = typeof details.requestInputItemCount === "number" ? details.requestInputItemCount : undefined;
	const retainedText = retained === undefined ? "native replay active" : `${retained.toLocaleString()} retained items`;
	const requestedText = requested === undefined ? "" : ` from ${requested.toLocaleString()} OpenAI input items`;
	const route =
		details.transport === "websocket" ? "OpenAI Responses WebSocket compaction" : "OpenAI remote compact API";
	return `${route}: ${retainedText}${requestedText}`;
}

/**
 * Component that renders a compaction message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 */
export class CompactionSummaryMessageComponent extends Box {
	private expanded = false;
	private message: CompactionSummaryMessage;
	private markdownTheme: MarkdownTheme;

	constructor(message: CompactionSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.message = message;
		this.markdownTheme = markdownTheme;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const tokenStr = this.message.tokensBefore.toLocaleString();
		const details = formatCompactionDetails(this.message.details);
		const label = theme.fg("customMessageLabel", `\x1b[1m[compaction]\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const detailLine = details ? `\n${details}\n\n` : "\n\n";
			const header = `**Compacted from ${tokenStr} tokens**${detailLine}`;
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			const prefix = details ? `${details}; ` : "";
			this.addChild(
				new Text(
					theme.fg("customMessageText", `${prefix}compacted from ${tokenStr} tokens (`) +
						theme.fg("dim", keyText("app.tools.expand")) +
						theme.fg("customMessageText", " to expand)"),
					0,
					0,
				),
			);
		}
	}
}
