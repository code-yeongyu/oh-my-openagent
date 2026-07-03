import {
	Container,
	type Focusable,
	getKeybindings,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
	TruncatedText,
} from "@earendil-works/pi-tui";
import { DynamicBorder } from "../../../../modes/interactive/components/dynamic-border.ts";
import { keyHint } from "../../../../modes/interactive/components/keybinding-hints.ts";
import { getMarkdownTheme, theme } from "../../../../modes/interactive/theme/theme.ts";
import { shortenPath } from "../../../../utils/paths.ts";
import type {} from "../../../keybindings.ts";
import { loadTranscriptSnapshot } from "./loader.ts";
import { describeSession, pickerLabel, renderLine, sessionAge, viewerFooter } from "./overlay-format.ts";
import { sanitizeLine } from "./text.ts";
import { renderTranscript } from "./transcript.ts";
import type { SessionHudEntry, TranscriptSnapshot, ViewerEntryRange } from "./types.ts";

const MAX_VISIBLE_SESSIONS = 12;

type Mode = "picker" | "viewer";
type PickerAction = "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel";

const PICKER_ACTIONS: readonly PickerAction[] = [
	"tui.select.up",
	"tui.select.down",
	"tui.select.confirm",
	"tui.select.cancel",
];

interface SessionHudOverlayOptions {
	readonly sessions: readonly SessionHudEntry[];
	readonly done: () => void;
	readonly requestRender: () => void;
}

export class SessionHudOverlay extends Container implements Focusable {
	private readonly options: SessionHudOverlayOptions;
	private readonly sessionsByValue = new Map<string, SessionHudEntry>();
	private readonly topBorder = new DynamicBorder((text) => theme.fg("accent", text));
	private readonly middleBorder = new DynamicBorder((text) => theme.fg("accent", text));
	private readonly bottomBorder = new DynamicBorder((text) => theme.fg("accent", text));
	private list: SelectList | undefined;
	private mode: Mode = "picker";
	private selectedSession: SessionHudEntry | undefined;
	private snapshot: TranscriptSnapshot | undefined;
	private renderedLines: readonly string[] = [];
	private ranges: readonly ViewerEntryRange[] = [];
	private selectedEntryIndex = -1;
	private shouldSelectLastOnLoad = false;
	private expandedEntries = new Set<number>();
	private scrollOffset = 0;
	private viewportHeight = 12;
	private loadingText: string | undefined;
	private _focused = false;

	constructor(options: SessionHudOverlayOptions) {
		super();
		this.options = options;
		this.rebuildPicker();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	handleInput(input: string): void {
		if (this.mode === "picker") {
			this.handlePickerInput(input);
			return;
		}
		this.handleViewerInput(input);
	}

	override render(width: number): string[] {
		if (this.mode === "picker") return super.render(width);
		return this.renderViewer(width);
	}

	getMode(): Mode {
		return this.mode;
	}

	getSelectedEntryIndex(): number {
		return this.selectedEntryIndex;
	}

	getExpandedEntryCount(): number {
		return this.expandedEntries.size;
	}

	private handlePickerInput(input: string): void {
		const keybindings = getKeybindings();
		if (PICKER_ACTIONS.some((action) => keybindings.matches(input, action))) {
			this.list?.handleInput(input);
		}
	}

	private rebuildPicker(): void {
		this.sessionsByValue.clear();
		const items = this.options.sessions.map((session, index) => this.toPickerItem(session, index));
		const list = new SelectList(items, Math.min(MAX_VISIBLE_SESSIONS, Math.max(1, items.length)), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => text,
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text.replace("commands", "sessions")),
		});
		list.onSelect = (item) => {
			const session = this.sessionsByValue.get(item.value);
			if (session) void this.openSession(session);
		};
		list.onCancel = () => this.options.done();
		this.list = list;
		this.clear();
		this.addChild(
			new Text(
				`${theme.bold(theme.fg("accent", " Sessions"))}${theme.fg("dim", ` ${this.options.sessions.length} sessions`)}`,
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(list);
		this.addChild(new Spacer(1));
		this.addChild(
			new TruncatedText(`${keyHint("tui.select.confirm", "view")} ${keyHint("tui.select.cancel", "close")}`, 0, 0),
		);
	}

	private toPickerItem(session: SessionHudEntry, index: number): SelectItem {
		const value = String(index);
		this.sessionsByValue.set(value, session);
		return { value, label: pickerLabel(session), description: describeSession(session) };
	}

	private async openSession(session: SessionHudEntry): Promise<void> {
		this.mode = "viewer";
		this.selectedSession = session;
		this.snapshot = undefined;
		this.loadingText = "Loading session transcript...";
		this.resetViewerState();
		this.options.requestRender();
		try {
			this.snapshot = await loadTranscriptSnapshot(session.path);
			this.loadingText = undefined;
		} catch (error) {
			this.loadingText = `Failed to read session: ${error instanceof Error ? error.message : String(error)}`;
		}
		this.rebuildTranscript(process.stdout.columns || 80);
		this.options.requestRender();
	}

	private resetViewerState(): void {
		this.expandedEntries = new Set<number>();
		this.scrollOffset = 0;
		this.selectedEntryIndex = -1;
		this.shouldSelectLastOnLoad = true;
		this.renderedLines = [];
		this.ranges = [];
	}

	private rebuildTranscript(width: number): void {
		if (!this.snapshot) return;
		const rendered = renderTranscript(this.snapshot.entries, {
			width,
			selectedIndex: this.selectedEntryIndex,
			expandedEntries: this.expandedEntries,
			markdownTheme: getMarkdownTheme(),
		});
		this.renderedLines = rendered.lines;
		this.ranges = rendered.ranges;
		if (this.ranges.length > 0 && this.shouldSelectLastOnLoad) {
			this.shouldSelectLastOnLoad = false;
			this.selectedEntryIndex = this.ranges.length - 1;
			this.rebuildTranscript(width);
		}
		this.scrollToSelected();
	}

	private renderViewer(width: number): string[] {
		this.viewportHeight = Math.max(5, (process.stdout.rows || 32) - 8);
		this.rebuildTranscript(width);
		const session = this.selectedSession;
		const title = session ? `Sessions > ${shortenPath(session.cwd) || "unknown"} · ${session.shortId}` : "Sessions";
		const status = session
			? `${session.messageCount} messages · ${sessionAge(session)}${this.snapshot?.model ? ` · ${this.snapshot.model}` : ""}`
			: "";
		const maxScroll = Math.max(0, this.renderedLines.length - this.viewportHeight);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		const content = this.loadingText ? [theme.fg("dim", this.loadingText)] : this.renderedLines;
		const visible = content.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);
		const lines: string[] = [];
		lines.push(...this.topBorder.render(width));
		lines.push(renderLine(` ${theme.bold(theme.fg("accent", title))}`, width));
		if (status) lines.push(renderLine(` ${theme.fg("dim", status)}`, width));
		lines.push(...this.middleBorder.render(width));
		for (const line of visible) lines.push(` ${sanitizeLine(line, width - 2)}`);
		for (let index = visible.length; index < this.viewportHeight; index += 1) lines.push("");
		const scroll =
			content.length > this.viewportHeight
				? ` [${this.scrollOffset + 1}-${Math.min(this.scrollOffset + this.viewportHeight, content.length)}/${content.length}]`
				: "";
		lines.push(renderLine(` ${viewerFooter(scroll)}`, width));
		lines.push(...this.bottomBorder.render(width));
		return lines;
	}

	private handleViewerInput(input: string): void {
		const keybindings = getKeybindings();
		if (keybindings.matches(input, "app.sessions.observe")) {
			this.options.done();
			return;
		} else if (keybindings.matches(input, "tui.select.cancel")) this.backToPicker();
		else if (input === "j" || keybindings.matches(input, "tui.select.down")) this.moveSelection(1);
		else if (input === "k" || keybindings.matches(input, "tui.select.up")) this.moveSelection(-1);
		else if (keybindings.matches(input, "tui.select.pageDown")) this.moveSelection(5);
		else if (keybindings.matches(input, "tui.select.pageUp")) this.moveSelection(-5);
		else if (input === "g") this.jumpTo(0);
		else if (input === "G") this.jumpTo(this.ranges.length - 1);
		else if (keybindings.matches(input, "tui.select.confirm")) this.toggleExpanded();
		this.options.requestRender();
	}

	private backToPicker(): void {
		this.mode = "picker";
		this.rebuildPicker();
	}

	private moveSelection(delta: number): void {
		if (this.ranges.length === 0) return;
		this.selectedEntryIndex = Math.max(0, Math.min(this.selectedEntryIndex + delta, this.ranges.length - 1));
		this.scrollToSelected();
	}

	private jumpTo(index: number): void {
		if (this.ranges.length === 0) return;
		this.selectedEntryIndex = Math.max(0, Math.min(index, this.ranges.length - 1));
		this.scrollToSelected();
	}

	private toggleExpanded(): void {
		if (this.ranges.length === 0) return;
		if (this.expandedEntries.has(this.selectedEntryIndex)) this.expandedEntries.delete(this.selectedEntryIndex);
		else this.expandedEntries.add(this.selectedEntryIndex);
	}

	private scrollToSelected(): void {
		const selected = this.ranges[this.selectedEntryIndex];
		if (!selected) return;
		const bottom = selected.lineStart + selected.lineCount;
		if (selected.lineStart < this.scrollOffset) this.scrollOffset = Math.max(0, selected.lineStart - 1);
		if (bottom > this.scrollOffset + this.viewportHeight)
			this.scrollOffset = Math.max(0, bottom - this.viewportHeight + 1);
	}
}
