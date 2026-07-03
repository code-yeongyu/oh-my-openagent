import type { Theme } from "@code-yeongyu/senpi";

import type { ClientSnapshot, LspManager } from "./manager.js";
import { matchesKey, truncateToWidth } from "./rendering.js";
import { shorten } from "./utils.js";

const MAX_PATH_WIDTH = 60;
const MAX_CMD_WIDTH = 40;

function formatRelative(now: number, then: number): string {
	const diff = Math.max(0, Math.floor((now - then) / 1000));
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	return `${Math.floor(diff / 3600)}h ago`;
}

export class LspInspectorComponent {
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly manager: LspManager,
		private readonly theme: Theme,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;
		const now = Date.now();

		lines.push("");
		const title = th.fg("accent", " LSP Servers ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 16)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		const snapshots: ClientSnapshot[] = this.manager.getSnapshot();

		if (snapshots.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No active LSP servers")}`, width));
		} else {
			lines.push(truncateToWidth(`  ${th.fg("muted", `${snapshots.length} active server(s)`)}`, width));
			lines.push("");

			for (const s of snapshots) {
				const idText = th.fg("accent", s.serverId);
				let statusKey: "success" | "warning" | "error" = "success";
				let statusText: string;
				if (!s.alive) {
					statusKey = "error";
					statusText = "dead";
				} else if (s.isInitializing) {
					statusKey = "warning";
					statusText = "initializing";
				} else {
					statusText = "alive";
				}
				const status = th.fg(statusKey, statusText);
				const ref = th.fg("muted", `refs:${s.refCount}`);
				const waiters = s.pendingWaiters > 0 ? th.fg("dim", ` waiters:${s.pendingWaiters}`) : "";
				const usedAt = th.fg("dim", ` ${formatRelative(now, s.lastUsedAt)}`);

				lines.push(truncateToWidth(`  ${idText}  ${status}  ${ref}${waiters}${usedAt}`, width));
				lines.push(
					truncateToWidth(
						`    ${th.fg("muted", "root: ")}${th.fg("dim", shorten(s.root, MAX_PATH_WIDTH))}`,
						width,
					),
				);
				lines.push(
					truncateToWidth(
						`    ${th.fg("muted", "cmd:  ")}${th.fg("dim", shorten(s.command.join(" "), MAX_CMD_WIDTH))}`,
						width,
					),
				);
				lines.push("");
			}
		}

		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
