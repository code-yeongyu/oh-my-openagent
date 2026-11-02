import type { ElementSnapshot, PageSnapshot, PseudoSnapshot, Rect, Viewport } from "../types"

// Computed-style defaults a Chromium page reports for an unstyled element; a node spec overrides only what it sets.
const DEFAULT_STYLE: Readonly<Record<string, string>> = {
	display: "block", position: "static", visibility: "visible", opacity: "1", "z-index": "auto",
	"overflow-x": "visible", "overflow-y": "visible", transform: "none",
	color: "rgb(0, 0, 0)", "background-color": "rgba(0, 0, 0, 0)", "background-image": "none", "background-clip": "border-box",
	"-webkit-background-clip": "border-box", "-webkit-text-fill-color": "rgb(0, 0, 0)",
	"font-family": "Georgia, serif", "font-size": "16px", "font-weight": "400", "font-style": "normal", "line-height": "24px",
	"letter-spacing": "normal", "word-spacing": "0px", "text-transform": "none", "text-align": "start", "text-align-last": "auto",
	"text-decoration-line": "none", "text-overflow": "clip", "text-wrap": "wrap", "white-space": "normal",
	"border-top-width": "0px", "border-right-width": "0px", "border-bottom-width": "0px", "border-left-width": "0px",
	"border-top-style": "none", "border-right-style": "none", "border-bottom-style": "none", "border-left-style": "none",
	"border-top-color": "rgb(0, 0, 0)", "border-right-color": "rgb(0, 0, 0)", "border-bottom-color": "rgb(0, 0, 0)", "border-left-color": "rgb(0, 0, 0)",
	"border-top-left-radius": "0px", "border-top-right-radius": "0px", "border-bottom-right-radius": "0px", "border-bottom-left-radius": "0px",
	"border-image-source": "none", "outline-style": "none", "box-shadow": "none", "text-shadow": "none", filter: "none",
	"backdrop-filter": "none", "clip-path": "none", "mask-image": "none",
	"padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px",
	"margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px",
	"row-gap": "normal", "column-gap": "normal", "animation-name": "none", "animation-duration": "0s",
	"animation-iteration-count": "1", "animation-timing-function": "ease", "transition-property": "all",
	"transition-duration": "0s", "transition-timing-function": "ease", "object-fit": "fill", content: "normal",
}

export type NodeSpec = {
	readonly tag?: string
	readonly id?: string
	readonly attributes?: Readonly<Record<string, string>>
	readonly style?: Readonly<Record<string, string>>
	readonly text?: string
	readonly textRuns?: readonly string[]
	readonly rect?: Partial<Rect>
	readonly lineRects?: readonly Rect[]
	readonly before?: Readonly<Record<string, string>>
	readonly after?: Readonly<Record<string, string>>
	readonly scroll?: Partial<ElementSnapshot["scroll"]>
	readonly motion?: readonly string[]
	readonly modal?: boolean
	readonly placeholder?: Readonly<Record<string, string>>
	readonly children?: readonly NodeSpec[]
}

const pseudo = (style: Readonly<Record<string, string>> | undefined): PseudoSnapshot | null =>
	style ? { style: { ...DEFAULT_STYLE, content: '""', ...style }, rect: null } : null

/** Builds a PageSnapshot from a tree of node specs under <body>, filling Chromium's default computed values. */
export function buildSnapshot(body: readonly NodeSpec[], options: { readonly viewport?: Viewport; readonly cssText?: readonly string[]; readonly scriptErrors?: readonly string[]; readonly scriptErrorsCaptured?: boolean } = {}): PageSnapshot {
	const viewport = options.viewport ?? { width: 1280, height: 800 }
	const elements: ElementSnapshot[] = []
	const add = (spec: NodeSpec, parent: number | null, path: string): number => {
		const index = elements.length
		const tag = spec.tag ?? "div"
		const selector = spec.id ? `#${spec.id}` : `${path} > ${tag}:nth-of-type(${index})`
		const placeholder: ElementSnapshot = {
			index, parent, children: [], tag, selector,
			attributes: { ...(spec.id ? { id: spec.id } : {}), ...spec.attributes },
			rect: { x: 0, y: 0, width: 200, height: 40, ...spec.rect },
			ownText: spec.text ?? "", textRuns: spec.textRuns ?? (spec.text ? [spec.text] : []), text: "", lineRects: spec.lineRects ?? (spec.text ? [{ x: 0, y: 0, width: 160, height: 24, ...spec.rect }] : []),
			style: { ...DEFAULT_STYLE, ...(tag === "span" || tag === "a" ? { display: "inline" } : {}), ...spec.style },
			before: pseudo(spec.before), after: pseudo(spec.after),
			scroll: { scrollWidth: 200, clientWidth: 200, scrollHeight: 40, clientHeight: 40, ...spec.scroll },
			motion: spec.motion ?? [],
			modal: spec.modal ?? false,
			placeholder: spec.placeholder ? { style: { ...DEFAULT_STYLE, ...spec.placeholder }, rect: null } : null,
		}
		elements.push(placeholder)
		const children = (spec.children ?? []).map((c) => add(c, index, selector))
		const text = [spec.text ?? "", ...children.map((i) => elements[i]?.text ?? "")].filter(Boolean).join(" ")
		elements[index] = { ...placeholder, children, text }
		return index
	}
	add({ tag: "body", rect: { width: viewport.width, height: viewport.height }, children: body }, null, "html")
	return {
		viewport, url: "about:blank", title: "", lang: "en",
		document: { scrollWidth: viewport.width, clientWidth: viewport.width, scrollHeight: viewport.height },
		elements, cssText: options.cssText ?? [], scriptErrors: options.scriptErrors ?? [], scriptErrorsCaptured: options.scriptErrorsCaptured ?? true,
	}
}
