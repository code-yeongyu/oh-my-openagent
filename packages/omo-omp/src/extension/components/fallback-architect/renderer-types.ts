/**
 * Minimal structural renderer types replacing the harness `MessageRenderer` import the senpi
 * port took from `@code-yeongyu/senpi`. The adapter contract types
 * `OmpExtensionAPI.registerMessageRenderer(customType, renderer)` as `unknown`, so these shapes
 * only pin what the two local renderers (notice + tip) actually touch; the shim accepts any
 * renderer at runtime.
 */

export interface OmpRenderMessage<T = unknown> {
  content?: string
  details?: T
  [key: string]: unknown
}

export interface OmpRenderOptions {
  expanded: boolean
  outputPad: number
}

export interface OmpRenderTheme {
  fg(color: string, text: string): string
}

/** The smallest surface the renderers' consumers (and their tests) call on the returned component. */
export interface OmpRenderResult {
  render(width: number): readonly string[]
}

export type OmpMessageRenderer<T = unknown> = (
  message: OmpRenderMessage<T>,
  options: OmpRenderOptions,
  theme: OmpRenderTheme,
) => OmpRenderResult | undefined
