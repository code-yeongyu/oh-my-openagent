// Public types of the frontend detect SDK: rules, findings, snapshots, options.
// Rule semantics are adapted from Impeccable's detector (Apache-2.0, Copyright 2025 Paul Bakaus); see ATTRIBUTION.md sections 6-7.

export type Severity = "error" | "warning" | "advisory"
export type RuleCategory = "slop" | "quality"
export type RuleSetting = Severity | "off"

/** Where a rule reads from: the rendered page, or raw source text with no rendering. */
export type RuleEngine = "page" | "source"

export type RuleMeta = {
	readonly id: string
	readonly name: string
	readonly category: RuleCategory
	readonly severity: Severity
	readonly engine: RuleEngine
	readonly description: string
	readonly fixHint: string
}

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type ElementLocation = {
	readonly kind: "element"
	readonly file?: string
	readonly selector: string
	readonly rect: Rect
	readonly viewport: Viewport
}

export type SourceLocation = {
	readonly kind: "source"
	readonly file: string
	readonly line: number
	readonly column: number
}

export type PageLocation = { readonly kind: "page"; readonly file?: string; readonly viewport: Viewport }

export type FindingLocation = ElementLocation | SourceLocation | PageLocation

export type Finding = {
	readonly ruleId: string
	readonly name: string
	readonly category: RuleCategory
	readonly severity: Severity
	readonly message: string
	readonly fixHint: string
	readonly location: FindingLocation
	readonly snippet: string
}

export type Viewport = { readonly width: number; readonly height: number }

/** Computed style values, keyed by CSS property name (kebab-case), as getComputedStyle reports them. */
export type ComputedStyle = Readonly<Record<string, string>>

export type PseudoSnapshot = { readonly style: ComputedStyle; readonly rect: Rect | null }

export type ElementSnapshot = {
	readonly index: number
	readonly parent: number | null
	readonly children: readonly number[]
	readonly tag: string
	readonly selector: string
	readonly attributes: Readonly<Record<string, string>>
	readonly rect: Rect
	/** Text of this element's own direct text nodes, whitespace-collapsed. */
	readonly ownText: string
	/** Each non-empty direct text node of this element, trimmed and whitespace-collapsed, in document order. */
	readonly textRuns: readonly string[]
	/** Full text content, whitespace-collapsed, capped at 2000 characters. */
	readonly text: string
	/** Rendered line boxes of the element's own text nodes, top-down. */
	readonly lineRects: readonly Rect[]
	readonly style: ComputedStyle
	readonly before: PseudoSnapshot | null
	readonly after: PseudoSnapshot | null
	readonly scroll: { readonly scrollWidth: number; readonly clientWidth: number; readonly scrollHeight: number; readonly clientHeight: number }
	/** CSS properties a running animation or transition on this element is moving at capture time (kebab-case, deduplicated). */
	readonly motion: readonly string[]
	/** True when the element is in the top layer as a modal (matches `:modal`: a modal dialog or a fullscreen element). */
	readonly modal: boolean
	/** Computed `::placeholder` style of an input or textarea while it shows its placeholder (`:placeholder-shown`); null otherwise. */
	readonly placeholder: PseudoSnapshot | null
}

export type PageSnapshot = {
	readonly viewport: Viewport
	readonly url: string
	readonly title: string
	readonly lang: string
	readonly document: { readonly scrollWidth: number; readonly clientWidth: number; readonly scrollHeight: number }
	readonly elements: readonly ElementSnapshot[]
	/** Text of every same-origin stylesheet, in document order (for @keyframes, @font-face, raw declarations). */
	readonly cssText: readonly string[]
	/** Errors thrown by page scripts while the snapshot was taken. */
	readonly scriptErrors: readonly string[]
	/** False when the renderer could not install the error probe before page scripts (WebKit on an http(s) URL), so scriptErrors is not evidence of a clean load. */
	readonly scriptErrorsCaptured: boolean
}

export type SourceFile = { readonly path: string; readonly text: string }

export type DetectConfig = {
	/** Per-rule override: a severity, or "off". */
	readonly rules?: Readonly<Record<string, RuleSetting>>
	/** Typefaces the project chose on purpose; never reported as overused. Case-insensitive family names. */
	readonly allowFonts?: readonly string[]
	/** Timing functions the project's design tokens name on purpose (for example an intentional spring). */
	readonly allowEasings?: readonly string[]
	/** The project's design-system tokens; the design-system-* rules report values outside them and stay silent without them. */
	readonly designTokens?: DesignTokens
}

export type DesignTokens = {
	readonly fonts?: readonly string[]
	/** CSS colors (any form parseColor accepts). */
	readonly colors?: readonly string[]
	/** Border radii in px. */
	readonly radii?: readonly number[]
	/** Font sizes in px. */
	readonly fontSizes?: readonly number[]
}
