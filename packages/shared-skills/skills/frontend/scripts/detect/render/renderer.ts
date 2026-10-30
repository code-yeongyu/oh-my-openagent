import type { PageSnapshot, Viewport } from "../types"

export type RenderTarget = { readonly kind: "html"; readonly html: string } | { readonly kind: "url"; readonly url: string }

export type RenderRequest = {
	readonly target: RenderTarget
	readonly viewport: Viewport
	/** Appends an unbroken 300-character token to every element whose last child is text, to expose reflow breaks. */
	readonly contentStress?: boolean
}

/** Anything that can turn a page into a PageSnapshot: Bun.WebView by default, or a Playwright/omowright page you already drive. */
export type Renderer = {
	readonly render: (request: RenderRequest) => Promise<PageSnapshot>
	readonly close: () => Promise<void>
}

export class RenderError extends Error {
	readonly target: string
	constructor(target: string, cause: unknown) {
		super(`render failed for ${target}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
		this.name = "RenderError"
		this.target = target
	}
}

const STRESS_TOKEN = "Unbrokencontentstresstoken".repeat(12)

export const CONTENT_STRESS_SCRIPT = `(() => {
	const token = ${JSON.stringify(STRESS_TOKEN)};
	for (const el of document.querySelectorAll("body *")) {
		const last = el.lastChild;
		if (!last || last.nodeType !== 3 || last.textContent.trim() === "") continue;
		if (["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "TITLE"].includes(el.tagName)) continue;
		last.textContent = last.textContent + " " + token;
	}
})();`
