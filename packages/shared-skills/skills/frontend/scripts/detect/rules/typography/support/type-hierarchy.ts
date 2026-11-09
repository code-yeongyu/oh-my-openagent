export type TypeSample = { readonly role: string; readonly size: number; readonly weight: number }

function dominant(role: string, values: readonly number[]): number | null {
	const counts = new Map<number, number>()
	for (const n of values) counts.set(n, (counts.get(n) ?? 0) + 1)
	const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])
	const first = ranked[0]
	const second = ranked[1]
	if (first === undefined) return null
	if (second && first[1] === second[1]) {
		return role === "h1" ? Math.max(...ranked.filter(n => n[1] === first[1]).map(n => n[0])) : null
	}
	if (second && role !== "h1" && role !== "body" && second[1] >= first[1] * 0.75 && second[0] >= first[0] * 1.25) return null
	return first[0]
}

const largestStep = (values: readonly number[]): number => {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted.reduce((n, v, i) => Math.max(n, v / (sorted[i - 1] ?? v)), 1)
}

export function flatHierarchy(samples: readonly TypeSample[]): readonly [string, number][] {
	const groups = new Map<string, number[]>()
	for (const s of samples) {
		const values = groups.get(s.role) ?? []
		values.push(Math.round(s.size * 10) / 10)
		groups.set(s.role, values)
	}
	const roles: [string, number][] = []
	const dropped: number[] = []
	let settled = 0
	for (const [role, values] of groups) {
		const size = dominant(role, values)
		if (size === null) {
			if (role !== "body") dropped.push(...values)
		} else {
			roles.push([role, size])
			if (role !== "body") settled += values.length
		}
	}
	if (roles.length < 3) return []
	const h1 = roles.find(r => r[0] === "h1")?.[1]
	const body = roles.find(r => r[0] === "body")?.[1]
	if (h1 !== undefined && body !== undefined && h1 < body) return []
	const sizes = roles.map(r => r[1])
	if (largestStep(sizes) >= 1.25 || (dropped.length > settled && dropped.some(n => largestStep([...sizes, n]) >= 1.25))) return []
	return roles
}
