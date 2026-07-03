import { type Model, modelsAreEqual } from "@earendil-works/pi-ai";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import { getModelSearchText } from "../model-search.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyText } from "./keybinding-hints.ts";
import {
	clearFavoriteModels,
	type FavoriteModelIds,
	favoriteModels,
	getModelFullId,
	getSortedFavoriteModelIds,
	isFavoriteModel,
	moveFavoriteModel,
	toggleFavoriteModel,
} from "./model-favorites.ts";

interface ModelItem {
	fullId: string;
	model: Model<any>;
	favorite: boolean;
}

export interface FavoriteModelsConfig {
	allModels: Model<any>[];
	favoriteModelIds: FavoriteModelIds;
	currentModel?: Model<any>;
}

export interface FavoriteModelsCallbacks {
	/** Called whenever the favorite model set or order changes (session-only, no persist) */
	onChange: (favoriteModelIds: FavoriteModelIds) => void | Promise<void>;
	/** Called when user wants to persist current selection to settings */
	onPersist: (favoriteModelIds: FavoriteModelIds) => void | Promise<void>;
	onSelect: (model: Model<any>) => void | Promise<void>;
	onCancel: () => void;
}

/**
 * Component for managing favorite models for Ctrl+P cycling.
 * Changes are session-only until explicitly persisted with Ctrl+S.
 */
export class FavoriteModelsSelectorComponent extends Container implements Focusable {
	private modelsById: Map<string, Model<any>> = new Map();
	private allIds: string[] = [];
	private favoriteIds: FavoriteModelIds = null;
	private filteredItems: ModelItem[] = [];
	private selectedIndex = 0;
	private searchInput: Input;
	private currentModel?: Model<any>;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private footerText: Text;
	private secondaryFooterText: Text;
	private callbacks: FavoriteModelsCallbacks;
	private maxVisible = 8;
	private isDirty = false;

	constructor(config: FavoriteModelsConfig, callbacks: FavoriteModelsCallbacks) {
		super();
		this.callbacks = callbacks;
		this.currentModel = config.currentModel;

		for (const model of config.allModels) {
			const fullId = getModelFullId(model);
			this.modelsById.set(fullId, model);
			this.allIds.push(fullId);
		}

		this.favoriteIds = config.favoriteModelIds === null ? null : [...config.favoriteModelIds];
		this.filteredItems = this.buildItems();

		// Header
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", theme.bold("Favorite Models")), 0, 0));
		this.addChild(
			new Text(
				theme.fg(
					"muted",
					`${keyText("tui.select.confirm")} selects. ${keyText("app.models.toggleFavorite")} toggles favorite. ${keyText("app.models.save")} saves.`,
				),
				0,
				0,
			),
		);
		this.addChild(new Spacer(1));

		// Search input
		this.searchInput = new Input();
		this.addChild(this.searchInput);
		this.addChild(new Spacer(1));

		// List container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		// Footer hint
		this.addChild(new Spacer(1));
		this.footerText = new Text(this.getFooterText(), 0, 0);
		this.addChild(this.footerText);
		this.secondaryFooterText = new Text(this.getSecondaryFooterText(), 0, 0);
		this.addChild(this.secondaryFooterText);

		this.addChild(new DynamicBorder());
		this.updateList();
	}

	private buildItems(): ModelItem[] {
		// Filter out IDs that no longer have a corresponding model (e.g., after logout)
		const items: ModelItem[] = [];
		for (const id of getSortedFavoriteModelIds(this.favoriteIds, this.allIds)) {
			const model = this.modelsById.get(id);
			if (!model) continue;
			items.push({
				fullId: id,
				model,
				favorite: isFavoriteModel(this.favoriteIds, id),
			});
		}
		return items;
	}

	private getFooterText(): string {
		const favoriteCount = this.favoriteIds?.length ?? this.allIds.length;
		const allFavorite = this.favoriteIds === null;
		const countText = allFavorite ? "all favorites" : `${favoriteCount}/${this.allIds.length} favorites`;
		const parts = [
			`${keyText("tui.select.confirm")} select`,
			`${keyText("app.models.toggleFavorite")} favorite`,
			`${keyText("app.models.save")} save`,
			countText,
		];
		return this.isDirty
			? theme.fg("dim", `  ${parts.join(" · ")} `) + theme.fg("warning", "unsaved")
			: theme.fg("dim", `  ${parts.join(" · ")}`);
	}

	private getSecondaryFooterText(): string {
		const parts = [
			`${keyText("app.models.enableAll")} all`,
			`${keyText("app.models.clearAll")} clear`,
			`${keyText("app.models.toggleProvider")} provider`,
			`${keyText("app.models.reorderUp")}/${keyText("app.models.reorderDown")} order`,
		];
		return theme.fg("dim", `  ${parts.join(" · ")}`);
	}

	private refresh(preferredSelectedId?: string): void {
		const query = this.searchInput.getValue();
		const selectedId = preferredSelectedId ?? this.filteredItems[this.selectedIndex]?.fullId;
		const items = this.buildItems();
		this.filteredItems = query
			? fuzzyFilter(items, query, (i) =>
					getModelSearchText({ id: i.model.id, provider: i.model.provider, name: i.model.name }),
				)
			: items;
		const selectedIndex = selectedId ? this.filteredItems.findIndex((item) => item.fullId === selectedId) : -1;
		this.selectedIndex =
			selectedIndex >= 0 ? selectedIndex : Math.min(this.selectedIndex, Math.max(0, this.filteredItems.length - 1));
		this.updateList();
		this.footerText.setText(this.getFooterText());
		this.secondaryFooterText.setText(this.getSecondaryFooterText());
	}

	private notifyChange(): void {
		this.callbacks.onChange(this.favoriteIds === null ? null : [...this.favoriteIds]);
	}

	private updateList(): void {
		this.listContainer.clear();

		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching models"), 0, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const favoriteMarker = item.favorite ? theme.fg("success", "*") : theme.fg("dim", "-");
			const modelText = isSelected ? theme.fg("accent", item.model.id) : item.model.id;
			const providerBadge = theme.fg("muted", ` [${item.model.provider}]`);
			const currentMarker =
				this.currentModel && modelsAreEqual(this.currentModel, item.model) ? theme.fg("success", " ✓") : "";
			this.listContainer.addChild(
				new Text(`${prefix}${favoriteMarker} ${modelText}${providerBadge}${currentMarker}`, 0, 0),
			);
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`), 0, 0),
			);
		}

		if (this.filteredItems.length > 0) {
			const selected = this.filteredItems[this.selectedIndex];
			if (selected) {
				this.listContainer.addChild(new Spacer(1));
				this.listContainer.addChild(new Text(theme.fg("muted", `  Model Name: ${selected.model.name}`), 0, 0));
			}
		}
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		// Navigation
		if (kb.matches(data, "tui.select.up")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.updateList();
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (this.filteredItems.length === 0) return;
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			return;
		}

		// Reorder favorite models
		const reorderUp = kb.matches(data, "app.models.reorderUp");
		const reorderDown = kb.matches(data, "app.models.reorderDown");
		if (reorderUp || reorderDown) {
			if (this.favoriteIds === null) return;
			const item = this.filteredItems[this.selectedIndex];
			if (item && isFavoriteModel(this.favoriteIds, item.fullId)) {
				const delta = reorderUp ? -1 : 1;
				const currentIndex = this.favoriteIds.indexOf(item.fullId);
				const newIndex = currentIndex + delta;
				// Only move if within bounds
				if (newIndex >= 0 && newIndex < this.favoriteIds.length) {
					this.favoriteIds = moveFavoriteModel(this.favoriteIds, item.fullId, delta);
					this.isDirty = true;
					this.selectedIndex += delta;
					this.refresh(item.fullId);
					this.notifyChange();
				}
			}
			return;
		}

		// Select on Enter
		if (kb.matches(data, "tui.select.confirm")) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				this.callbacks.onSelect(item.model);
			}
			return;
		}

		// Toggle favorite status for the selected model
		if (kb.matches(data, "app.models.toggleFavorite")) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				this.favoriteIds = toggleFavoriteModel(this.favoriteIds, this.allIds, item.fullId);
				this.isDirty = true;
				this.refresh(item.fullId);
				this.notifyChange();
			}
			return;
		}

		// Favorite all (filtered if search active, otherwise all)
		if (kb.matches(data, "app.models.enableAll")) {
			const item = this.filteredItems[this.selectedIndex];
			const targetIds = this.searchInput.getValue() ? this.filteredItems.map((i) => i.fullId) : undefined;
			this.favoriteIds = favoriteModels(this.favoriteIds, this.allIds, targetIds);
			this.isDirty = true;
			this.refresh(item?.fullId);
			this.notifyChange();
			return;
		}

		// Clear all (filtered if search active, otherwise all)
		if (kb.matches(data, "app.models.clearAll")) {
			const item = this.filteredItems[this.selectedIndex];
			const targetIds = this.searchInput.getValue() ? this.filteredItems.map((i) => i.fullId) : undefined;
			this.favoriteIds = clearFavoriteModels(this.favoriteIds, this.allIds, targetIds);
			this.isDirty = true;
			this.refresh(item?.fullId);
			this.notifyChange();
			return;
		}

		// Toggle provider of current item
		if (kb.matches(data, "app.models.toggleProvider")) {
			const item = this.filteredItems[this.selectedIndex];
			if (item) {
				const provider = item.model.provider;
				const providerIds = this.allIds.filter((id) => this.modelsById.get(id)?.provider === provider);
				const allFavorite = providerIds.every((id) => isFavoriteModel(this.favoriteIds, id));
				this.favoriteIds = allFavorite
					? clearFavoriteModels(this.favoriteIds, this.allIds, providerIds)
					: favoriteModels(this.favoriteIds, this.allIds, providerIds);
				this.isDirty = true;
				this.refresh(item.fullId);
				this.notifyChange();
			}
			return;
		}

		// Save/persist to settings
		if (kb.matches(data, "app.models.save")) {
			this.callbacks.onPersist(this.favoriteIds === null ? null : [...this.favoriteIds]);
			this.isDirty = false;
			this.footerText.setText(this.getFooterText());
			return;
		}

		// Ctrl+C - clear search or cancel if empty
		if (matchesKey(data, Key.ctrl("c"))) {
			if (this.searchInput.getValue()) {
				this.searchInput.setValue("");
				this.refresh();
			} else {
				this.callbacks.onCancel();
			}
			return;
		}

		// Escape - cancel
		if (matchesKey(data, Key.escape)) {
			this.callbacks.onCancel();
			return;
		}

		// Pass everything else to search input
		this.searchInput.handleInput(data);
		this.refresh();
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
