import { ancestors, parentOf, shortSnippet, styleOf } from "../../../core/page"
import { parseColor } from "../../../core/color"
import { parseShadow } from "../../../core/shadow"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import type { PageHit } from "../../../rule"
import { borderAccent, borderSafe, chroma, context, length, radii, roundedAway, selected, sides, visible } from "./appearance"

export function borderHits(s: PageSnapshot, e: ElementSnapshot, rule: string): PageHit[] {
	if (
		!visible(s, e) ||
		borderSafe.has(e.tag) ||
		e.rect.width < 20 ||
		e.rect.height < 20 ||
		context(
			s,
			e,
			(a) =>
				["status", "alert", "alertdialog", "log"].includes(a.attributes["role"] ?? "") ||
				["polite", "assertive"].includes(a.attributes["aria-live"] ?? ""),
		)
	)
		return []
	const rs = radii(e),
		min = Math.min(e.rect.width, e.rect.height)
	if (Math.max(e.rect.width, e.rect.height) <= min * 1.1 && rs.every((r) => r >= min / 2 - 0.5)) return []
	const widths = sides.map((side) => length(styleOf(e, "border-" + side + "-width")))
	return sides.flatMap((side, i) => {
		const w = widths[i] ?? 0,
			other = Math.max(...widths.filter((_, j) => i !== j))
		if (w < 2 || !(other <= 1 || w >= other * 2) || !borderAccent(styleOf(e, "border-" + side + "-color"))) return []
		const lateral = i === 1 || i === 3
		const id = lateral ? "side-tab" : (rs[0] ?? 0) > 0 ? "border-accent-on-rounded" : "side-tab"
		if (
			id !== rule ||
			(lateral && !roundedAway(e, i)) ||
			(!lateral && (rs[0] ?? 0) === 0 && (w < 3 || w > 12 || !roundedAway(e, i) || context(s, e, selected)))
		)
			return []
		return [{ element: e, message: "Accent border on the " + side + " edge (" + w + "px)", snippet: shortSnippet(e) }]
	})
}

export function stripeHit(s: PageSnapshot, e: ElementSnapshot): PageHit[] {
	if (!visible(s, e) || e.rect.width <= 40 || e.rect.height < 16) return []
	const hosts = [e, ...ancestors(s, e)]
	if (hosts.some((a) => ["nav", "blockquote", "pre"].includes(a.tag))) return []
	const rowNode = (a: ElementSnapshot): boolean =>
		["tr", "td", "th"].includes(a.tag) ||
		["row", "cell", "gridcell", "rowheader"].includes(a.attributes["role"] ?? "") ||
		/(?:^|[\s_-])(?:row|cell)(?:$|[\s_-])/.test(a.attributes["class"] ?? "")
	const row = rowNode(e) && !(!["tr", "td", "th"].includes(e.tag) && !e.attributes["role"] && radii(e).some((r) => r > 0))
	const rowHosts = row ? hosts.filter(rowNode) : [e]
	if (rowHosts.some(selected) || (!row && (borderSafe.has(e.tag) || context(s, e, selected)))) return []
	const status = rowHosts.some(
		(a) =>
			a.attributes["data-state"] !== undefined ||
			a.attributes["data-status"] !== undefined ||
			a.attributes["aria-invalid"] === "true" ||
			/(?:is-|has-|--)[a-z]/.test(a.attributes["class"] ?? ""),
	)
	const bg = parseColor(styleOf(e, "background-color"))
	const bare = (bg === null || bg.a < 0.1) && ["none", ""].includes(styleOf(e, "background-image"))
	const shadows = parseShadow(styleOf(e, "box-shadow"))
	const inset = shadows.length === 1 ? shadows[0] : undefined
	if (
		inset?.inset &&
		inset.blur === 0 &&
		inset.spread === 0 &&
		chroma("rgb(" + inset.color.r + " " + inset.color.g + " " + inset.color.b + " / " + inset.color.a + ")")
	) {
		const axis = inset.x !== 0 && inset.y === 0 ? (inset.x > 0 ? 3 : 1) : inset.y !== 0 && inset.x === 0 ? (inset.y > 0 ? 0 : 2) : -1
		const w = Math.max(Math.abs(inset.x), Math.abs(inset.y))
		if (axis >= 0 && (row ? (axis === 1 || axis === 3) && w >= 2 && w <= 6 && (status || bare) : w >= 3 && w <= 12 && roundedAway(e, axis)))
			return [{ element: e, message: "Inset accent stripe (" + w + "px)", snippet: shortSnippet(e) }]
	}
	if (row && (status || bare)) {
		const drawn = sides.map(
			(side) =>
				length(styleOf(e, "border-" + side + "-width")) > 0 && !["none", "hidden", ""].includes(styleOf(e, "border-" + side + "-style")),
		)
		for (const i of [3, 1]) {
			const side = sides[i] ?? "left",
				w = length(styleOf(e, "border-" + side + "-width"))
			if (drawn[0] && drawn[2]) continue
			if (drawn[i] && w >= 2 && w <= 6 && chroma(styleOf(e, "border-" + side + "-color")) && (status || drawn.filter(Boolean).length === 1))
				return [{ element: e, message: "Row accent border (" + w + "px)", snippet: shortSnippet(e) }]
		}
	}
	if (!row && !borderSafe.has(e.tag)) {
		const stripes = [e.before, e.after].flatMap((p) =>
			p ? [{ style: p.style, width: length(p.style["width"] ?? ""), height: length(p.style["height"] ?? "") }] : [],
		)
		for (const p of stripes) {
			if (
				!["absolute", "fixed"].includes(p.style["position"] ?? "") ||
				!chroma(p.style["background-color"] ?? "") ||
				p.style["display"] === "none" ||
				Number(p.style["opacity"] ?? 1) <= 0.01
			)
				continue
			const hugs = (side: string): boolean => Math.abs(length(p.style[side] ?? "")) <= 2
			const axis =
				p.width >= 2 && p.width <= 12 && p.height >= Math.max(e.rect.height - 44, e.rect.height / 2)
					? hugs("left")
						? 3
						: hugs("right")
							? 1
							: -1
					: p.height >= 3 && p.height <= 12 && p.width >= Math.max(e.rect.width - 44, e.rect.width / 2)
						? hugs("top")
							? 0
							: hugs("bottom")
								? 2
								: -1
						: -1
			if (axis >= 0 && roundedAway(e, axis)) return [{ element: e, message: "Positioned accent stripe", snippet: shortSnippet(e) }]
		}
	}
	return []
}

export function childStripeHit(s: PageSnapshot, e: ElementSnapshot): PageHit[] {
	if (!["div", "span"].includes(e.tag) || e.children.length > 0 || e.text.trim() !== "" || !visible(s, e)) return []
	const p = parentOf(s, e)
	if (!p || ["body", "html", "h1", "h2", "h3", "h4", "h5", "h6"].includes(p.tag) || p.rect.width < 40 || p.rect.height < 20) return []
	if (
		context(
			s,
			e,
			(a) =>
				["nav", "blockquote", "pre", "table", "button", "a", "select", "progress", "meter"].includes(a.tag) ||
				["progressbar", "slider", "scrollbar", "separator", "tablist", "status", "alert"].includes(a.attributes["role"] ?? "") ||
				selected(a),
		)
	)
		return []
	const { width: w, height: h, x } = e.rect,
		host = p.rect
	const side = Math.abs(x - host.x) <= 3 ? 3 : Math.abs(host.x + host.width - x - w) <= 3 ? 1 : -1
	if (
		side < 0 ||
		w < 2 ||
		w > 12 ||
		h < Math.max(host.height - 44, host.height * 0.5) ||
		!roundedAway(p, side) ||
		!chroma(styleOf(e, "background-color"))
	)
		return []
	return [{ element: e, message: w + "px accent stripe child", snippet: shortSnippet(e) }]
}
