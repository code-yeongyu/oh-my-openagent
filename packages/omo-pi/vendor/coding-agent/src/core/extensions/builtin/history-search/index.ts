import * as path from "node:path";
import { getSessionsDir } from "../../../../config.ts";
import type { ExtensionAPI } from "../../types.ts";
import { indexSessions } from "./indexer.ts";
import { HistorySearchOverlay } from "./overlay.ts";
import type { HistoryEntry } from "./types.ts";

type PathLike = Pick<typeof path, "resolve" | "relative" | "isAbsolute">;

export function resolveSearchRoot(
	currentSessionDir: string,
	defaultSessionsRoot: string = getSessionsDir(),
	pathImpl: PathLike = path,
): string {
	const defaultRoot = pathImpl.resolve(defaultSessionsRoot);
	if (!currentSessionDir) return defaultRoot;
	const current = pathImpl.resolve(currentSessionDir);
	if (current === defaultRoot) return defaultRoot;
	const rel = pathImpl.relative(defaultRoot, current);
	if (rel && !rel.startsWith("..") && !pathImpl.isAbsolute(rel)) return defaultRoot;
	return current;
}

export default function historySearchExtension(pi: ExtensionAPI): void {
	pi.registerCommand("history", {
		description: "Search prompt history across sessions",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No UI available", "info");
				return;
			}

			let entries: readonly HistoryEntry[];
			try {
				const searchRoot = resolveSearchRoot(ctx.sessionManager.getSessionDir());
				entries = await indexSessions(searchRoot);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to read prompt history: ${message}`, "error");
				return;
			}

			if (entries.length === 0) {
				ctx.ui.notify("No prompt history found", "info");
				return;
			}

			const selected = await ctx.ui.custom<HistoryEntry | undefined>(
				(tui, theme, _keybindings, done) => new HistorySearchOverlay({ tui, entries, theme, done }),
				{ overlay: true, overlayOptions: { width: "90%", maxHeight: "80%", minWidth: 60, margin: 2 } },
			);

			if (selected) ctx.ui.setEditorText(selected.text);
		},
	});
}
