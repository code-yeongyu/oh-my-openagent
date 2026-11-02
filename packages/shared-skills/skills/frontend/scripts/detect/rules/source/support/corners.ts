import { cleanSelector, cssScopes, declarations, selectorHost, selectorMatches, type CssScope } from "./css-scopes"

export type Corners = readonly (number | null)[]
const zero = (): (number | null)[] => [0, 0, 0, 0]
const unknown = (): (number | null)[] => [null, null, null, null]
const radiusIndices: Readonly<Record<string, readonly number[]>> = {
	tl: [0], tr: [1], br: [2], bl: [3], ss: [0], se: [1], ee: [2], es: [3], t: [0, 1], r: [1, 2], b: [2, 3], l: [0, 3], s: [0, 3], e: [1, 2],
}

function radiusPx(value: string): number | null {
	const v = value.trim().replace(/^['"`]|['"`]$/g, "")
	if (v === "0" || v === "none") return 0
	const m = /^(-?\d*\.?\d+)(px|rem|em|%)?$/.exec(v)
	if (!m) return null
	return Number(m[1]) * (m[2] === "rem" || m[2] === "em" ? 16 : m[2] === "%" ? 10 : 1)
}

export function applyRadii(base: Corners, body: string): Corners {
	let corners = [...base]
	if (/@include|@apply|\$\{|#\{|@\{|\.\.\.|(?:^|\n)\s*\+[\w-]+/.test(body)) corners = unknown()
	for (const [prop, value] of declarations(body)) {
		const key = prop.replace(/-/g, "").toLowerCase()
		if (key === "borderradius") {
			const vals = value.replace(/^['"`]|['"`]$/g, "").split("/")[0]?.trim().split(/\s+/).map(radiusPx) ?? []
			const [a = null, b = a, c = a, d = b] = vals
			corners = [a, b, c, d]
		} else {
			const at = ["bordertopleftradius", "bordertoprightradius", "borderbottomrightradius", "borderbottomleftradius"].indexOf(key)
			const logical = ["borderstartstartradius", "borderstartendradius", "borderendendradius", "borderendstartradius"].indexOf(key)
			if (at >= 0 || logical >= 0) corners[at >= 0 ? at : logical] = radiusPx(value)
		}
	}
	return corners
}

function utilityCorners(text: string): Corners {
	const entries = [...text.matchAll(/(?:^|[\s"'`{}])((?:[\w-]+:)*)(rounded(?:-(tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e))?(?:-([a-z0-9-]+|\[[^\]]*\]|\([^)]*\)))?)(?=$|[\s"'`{}])/g)]
	let corners = zero()
	const scale: Readonly<Record<string, number>> = { none: 0, xs: 2, sm: 4, "": 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32, full: 9999 }
	entries.sort((a, b) => (a[3]?.length ?? 0) - (b[3]?.length ?? 0))
	for (const entry of entries) {
		const size = entry[4] ?? ""
		const value = scale[size] ?? (size.startsWith("[") ? radiusPx(size.slice(1, -1)) : null)
		const indices = radiusIndices[entry[3] ?? ""] ?? [0, 1, 2, 3]
		for (const i of indices) {
			const before = corners[i]
			corners[i] = entry[1] ? before === null || value === null ? null : Math.max(before ?? 0, value) : value
		}
	}
	return corners
}

export function roundedAway(corners: Corners, side: string): boolean {
	const away = side === "left" || side === "start" || side === "l" || side === "s" ? [1, 2] : side === "right" || side === "end" || side === "r" || side === "e" ? [0, 3] : side === "top" ? [3, 2] : [0, 1]
	return away.some((i) => corners[i] === null) || away.every((i) => (corners[i] ?? 0) >= 4)
}

export function scopeCorners(scope: CssScope, scopes: readonly CssScope[], host = selectorHost(scope)): Corners {
	let corners: Corners = zero()
	let declared = false
	for (const item of scopes) {
		if (selectorMatches(selectorHost(item), host)) {
			const body = item.body
			if (/\bborder[-\w]*radius\s*:|\bborder\w*Radius\s*:|@include|@apply|\$\{|(?:^|\n)\s*\+[\w-]+/.test(body)) declared = true
			corners = applyRadii(corners, body)
		}
	}
	if (declared) return corners
	const sheet: (number | null)[] = zero()
	for (const item of scopes) {
		const own = applyRadii(zero(), item.body)
		for (let i = 0; i < 4; i++) sheet[i] = sheet[i] === null || own[i] === null ? null : Math.max(sheet[i] ?? 0, own[i] ?? 0)
	}
	return sheet
}

export function tagCorners(tag: string, styleText: string, imports: boolean): Corners {
	let corners = utilityCorners(tag)
	if (/\{\s*\.\.\.|(?:className|class|tw)\s*=\s*\{[^}]*[?:]|(?:className|class|tw)\s*=\s*\{\s*[\w$]+\s*\}|(?:v-bind:class|:class|class:)/.test(tag)) corners = unknown()
	const classText = /(?:className|class|tw)\s*=\s*["']([^"']*)/.exec(tag)?.[1] ?? ""
	if (!/\brounded(?:[-\s"']|$)/.test(tag)) {
		const scopes = cssScopes(styleText)
		const tagName = /^<([\w-]+)/.exec(tag)?.[1] ?? ""
		const matching = scopes.filter((s) => {
			const host = cleanSelector(selectorHost(s))
			if (/::?(?:before|after)/.test(s.selector)) return false
			const tail = host.split(/[ >+~]+/).at(-1) ?? ""
			const classes = [...tail.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? "")
			return classes.length > 0 ? classes.every((c) => classText.split(/\s/).includes(c)) : tail === tagName
		})
		const styled = new RegExp(`\\b(?:const|let)\\s+${tagName}\\s*=\\s*styled[^\\x60]*\\x60([^\\x60]*)\\x60`).exec(styleText)?.[1]
		if (styled) corners = applyRadii(corners, styled)
		else if (matching.length) for (const s of matching) corners = applyRadii(corners, s.body)
		else if (imports || /border-radius\s*:\s*(?:var|\$|@)|@apply|@include/.test(styleText)) corners = unknown()
	}
	for (const m of tag.matchAll(/\b(borderRadius|border(?:Top|Bottom)(?:Left|Right)Radius|rounded)\s*=\s*(?:["']([^"']*)["']|\{([^}]*)\})/g)) {
		const value = m[2] ?? m[3] ?? ""
		corners = m[1] === "rounded" ? value === "none" || value === "0" ? zero() : unknown() : applyRadii(corners, `${m[1]}:${value}`)
	}
	const style = /\bstyle\s*=\s*["']([^"']*)["']/.exec(tag)?.[1]
	const object = /\b(?:style|sx)\s*=\s*\{\{([\s\S]*)\}\}/.exec(tag)?.[1]
	if (style ?? object) corners = applyRadii(corners, style ?? object ?? "")
	else if (/\bstyle\s*=\s*\{/.test(tag)) corners = unknown()
	return corners
}
