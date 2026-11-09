function closingBrace(text: string, start: number): number {
	let depth = 0
	let quote = ""
	for (let i = start; i < text.length; i++) {
		const ch = text[i]
		if (quote) {
			if (ch === "\\") i++
			else if (ch === quote) quote = ""
		} else if (ch === "'" || ch === '"' || ch === "`") quote = ch
		else if (ch === "{") depth++
		else if (ch === "}" && --depth === 0) return i
	}
	return text.length
}

export function imageTags(text: string, script: boolean): readonly { readonly tag: string; readonly offset: number }[] {
	const images: { tag: string; offset: number }[] = []
	let depth = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "{" && depth > 0) {
			const end = closingBrace(text, i)
			images.push(...imageTags(text.slice(i + 1, end), true).map((hit) => ({ tag: hit.tag, offset: i + 1 + hit.offset })))
			i = end
			continue
		}
		if ((script && depth === 0) && (ch === '"' || ch === "'" || ch === "`")) {
			const quote = ch
			while (++i < text.length) {
				if (text[i] === "\\") i++
				else if (text[i] === quote) break
			}
			continue
		}
		if (script && depth === 0 && ch === "/" && /(?:^|[=(:,!&|?;{}]|\breturn)\s*$/.test(text.slice(0, i))) {
			let bracket = false
			while (++i < text.length) {
				if (text[i] === "\\") i++
				else if (text[i] === "[") bracket = true
				else if (text[i] === "]") bracket = false
				else if (text[i] === "/" && !bracket) break
			}
			continue
		}
		if (ch !== "<" || !/^<\/?[A-Za-z_$\u0080-\uffff>]/.test(text.slice(i, i + 3))) continue
		const start = i
		let quote = ""
		for (; i < text.length && i - start < 8192; i++) {
			const c = text[i]
			if (quote) {
				if (c === "\\") i++
				else if (c === quote) quote = ""
			} else if (c === '"' || c === "'") quote = c
			else if (c === "{") {
				const end = closingBrace(text, i)
				images.push(...imageTags(text.slice(i + 1, end), script).map((hit) => ({ tag: hit.tag, offset: i + 1 + hit.offset })))
				i = end
			} else if (c === ">") break
		}
		const tag = text.slice(start, i + 1)
		if (/^<img\b/i.test(tag) && tag.endsWith(">")) images.push({ tag, offset: start })
		if (/^<\/(?:[A-Za-z_$]|>)/.test(tag)) depth = Math.max(0, depth - 1)
		else if (!/\/>$/.test(tag) && !/^<(?:img|input|br|hr|meta|link)\b/i.test(tag)) depth++
		if (/^<(?:script|style)\b/i.test(tag)) {
			const end = new RegExp(`</${/^<(\w+)/.exec(tag)?.[1] ?? ""}\\s*>`, "gi")
			end.lastIndex = i + 1
			const close = end.exec(text)
			if (close) { i = close.index + close[0].length - 1; depth = Math.max(0, depth - 1) }
		}
	}
	return images
}

export function missingImageSource(tag: string, ext: string): boolean {
	let i = 4
	while (i < tag.length) {
		while (/[\s/]/.test(tag[i] ?? "")) i++
		if (i >= tag.length || tag[i] === ">") break
		if (tag[i] === "{") {
			const end = closingBrace(tag, i)
			const expression = tag.slice(i + 1, end).trim()
			if (/^\.\.\./.test(expression) || (["svelte", "astro"].includes(ext) && /^(?:src|srcset)$/.test(expression))) return false
			i = end + 1
			continue
		}
		const start = i
		while (i < tag.length && !/[\s=/>]/.test(tag[i] ?? "")) i++
		const name = tag.slice(start, i)
		const base = name.split(".")[0] ?? ""
		const source = /(?:^|[:-])(?:src|srcset)$/i.test(base)
		if (ext === "vue" && ((source && name.includes(":")) || name === "v-bind")) return false
		while (/\s/.test(tag[i] ?? "")) i++
		if (tag[i] !== "=") {
			if (source && name.includes(":")) return false
			if (i === start) i++
			continue
		}
		i++
		while (/\s/.test(tag[i] ?? "")) i++
		if (tag[i] === "{") {
			i = closingBrace(tag, i) + 1
			if (source) return false
			continue
		}
		const quote = tag[i] === "'" || tag[i] === '"' ? tag[i++] : null
		const valueStart = i
		while (i < tag.length && (quote ? tag[i] !== quote : !/[\s>]/.test(tag[i] ?? ""))) i++
		const value = tag.slice(valueStart, i).trim()
		if (quote) i++
		if (source && value && value !== "#") return false
	}
	return true
}
