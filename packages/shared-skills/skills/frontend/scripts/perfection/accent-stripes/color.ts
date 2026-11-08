// Colour classification for the accent-stripe linter.
// "chromatic" = an accent hue the stripe tell is made of; "neutral" = greys,
// inks, hairline tokens; "unknown" = cannot tell, so never flagged (low false positives).

export type ColorClass = "chromatic" | "neutral" | "unknown"

const HUES = [
	"red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan",
	"sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
]
const STATUS_WORDS = [
	"accent", "brand", "destructive", "danger", "error", "warning", "warn", "success",
	"info", "alert", "highlight", "positive", "negative", "critical", "attention", "tint",
]
const NEUTRAL_WORDS = [
	"slate", "gray", "grey", "zinc", "neutral", "stone", "black", "white", "transparent",
	"current", "currentcolor", "inherit", "initial", "unset", "border", "divider",
	"separator", "line", "hairline", "muted", "subtle", "input", "surface", "background",
	"bg", "card", "base", "outline",
]
// "primary" names an accent only when it is not the primary ink (--text-primary, --fg-primary).
const INK_WORDS = ["text", "fg", "foreground", "ink", "content", "label", "body"]

const NAMED_NEUTRAL = new Set([
	"black", "white", "gray", "grey", "silver", "gainsboro", "whitesmoke", "lightgray",
	"lightgrey", "darkgray", "darkgrey", "dimgray", "dimgrey", "slategray", "slategrey",
	"lightslategray", "darkslategray", "snow", "ivory", "linen", "transparent", "currentcolor",
	"inherit", "initial", "unset", "none",
])
const NAMED_CHROMATIC = new Set([
	"red", "orange", "yellow", "green", "blue", "purple", "violet", "indigo", "teal", "cyan",
	"magenta", "fuchsia", "pink", "gold", "lime", "navy", "crimson", "tomato", "coral",
	"royalblue", "dodgerblue", "deepskyblue", "steelblue", "seagreen", "limegreen", "orangered",
	"hotpink", "deeppink", "darkorange", "goldenrod", "turquoise", "orchid", "salmon", "maroon",
	"olive", "aqua", "rebeccapurple", "mediumpurple", "slateblue", "tan",
])

const CHROMA_THRESHOLD = 0.2

export function classifyName(name: string): ColorClass {
	const parts = name.toLowerCase().replace(/^-+/, "").split(/[-_/.\s]+/).filter(Boolean)
	if (parts.some((p) => HUES.includes(p) || STATUS_WORDS.includes(p))) return "chromatic"
	if (parts.includes("primary") || parts.includes("secondary")) {
		if (parts.some((p) => INK_WORDS.includes(p) || NEUTRAL_WORDS.includes(p))) return "neutral"
		return parts.includes("primary") ? "chromatic" : "unknown"
	}
	if (parts.some((p) => NEUTRAL_WORDS.includes(p) || INK_WORDS.includes(p))) return "neutral"
	return "unknown"
}

function chromaFromRgb(r: number, g: number, b: number): ColorClass {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	return (max - min) / 255 > CHROMA_THRESHOLD ? "chromatic" : "neutral"
}

function parseNumbers(args: string): number[] {
	return args
		.split(/[\s,/]+/)
		.filter(Boolean)
		.map((n) => (n.endsWith("%") ? Number.parseFloat(n) / 100 : Number.parseFloat(n)))
}

function classifyFunction(fn: string, args: string): ColorClass {
	const raw = args.split(/[\s,/]+/).filter(Boolean)
	const n = parseNumbers(args)
	if (n.some((x) => Number.isNaN(x))) return "unknown"
	if (fn === "rgb" || fn === "rgba") {
		const scale = (i: number) => (raw[i]?.endsWith("%") ? (n[i] ?? 0) * 255 : (n[i] ?? 0))
		return chromaFromRgb(scale(0), scale(1), scale(2))
	}
	if (fn === "hsl" || fn === "hsla") {
		const s = raw[1]?.endsWith("%") ? (n[1] ?? 0) : (n[1] ?? 0) / 100
		const l = raw[2]?.endsWith("%") ? (n[2] ?? 0) : (n[2] ?? 0) / 100
		return (1 - Math.abs(2 * l - 1)) * s > CHROMA_THRESHOLD ? "chromatic" : "neutral"
	}
	if (fn === "oklch") return (n[1] ?? 0) > 0.05 ? "chromatic" : "neutral"
	if (fn === "lch") return (n[1] ?? 0) > 20 ? "chromatic" : "neutral"
	return "unknown"
}

export function classifyColor(input: string): ColorClass {
	const value = input.trim().toLowerCase().replace(/\s*!important$/, "")
	const hex = /^#([0-9a-f]{3,8})$/.exec(value)
	if (hex?.[1]) {
		let h = hex[1]
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
		if (h.length !== 6 && h.length !== 8) return "unknown"
		const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
		return chromaFromRgb(r ?? 0, g ?? 0, b ?? 0)
	}
	const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value)
	if (varMatch?.[1]) {
		const byName = classifyName(varMatch[1])
		if (byName !== "unknown" || !varMatch[2]) return byName
		return classifyColor(varMatch[2])
	}
	const theme = /^theme\(\s*['"]?([\w.-]+)['"]?\s*\)$/.exec(value)
	if (theme?.[1]) return classifyName(theme[1])
	const fn = /^([a-z]+)\((.*)\)$/.exec(value)
	if (fn?.[1] && fn[2] !== undefined) return classifyFunction(fn[1], fn[2])
	if (NAMED_NEUTRAL.has(value)) return "neutral"
	if (NAMED_CHROMATIC.has(value)) return "chromatic"
	return "unknown"
}

export function looksLikeColor(token: string): boolean {
	const t = token.toLowerCase()
	return (
		t.startsWith("#") ||
		/^(rgba?|hsla?|oklch|oklab|lch|lab|color-mix|var|theme)\(/.test(t) ||
		NAMED_NEUTRAL.has(t) ||
		NAMED_CHROMATIC.has(t)
	)
}

const COLOR_IN_VALUE = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch|lch)\([^)]*\)|var\(--[\w-]+(?:,[^)]*)?\)|\b[a-z]+\b/gi

export function containsChromatic(value: string): boolean {
	return (value.match(COLOR_IN_VALUE) ?? []).some((c) => looksLikeColor(c) && classifyColor(c) === "chromatic")
}

export function classifyUtilityColor(fragment: string): ColorClass {
	if (fragment.startsWith("[") && fragment.endsWith("]")) {
		const inner = fragment.slice(1, -1).replace(/^color:/, "").replace(/_/g, " ")
		return classifyColor(inner)
	}
	const bare = fragment.replace(/\/[\w.[\]]+$/, "")
	const head = bare.split("-")[0] ?? ""
	if (HUES.includes(head)) return "chromatic"
	return classifyName(bare)
}
