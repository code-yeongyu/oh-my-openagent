import { getSessionsDir } from "../../../../config.ts";
import type { ExtensionAPI } from "../../types.ts";
import { SessionHudOverlay } from "./overlay.ts";
import { resolveSessionHudRoot, scanSessionHudEntries } from "./scanner.ts";
import type { SessionHudEntry } from "./types.ts";

export { resolveSessionHudRoot, scanSessionHudEntries } from "./scanner.ts";
export { renderTranscript } from "./transcript.ts";

export default function sessionHudExtension(pi: ExtensionAPI): void {
	pi.registerCommand("sessions", {
		description: "Peek at previous session transcripts in a HUD",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("No UI available", "info");
				return;
			}

			let sessions: readonly SessionHudEntry[];
			try {
				const root = resolveSessionHudRoot(ctx.sessionManager.getSessionDir(), getSessionsDir());
				sessions = await scanSessionHudEntries(root, ctx.sessionManager.getSessionFile());
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to read sessions: ${message}`, "error");
				return;
			}

			if (sessions.length === 0) {
				ctx.ui.notify("No sessions found", "info");
				return;
			}

			await ctx.ui.custom<void>(
				(tui, _theme, _keybindings, done) =>
					new SessionHudOverlay({
						sessions,
						done,
						requestRender: () => tui.requestRender(),
					}),
				{ overlay: true, overlayOptions: { width: "94%", maxHeight: "90%", minWidth: 72, margin: 1 } },
			);
		},
	});
}
