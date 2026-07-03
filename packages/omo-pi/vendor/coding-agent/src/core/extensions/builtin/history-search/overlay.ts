import { basename } from "node:path";
import type { Focusable, TUI } from "@earendil-works/pi-tui";
import { Container, getKeybindings, Input, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import { DynamicBorder } from "../../../../modes/interactive/components/dynamic-border.ts";
import type { Theme } from "../../../../modes/interactive/theme/theme.ts";
import { filterHistory } from "./filter.ts";
import type { HistoryEntry } from "./types.ts";

const MAX_VISIBLE_ROWS = 15;
const MAX_RENDERED_MATCHES = 250;

type SelectListAction = "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel";

const SELECT_LIST_ACTIONS: readonly SelectListAction[] = [
	"tui.select.up",
	"tui.select.down",
	"tui.select.confirm",
	"tui.select.cancel",
];

type HistorySearchTui = Pick<TUI, "requestRender">;

type HistorySearchOverlayOptions = {
	readonly tui: HistorySearchTui;
	readonly entries: readonly HistoryEntry[];
	readonly theme: Theme;
	readonly done: (entry: HistoryEntry | undefined) => void;
};

function relativeTime(timestamp: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

function describeEntry(entry: HistoryEntry): string {
	const shortId = entry.sessionId.length <= 8 ? entry.sessionId : entry.sessionId.slice(0, 8);
	const cwdName = basename(entry.cwd);
	const sessionLabel = cwdName ? `${cwdName}/${shortId}` : shortId;
	return `${sessionLabel} · ${relativeTime(entry.timestamp)}`;
}

export class HistorySearchOverlay extends Container implements Focusable {
	private readonly searchInput: Input;
	private readonly entriesByValue = new Map<string, HistoryEntry>();
	private readonly options: HistorySearchOverlayOptions;
	private list: SelectList | undefined;
	private filteredEntries: readonly HistoryEntry[] = [];
	private _focused = false;

	constructor(options: HistorySearchOverlayOptions) {
		super();

		this.options = options;
		this.searchInput = new Input();
		this.searchInput.onEscape = () => this.options.done(undefined);
		this.rebuild();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	handleInput(input: string): void {
		const keybindings = getKeybindings();
		if (SELECT_LIST_ACTIONS.some((action) => keybindings.matches(input, action))) {
			this.list?.handleInput(input);
			return;
		}

		const before = this.searchInput.getValue();
		this.searchInput.handleInput(input);
		if (before !== this.searchInput.getValue()) {
			this.rebuild();
			this.options.tui.requestRender();
		}
	}

	getSearchValue(): string {
		return this.searchInput.getValue();
	}

	getFilteredEntries(): readonly HistoryEntry[] {
		return this.filteredEntries;
	}

	private rebuild(): void {
		this.entriesByValue.clear();
		this.filteredEntries = filterHistory(this.options.entries, this.searchInput.getValue());
		const renderedEntries = this.filteredEntries.slice(0, MAX_RENDERED_MATCHES);
		const items = renderedEntries.map((entry, index) => this.toSelectItem(entry, index));
		const list = new SelectList(items, Math.min(MAX_VISIBLE_ROWS, Math.max(1, items.length)), {
			selectedPrefix: (text) => this.options.theme.fg("accent", text),
			selectedText: (text) => text,
			description: (text) => this.options.theme.fg("muted", text),
			scrollInfo: (text) => this.options.theme.fg("dim", text),
			noMatch: (text) => this.options.theme.fg("warning", text.replace("commands", "prompts")),
		});
		list.onSelect = (item) => this.options.done(this.entriesByValue.get(item.value));
		list.onCancel = () => this.options.done(undefined);
		this.list = list;
		this.renderContainer(list, this.filteredEntries.length);
	}

	private toSelectItem(entry: HistoryEntry, index: number): SelectItem {
		const value = String(index);
		this.entriesByValue.set(value, entry);
		return {
			value,
			label: entry.text.replace(/[\r\n]+/g, " ").trim(),
			description: describeEntry(entry),
		};
	}

	private renderContainer(list: SelectList, matchCount: number): void {
		const title = this.options.theme.fg("accent", this.options.theme.bold(" Search prompt history"));
		const count = this.options.theme.fg("dim", ` ${matchCount}/${this.options.entries.length} prompts`);
		this.clear();
		this.addChild(new DynamicBorder((text: string) => this.options.theme.fg("accent", text)));
		this.addChild(new Text(`${title}${count}`, 0, 0));
		this.addChild(this.searchInput);
		this.addChild(list);
		this.addChild(
			new Text(this.options.theme.fg("dim", " Type to filter • ↑↓ navigate • enter select • esc close"), 0, 0),
		);
		this.addChild(new DynamicBorder((text: string) => this.options.theme.fg("accent", text)));
	}
}
