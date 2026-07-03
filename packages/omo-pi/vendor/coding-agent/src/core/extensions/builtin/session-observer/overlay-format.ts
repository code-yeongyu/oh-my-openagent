import { TruncatedText } from "@earendil-works/pi-tui";
import { keyHint, keyText } from "../../../../modes/interactive/components/keybinding-hints.ts";
import { theme } from "../../../../modes/interactive/theme/theme.ts";
import { shortenPath } from "../../../../utils/paths.ts";
import type {} from "../../../keybindings.ts";
import { compactWhitespace, formatSessionDate } from "./text.ts";
import type { SessionHudEntry } from "./types.ts";

export function sessionAge(session: SessionHudEntry): string {
	return session.isCurrent ? "live" : formatSessionDate(new Date(session.modifiedAt));
}

export function describeSession(session: SessionHudEntry): string {
	const cwd = shortenPath(session.cwd) || "unknown";
	return `${cwd} · ${sessionAge(session)} · ${session.messageCount} msg`;
}

export function pickerLabel(session: SessionHudEntry): string {
	return compactWhitespace(session.lastUserText) || "(no user prompt)";
}

export function renderLine(text: string, width: number): string {
	return new TruncatedText(text, 0, 0).render(width)[0] ?? "";
}

export function viewerFooter(scroll: string): string {
	const scrollKeys = `${theme.fg("dim", `${keyText("tui.select.up")}/${keyText("tui.select.down")}`)}${theme.fg("muted", " scroll")}`;
	return [
		scrollKeys,
		keyHint("tui.select.confirm", "expand"),
		keyHint("tui.select.cancel", "sessions"),
		keyHint("app.sessions.observe", "close"),
	]
		.join(theme.fg("muted", " · "))
		.concat(scroll);
}
