const state = new Map<string, number>()

export function getNextModel(category: string, pool: string[]): string {
	if (pool.length === 0) {
		return ""
	}
	const idx = state.get(category) ?? 0
	const safeIdx = idx % pool.length
	state.set(category, safeIdx + 1)
	return pool[safeIdx]
}

export function resetPoolState(): void {
	state.clear()
}

export function resetCategoryState(category: string): void {
	state.delete(category)
}
