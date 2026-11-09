import type { SourceRule } from "../../rule"
import { accentScans, safeSelector } from "./support/accent-scans"
import { chromatic } from "./support/source-color"
import { applyRadii, roundedAway, scopeCorners, tagCorners } from "./support/corners"
import { cssScopes, selectorHost } from "./support/css-scopes"
import { solidBackground, tagAt } from "./support/markup-scope"
import { lineCheck, sourceExtensions, sourcePasses } from "./support/source-text"

const borderCheck = lineCheck([
	/\bborder-([lrse])-(\d+)\b/g,
	/border-(left|right)\s*:\s*(\d+)px\s+solid[^;]*/gi,
	/border-(left|right|inline-start|inline-end)-width\s*:\s*(\d+)px/gi,
	/border-(inline-start|inline-end)\s*:\s*(\d+)px\s+solid/gi,
	/border(Left|Right)\s*[:=]\s*["'`](\d+)px\s+solid/g,
	/(?<![\w-])w-(?:0\.5|1(?:\.5)?|2(?:\.5)?|3|\[(?:[2-9]|1[0-2])px\])(?![\w./-])/g,
], ({ match, line, scope, offset, pass, context }) => {
	const tag = tagAt(line, match.index ?? 0)
	if (match[0].startsWith("w-")) {
		const bg = solidBackground(tag)
		const empty = !tag.startsWith("<") || /\/>$/.test(tag) || line.slice(line.indexOf(tag) + tag.length).trimStart().startsWith("</")
		if (!bg || !empty || !/(?<![\w-])(?:shrink-0|rounded-[lres](?:-\w+)?|left-0|right-0|inset-0|inset-y-0)(?![\w./-])/.test(tag) || /(?<![\w-])h-(?:px\b|[0-9]|\[)|\brounded-full\b|aria-(?:current|selected)/i.test(tag)) return null
		return `${match[0]} + ${bg} stripe child`
	}
	const side = (match[1] ?? "left").toLowerCase().replace("inline-", "")
	const width = Number(match[2])
	const utility = /^border-[lrse]-/.test(match[0])
	if (utility ? width < (/\brounded(?!-none)\b/.test(scope) ? 2 : 4) : width < (/^border-(?:left|right)\s*:/i.test(match[0]) && /border-radius/i.test(scope) ? 2 : 3)) return null
	if (!utility && /<(?:blockquote|nav[\s>]|pre[\s>]|code[\s>]|a\s|input[\s>]|span[\s>])/i.test(scope)) return null
	if (/^border-(?:left|right)\s*:/i.test(match[0])) {
		const color = /\bsolid\s+([\s\S]*)/i.exec(match[0])?.[1]?.trim() ?? ""
		if (color && !chromatic(color)) return null
	}
	const styles = sourcePasses(context).filter((p) => p.css).map((p) => p.text).join("\n")
	const imported = /(?:import|require\s*\()[^;\n]*\.(?:css|scss|sass|less)["']|<style[^>]*\bsrc\s*=|@import|@use\s+['"](?!sass:)/.test(context.file.text)
	if (utility || (tag.startsWith("<") && /border(?:Left|Right)\s*=|(?:style|sx)\s*=/.test(tag))) {
		const corners = tag === line && !line.trimStart().startsWith("<") ? [null, null, null, null] : tagCorners(tag, styles || context.file.text, imported)
		if (!roundedAway(corners, side)) return null
	} else {
		const embedded = sourcePasses(context).find((p) => p.css && p.offset <= pass.offset + offset && pass.offset + offset < p.offset + p.text.length)
		const ownPass = embedded ?? pass
		const localOffset = pass.offset + offset - ownPass.offset
		const scopes = cssScopes(ownPass.text, ownPass.sass)
		const block = scopes.filter((s) => s.start <= localOffset && localOffset <= s.end).sort((a, b) => b.start - a.start)[0]
		if (block) {
			const host = selectorHost(block)
			const corners = scopeCorners(block, scopes)
			const status = /(?:^|[ .>])(?:tr|td|th)\b|(?:error|danger|warning|success|broken|new)\b/.test(host)
			if (!roundedAway(corners, side) && (!status || safeSelector(host))) return null
		} else if (!roundedAway(applyRadii([0, 0, 0, 0], scope), side)) return null
	}
	return match[0].replace(/\s*;?\s*$/, "")
})

export const sideTab: SourceRule = {
	meta: { id: "side-tab", name: "Side-tab accent border", category: "slop", severity: "warning", engine: "source", description: "A colored stripe decorates a rounded card or status row.", fixHint: "Remove the stripe or use a quieter surface and text hierarchy." },
	extensions: sourceExtensions,
	check: (context) => [...borderCheck(context), ...accentScans(context)],
}
