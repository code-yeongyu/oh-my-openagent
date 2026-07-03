import type { Model } from "@earendil-works/pi-ai";

export type FavoriteModelIds = string[] | null;

export function getModelFullId(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

export function isFavoriteModel(favoriteIds: FavoriteModelIds, id: string): boolean {
	return favoriteIds === null || favoriteIds.includes(id);
}

export function toggleFavoriteModel(favoriteIds: FavoriteModelIds, allIds: string[], id: string): FavoriteModelIds {
	if (favoriteIds === null) {
		return allIds.filter((candidateId) => candidateId !== id);
	}
	const index = favoriteIds.indexOf(id);
	if (index >= 0) return [...favoriteIds.slice(0, index), ...favoriteIds.slice(index + 1)];
	return [...favoriteIds, id];
}

export function favoriteModels(
	favoriteIds: FavoriteModelIds,
	allIds: string[],
	targetIds?: string[],
): FavoriteModelIds {
	if (favoriteIds === null) return null;
	const targets = targetIds ?? allIds;
	const result = [...favoriteIds];
	for (const id of targets) {
		if (!result.includes(id)) result.push(id);
	}
	return result.length === allIds.length ? null : result;
}

export function clearFavoriteModels(
	favoriteIds: FavoriteModelIds,
	allIds: string[],
	targetIds?: string[],
): FavoriteModelIds {
	if (favoriteIds === null) {
		return targetIds ? allIds.filter((id) => !targetIds.includes(id)) : [];
	}
	const targets = new Set(targetIds ?? favoriteIds);
	return favoriteIds.filter((id) => !targets.has(id));
}

export function moveFavoriteModel(favoriteIds: FavoriteModelIds, id: string, delta: number): FavoriteModelIds {
	if (favoriteIds === null) return null;
	const index = favoriteIds.indexOf(id);
	if (index < 0) return [...favoriteIds];
	const newIndex = index + delta;
	if (newIndex < 0 || newIndex >= favoriteIds.length) return [...favoriteIds];
	const result = [...favoriteIds];
	[result[index], result[newIndex]] = [result[newIndex], result[index]];
	return result;
}

export function getSortedFavoriteModelIds(favoriteIds: FavoriteModelIds, allIds: string[]): string[] {
	if (favoriteIds === null) return allIds;
	const favoriteSet = new Set(favoriteIds);
	return [...favoriteIds, ...allIds.filter((id) => !favoriteSet.has(id))];
}
