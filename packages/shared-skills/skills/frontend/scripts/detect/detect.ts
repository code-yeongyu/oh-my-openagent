import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { extensionOf } from "./core/source"
import { lintSnapshot, lintSources, sortFindings, type LintOptions } from "./lint"
import type { RenderTarget, Renderer } from "./render/renderer"
import { createWebViewRenderer } from "./render/webview"
import type { DetectConfig, Finding, Viewport } from "./types"

/** @public */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]

/** StyleGallery's reflow matrix: every width, with an unbroken stress token added at the narrowest one. @public */
export const REFLOW_VIEWPORTS: readonly Viewport[] = [320, 375, 768, 1024, 1440].map((width) => ({ width, height: 800 }))

export type DetectPageOptions = LintOptions & {
	readonly viewports?: readonly Viewport[]
	/** Bring your own renderer (Playwright, omowright); defaults to a Bun.WebView renderer created and closed here. */
	readonly renderer?: Renderer
	/** Also render at REFLOW_VIEWPORTS with content stress at 320 px, feeding the viewport-reflow rule. */
	readonly reflow?: boolean
}

const PAGE_EXTENSIONS = new Set(["html", "htm"])

/** Renders a page at each viewport and lints every snapshot. */
export async function detectPage(target: RenderTarget, options: DetectPageOptions = {}): Promise<readonly Finding[]> {
	const renderer = options.renderer ?? createWebViewRenderer()
	try {
		const findings: Finding[] = []
		const passes = [
			...(options.viewports ?? DEFAULT_VIEWPORTS).map((viewport) => ({ viewport, contentStress: false })),
			...(options.reflow ? REFLOW_VIEWPORTS.map((viewport) => ({ viewport, contentStress: viewport.width === 320 })) : []),
		]
		for (const pass of passes) {
			const snapshot = await renderer.render({ target, ...pass })
			findings.push(...lintSnapshot(snapshot, options))
		}
		return sortFindings(dedupe(findings))
	} finally {
		if (!options.renderer) await renderer.close()
	}
}

/** Lints files: HTML is rendered and checked as a page, everything else is checked as source text. */
export async function detectFiles(paths: readonly string[], options: DetectPageOptions = {}): Promise<readonly Finding[]> {
	const pages = paths.filter((p) => PAGE_EXTENSIONS.has(extensionOf(p)))
	const sources = paths.filter((p) => !PAGE_EXTENSIONS.has(extensionOf(p)))
	const findings: Finding[] = [...lintSources(sources.map((path) => ({ path, text: readFileSync(path, "utf8") })), options)]
	const renderer = options.renderer ?? createWebViewRenderer()
	try {
		for (const page of pages) {
			const url = pathToFileURL(resolve(page)).href
			findings.push(...(await detectPage({ kind: "url", url }, { ...options, renderer, file: page })))
		}
	} finally {
		if (!options.renderer) await renderer.close()
	}
	return sortFindings(findings)
}

/** The same rule on the same element at two viewports is one finding; the first viewport's location is kept. */
function dedupe(findings: readonly Finding[]): readonly Finding[] {
	const seen = new Set<string>()
	return findings.filter((f) => {
		const where = f.location.kind === "element" ? f.location.selector : f.location.kind === "source" ? `${f.location.line}:${f.location.column}` : "page"
		const key = `${f.ruleId}|${where}|${f.message}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export type { DetectConfig }
